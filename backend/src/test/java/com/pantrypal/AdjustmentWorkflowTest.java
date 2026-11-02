package com.pantrypal;

import java.util.*;
import java.util.concurrent.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.server.ResponseStatusException;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest
@AutoConfigureMockMvc
class AdjustmentWorkflowTest {
    @Autowired PantryService service;
    @Autowired PantryRepository repo;
    @Autowired PlatformTransactionManager transactions;
    @Autowired MockMvc mvc;
    @MockitoSpyBean NotificationEvents notifications;

    long item(double quantity) {
        return PantryService.id(service.saveInventory(null, Map.of("name", "Workflow test", "category", "Dairy",
            "quantity", quantity, "unit", "litres", "minThreshold", 2)));
    }

    Map<String,Object> row(long id) { return repo.one("SELECT * FROM inventory_items WHERE id=?", id); }
    Map<String,Object> adjust(long id, String key, String operation, double amount) {
        return service.adjustInventory(id, key, Map.of("operation", operation, "amount", amount));
    }

    // Calls enter separate service transactions on worker threads. The ready/start
    // barriers avoid sequential submission masquerading as a concurrency test.
    <T> List<T> race(Callable<T> first, Callable<T> second) throws Exception {
        var pool = Executors.newFixedThreadPool(2);
        var ready = new CountDownLatch(2);
        var start = new CountDownLatch(1);
        try {
            List<Future<T>> futures = new ArrayList<>();
            for (var call : List.of(first, second)) futures.add(pool.submit(() -> {
                ready.countDown();
                if (!start.await(10, TimeUnit.SECONDS)) throw new AssertionError("Workers did not start");
                return call.call();
            }));
            assertThat(ready.await(10, TimeUnit.SECONDS)).isTrue();
            start.countDown();
            return List.of(futures.get(0).get(15, TimeUnit.SECONDS), futures.get(1).get(15, TimeUnit.SECONDS));
        } finally {
            start.countDown();
            pool.shutdownNow();
            assertThat(pool.awaitTermination(10, TimeUnit.SECONDS)).isTrue();
        }
    }

    @Test void concurrentConsumeAndRestockPreserveBothUpdatesAndUndoHistory() throws Exception {
        long id = item(10);
        try {
            clearInvocations(notifications);
            race(() -> adjust(id, "consume", "consume", 3), () -> adjust(id, "restock", "restock", 2));
            assertThat(row(id).get("quantity")).isEqualTo(9.0);
            assertThat(row(id).get("revision")).isEqualTo(2L);
            var history = repo.query("SELECT * FROM inventory_adjustments WHERE inventory_item_id=? ORDER BY inventory_revision", id);
            assertThat(history).hasSize(2);
            assertThat(history.get(0).get("quantityBefore")).isEqualTo(10.0);
            assertThat(history.get(1).get("quantityBefore")).isEqualTo(history.get(0).get("quantityAfter"));
            assertThat(history.get(1).get("quantityAfter")).isEqualTo(9.0);
            verify(notifications, times(2)).changed(new PantryService.PantryChanged("inventory_changed", id));
        } finally { service.deleteInventory(id); }
    }

    @Test void concurrentConsumesCannotOverdrawStock() throws Exception {
        long id = item(5);
        try {
            clearInvocations(notifications);
            Callable<Integer> consume = () -> {
                try { adjust(id, UUID.randomUUID().toString(), "consume", 4); return 200; }
                catch (ResponseStatusException failure) { return failure.getStatusCode().value(); }
            };
            assertThat(race(consume, consume)).containsExactlyInAnyOrder(200, 400);
            assertThat(row(id).get("quantity")).isEqualTo(1.0);
            assertThat(row(id).get("revision")).isEqualTo(1L);
            assertThat(repo.query("SELECT * FROM inventory_adjustments WHERE inventory_item_id=?", id)).hasSize(1);
            verify(notifications).changed(new PantryService.PantryChanged("inventory_changed", id));
        } finally { service.deleteInventory(id); }
    }

    @Test void concurrentIdenticalRetriesApplyOnlyOnce() throws Exception {
        long id = item(5);
        try {
            clearInvocations(notifications);
            Callable<Map<String,Object>> request = () -> adjust(id, "same-key", "consume", 2);
            assertThat(race(request, request)).allSatisfy(result -> assertThat(result.get("quantity")).isEqualTo(3.0));
            assertThat(row(id).get("revision")).isEqualTo(1L);
            assertThat(repo.query("SELECT * FROM inventory_adjustments WHERE inventory_item_id=?", id)).hasSize(1);
            verify(notifications).changed(new PantryService.PantryChanged("inventory_changed", id));
        } finally { service.deleteInventory(id); }
    }

    @Test void concurrentConflictingKeysRejectOnePayloadWithoutAnExtraWrite() throws Exception {
        long id = item(5);
        try {
            clearInvocations(notifications);
            List<Integer> outcomes = race(() -> conflictingRequest(id, 1), () -> conflictingRequest(id, 2));
            assertThat(outcomes).containsExactlyInAnyOrder(200, 400);
            var history = repo.query("SELECT * FROM inventory_adjustments WHERE inventory_item_id=?", id);
            assertThat(history).hasSize(1);
            assertThat(row(id).get("quantity")).isEqualTo(5 + PantryService.number(history.get(0), "amount"));
            assertThat(row(id).get("revision")).isEqualTo(1L);
            verify(notifications).changed(new PantryService.PantryChanged("inventory_changed", id));
        } finally { service.deleteInventory(id); }
    }

    int conflictingRequest(long id, double amount) {
        try { adjust(id, "same-key", "restock", amount); return 200; }
        catch (ResponseStatusException failure) { return failure.getStatusCode().value(); }
    }

    @ParameterizedTest @ValueSource(strings={"{}", "{\"operation\":\"consume\"}",
        "{\"operation\":\"consume\",\"amount\":null}", "{\"operation\":\"consume\",\"amount\":\"2\"}",
        "{\"operation\":\"consume\",\"amount\":true}", "{\"operation\":\"replace\",\"amount\":1}"})
    void malformedAdjustmentBodiesDoNotWrite(String body) throws Exception {
        long id = item(5);
        try {
            var before = row(id);
            clearInvocations(notifications);
            mvc.perform(post("/api/inventory/" + id + "/adjust").header("Idempotency-Key", "invalid-body")
                .contentType("application/json").content(body))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.error").isString());
            assertThat(row(id)).isEqualTo(before);
            assertThat(repo.query("SELECT * FROM inventory_adjustments WHERE inventory_item_id=?", id)).isEmpty();
            verify(notifications, never()).changed(any());
        } finally { service.deleteInventory(id); }
    }

    @Test void keysAreItemScopedAndRetriesReturnCurrentStockWithoutAnotherMutation() {
        long first = item(5), second = item(8);
        try {
            adjust(first, "shared-key", "consume", 2);
            adjust(second, "shared-key", "restock", 1);
            adjust(first, "later", "restock", 4);
            var before = row(first);
            clearInvocations(notifications);
            assertThat(adjust(first, "shared-key", "consume", 2).get("quantity")).isEqualTo(7.0);
            assertThat(row(first)).isEqualTo(before);
            assertThat(row(second).get("quantity")).isEqualTo(9.0);
            verify(notifications, never()).changed(any());
        } finally { service.deleteInventory(first); service.deleteInventory(second); }
    }

    @Test void adjustmentRollbackReleasesKeyAndDoesNotNotifyBeforeCommit() {
        long id = item(5);
        try {
            var before = row(id);
            clearInvocations(notifications);
            new TransactionTemplate(transactions).executeWithoutResult(tx -> {
                adjust(id, "rolled-back", "consume", 2);
                verify(notifications, never()).changed(any());
                tx.setRollbackOnly();
            });
            assertThat(row(id)).isEqualTo(before);
            assertThat(repo.query("SELECT * FROM inventory_adjustments WHERE inventory_item_id=?", id)).isEmpty();
            verify(notifications, never()).changed(any());
            new TransactionTemplate(transactions).executeWithoutResult(tx -> {
                adjust(id, "rolled-back", "consume", 2);
                verify(notifications, never()).changed(any());
            });
            assertThat(row(id).get("quantity")).isEqualTo(3.0);
            verify(notifications).changed(new PantryService.PantryChanged("inventory_changed", id));
        } finally { service.deleteInventory(id); }
    }

    @Test void invalidKeysAreRejectedWithoutReservingHistory() throws Exception {
        long id = item(5);
        try {
            var before = row(id);
            clearInvocations(notifications);
            for (String key : List.of(" ", "x".repeat(129))) {
                mvc.perform(post("/api/inventory/" + id + "/adjust").header("Idempotency-Key", key)
                    .contentType("application/json").content("{\"operation\":\"consume\",\"amount\":1}"))
                    .andExpect(status().isBadRequest());
            }
            assertThat(row(id)).isEqualTo(before);
            assertThat(repo.query("SELECT * FROM inventory_adjustments WHERE inventory_item_id=?", id)).isEmpty();
            verify(notifications, never()).changed(any());
            assertThat(adjust(id, "x".repeat(128), "consume", 0.5).get("quantity")).isEqualTo(4.5);
        } finally { service.deleteInventory(id); }
    }

    @ParameterizedTest @ValueSource(doubles={0, -1, Double.NaN, Double.POSITIVE_INFINITY, Double.NEGATIVE_INFINITY})
    void invalidAmountsLeaveStockHistoryAndNotificationsUntouched(double amount) {
        long id = item(5);
        try {
            var before = row(id);
            clearInvocations(notifications);
            for (String operation : List.of("consume", "restock")) {
                assertThatThrownBy(() -> adjust(id, "invalid", operation, amount))
                    .isInstanceOfSatisfying(ResponseStatusException.class, failure ->
                        assertThat(failure.getStatusCode().value()).isEqualTo(400));
            }
            assertThat(row(id)).isEqualTo(before);
            assertThat(repo.query("SELECT * FROM inventory_adjustments WHERE inventory_item_id=?", id)).isEmpty();
            verify(notifications, never()).changed(any());
            // Rejection must not reserve the request key.
            assertThat(adjust(id, "invalid", "consume", 5).get("quantity")).isEqualTo(0.0);
        } finally { service.deleteInventory(id); }
    }

    long purchasedItem(long list, long inventory, double quantity) {
        long entry = PantryService.id(service.addItem(list, Map.of("name", "Workflow purchase", "category", "Dairy",
            "quantity", quantity, "unit", "litres", "inventoryItemId", inventory)));
        service.updateItem(list, entry, Map.of("purchased", true));
        return entry;
    }

    @Test void anotherListCannotUpdateOrDeletePurchasedItems() throws Exception {
        long id = item(5), owner = PantryService.id(service.createList(Map.of("name", "Owner")));
        long other = PantryService.id(service.createList(Map.of("name", "Other")));
        try {
            long entry = purchasedItem(owner, id, 3);
            var before = service.list(owner);
            mvc.perform(patch("/api/shopping-lists/" + other + "/items/" + entry)
                .contentType("application/json").content("{\"quantity\":99,\"purchased\":false}"))
                .andExpect(status().isNotFound());
            mvc.perform(delete("/api/shopping-lists/" + other + "/items/" + entry)).andExpect(status().isNotFound());
            assertThat(service.list(owner)).isEqualTo(before);
            assertThat(service.purchase(other).get("updatedInventoryItems")).isEqualTo(0);
            assertThat(row(id).get("quantity")).isEqualTo(5.0);
            assertThat(service.purchase(owner).get("updatedInventoryItems")).isEqualTo(1);
            assertThat(row(id).get("quantity")).isEqualTo(8.0);
        } finally { service.deleteList(owner); service.deleteList(other); service.deleteInventory(id); }
    }

    @Test void purchasesIgnoreUnpurchasedAndUnlinkedItems() {
        long id = item(5), list = PantryService.id(service.createList(Map.of("name", "Purchase selection")));
        try {
            purchasedItem(list, id, 3);
            service.addItem(list, Map.of("name", "Unchecked", "category", "Dairy", "quantity", 7,
                "unit", "litres", "inventoryItemId", id));
            long manual = PantryService.id(service.addItem(list, Map.of("name", "Manual", "category", "Dairy",
                "quantity", 4, "unit", "litres")));
            service.updateItem(list, manual, Map.of("purchased", true));
            int inventoryCount = service.inventory().size();
            assertThat(service.purchase(list).get("updatedInventoryItems")).isEqualTo(1);
            assertThat(row(id).get("quantity")).isEqualTo(8.0);
            assertThat(service.inventory()).hasSize(inventoryCount);
            assertThat(service.purchase(list).get("updatedInventoryItems")).isEqualTo(0);
        } finally { service.deleteList(list); service.deleteInventory(id); }
    }

    @Test void concurrentPurchaseCompletionAndAdjustmentPreserveStock() throws Exception {
        long id = item(5), list = PantryService.id(service.createList(Map.of("name", "Concurrent purchase")));
        try {
            purchasedItem(list, id, 3);
            race(() -> service.purchase(list), () -> adjust(id, "consume", "consume", 2));
            assertThat(row(id).get("quantity")).isEqualTo(6.0);
            assertThat(row(id).get("revision")).isEqualTo(2L);
            assertThat(service.purchase(list).get("updatedInventoryItems")).isEqualTo(0);
            assertThat(row(id).get("quantity")).isEqualTo(6.0);
        } finally { service.deleteList(list); service.deleteInventory(id); }
    }

    @Test void concurrentPurchaseRetriesRestockExactlyOnce() throws Exception {
        long id = item(5), list = PantryService.id(service.createList(Map.of("name", "Concurrent retries")));
        try {
            purchasedItem(list, id, 3);
            var results = race(() -> service.purchase(list), () -> service.purchase(list));
            assertThat(results).extracting(result -> result.get("updatedInventoryItems")).containsExactlyInAnyOrder(1, 0);
            assertThat(row(id).get("quantity")).isEqualTo(8.0);
            assertThat(row(id).get("revision")).isEqualTo(1L);
        } finally { service.deleteList(list); service.deleteInventory(id); }
    }

    @Test void purchaseRollbackRestoresAllStockAndMarkersAndAllowsSafeRetry() {
        long first = item(5), second = item(1);
        long list = PantryService.id(service.createList(Map.of("name", "Purchase rollback")));
        try {
            purchasedItem(list, first, 3);
            purchasedItem(list, second, 2);
            var beforeFirst = row(first);
            var beforeSecond = row(second);
            clearInvocations(notifications);
            assertThatThrownBy(() -> new TransactionTemplate(transactions).executeWithoutResult(tx -> {
                assertThat(service.purchase(list).get("updatedInventoryItems")).isEqualTo(2);
                throw new IllegalStateException("Fail transaction after purchase writes");
            })).isInstanceOf(IllegalStateException.class);
            assertThat(row(first)).isEqualTo(beforeFirst);
            assertThat(row(second)).isEqualTo(beforeSecond);
            assertThat(repo.query("SELECT id FROM shopping_list_items WHERE shopping_list_id=? AND restocked=TRUE", list)).isEmpty();
            verify(notifications, never()).changed(any());
            assertThat(service.purchase(list).get("updatedInventoryItems")).isEqualTo(2);
            assertThat(row(first).get("quantity")).isEqualTo(8.0);
            assertThat(row(second).get("quantity")).isEqualTo(3.0);
            assertThat(service.purchase(list).get("updatedInventoryItems")).isEqualTo(0);
            verify(notifications, times(2)).changed(new PantryService.PantryChanged("purchase_completed", null));
        } finally { service.deleteList(list); service.deleteInventory(first); service.deleteInventory(second); }
    }
}
