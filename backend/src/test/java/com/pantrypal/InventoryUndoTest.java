package com.pantrypal;

import java.time.OffsetDateTime;
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
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.transaction.PlatformTransactionManager;
import static org.mockito.Mockito.*;
import static org.assertj.core.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest
@AutoConfigureMockMvc
class InventoryUndoTest {
    @Autowired PantryService service;
    @Autowired PantryRepository repo;
    @Autowired MockMvc mvc;
    @Autowired PlatformTransactionManager transactions;
    @MockitoSpyBean NotificationEvents notifications;

    long item() {
        return PantryService.id(service.saveInventory(null, Map.of("name", "Undo test", "category", "Dairy",
            "quantity", 5, "unit", "litres", "minThreshold", 2, "notes", "Keep notes", "expiresAt", "2027-01-01")));
    }
    void adjust(long id, String key, String operation) {
        service.adjustInventory(id, key, Map.of("operation", operation, "amount", 2));
    }
    Map<String,Object> undo(long id, String key) { return service.undoInventoryAdjustment(id, Map.of("idempotencyKey", key)); }
    Map<String,Object> row(long id) { return repo.one("SELECT * FROM inventory_items WHERE id=?", id); }
    Map<String,Object> adjustment(long id) { return repo.one("SELECT * FROM inventory_adjustments WHERE inventory_item_id=? AND idempotency_key='original'", id); }
    void reject(long id, String body, int status) throws Exception {
        var before = row(id);
        mvc.perform(post("/api/inventory/" + id + "/undo").contentType("application/json").content(body))
            .andExpect(status().is(status)).andExpect(jsonPath("$.error").isString());
        assertThat(row(id)).isEqualTo(before);
    }

    @ParameterizedTest @ValueSource(strings={"consume", "restock"})
    void restoresQuantityExactlyOnceAndPreservesContract(String operation) throws Exception {
        long id = item();
        try {
            adjust(id, "original", operation);
            clearInvocations(notifications);
            mvc.perform(post("/api/inventory/" + id + "/undo").contentType("application/json").content("{\"idempotencyKey\":\"original\"}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.status").value("undone"))
                .andExpect(jsonPath("$.inventory.quantity").value(5))
                .andExpect(jsonPath("$.inventory.notes").value("Keep notes"))
                .andExpect(jsonPath("$.inventory.expiresAt").value("2027-01-01"))
                .andExpect(jsonPath("$.inventory.revision").doesNotExist());
            var after = row(id);
            assertThat(undo(id, "original").get("status")).isEqualTo("already_undone");
            assertThat(row(id)).isEqualTo(after);
            adjust(id, "original", operation); // Original adjustment retry cannot resurrect it.
            assertThat(row(id)).isEqualTo(after);
            verify(notifications, times(1)).changed(new PantryService.PantryChanged("inventory_changed", id));
            assertThat(adjustment(id).get("undoRevision")).isEqualTo(after.get("revision"));
            service.saveInventory(id, Map.of("notes", "New notes", "quantity", 8));
            repo.execute("UPDATE inventory_adjustments SET undo_expires_at=? WHERE inventory_item_id=?", OffsetDateTime.now().minusMinutes(1), id);
            var replay = undo(id, "original");
            assertThat(replay.get("status")).isEqualTo("already_undone");
            var replayInventory = (Map<?,?>) replay.get("inventory");
            assertThat(replayInventory.get("notes")).isEqualTo("New notes");
            assertThat(replayInventory.get("quantity")).isEqualTo(8.0);
            assertThat(service.inventory(id)).doesNotContainKey("revision");
            assertThat(service.inventory()).allSatisfy(i -> assertThat(i).doesNotContainKey("revision"));
        } finally { service.deleteInventory(id); }
    }

    @Test void expiredHistoricalAndInvalidRequestsNeverWrite() throws Exception {
        long id = item(), other = item();
        try {
            adjust(id, "original", "consume");
            clearInvocations(notifications);
            reject(id, "{}", 400);
            reject(id, "{\"idempotencyKey\":\" \"}", 400);
            reject(id, "{\"idempotencyKey\":42}", 400);
            reject(id, "{\"idempotencyKey\":\"unknown\"}", 404);
            reject(other, "{\"idempotencyKey\":\"original\"}", 404);
            mvc.perform(post("/api/inventory/9223372036854775807/undo").contentType("application/json")
                .content("{\"idempotencyKey\":\"original\"}")).andExpect(status().isNotFound());
            repo.execute("UPDATE inventory_adjustments SET undo_expires_at=? WHERE inventory_item_id=?", OffsetDateTime.now().minusSeconds(1), id);
            reject(id, "{\"idempotencyKey\":\"original\"}", 410);
            repo.execute("UPDATE inventory_adjustments SET inventory_revision=NULL, undo_expires_at=NULL WHERE inventory_item_id=?", id);
            reject(id, "{\"idempotencyKey\":\"original\"}", 409);
            assertThat(adjustment(id).get("undoneAt")).isNull();
            verify(notifications, never()).changed(any());
        } finally { service.deleteInventory(id); service.deleteInventory(other); }
    }

    @ParameterizedTest @ValueSource(strings={"edit", "adjustment", "aba", "purchase", "undo"})
    void interveningWritesInvalidateUndoEvenWhenQuantityReturns(String change) throws Exception {
        long id = item();
        Long list = null;
        try {
            adjust(id, "original", "consume");
            switch (change) {
                case "edit" -> service.saveInventory(id, Map.of("notes", "Edited notes"));
                case "adjustment" -> adjust(id, "later", "restock");
                case "aba" -> {
                    service.saveInventory(id, Map.of("quantity", 9));
                    service.saveInventory(id, Map.of("quantity", 3));
                }
                case "undo" -> { adjust(id, "later", "restock"); undo(id, "later"); }
                case "purchase" -> {
                    list = PantryService.id(service.createList(Map.of("name", "Undo purchase")));
                    long entry = PantryService.id(service.addItem(list, Map.of("name", "Milk", "category", "Dairy", "quantity", 2, "unit", "litres", "inventoryItemId", id)));
                    service.updateItem(list, entry, Map.of("purchased", true));
                    service.purchase(list);
                    var after = row(id);
                    service.purchase(list);
                    assertThat(row(id)).isEqualTo(after);
                }
            }
            clearInvocations(notifications);
            reject(id, "{\"idempotencyKey\":\"original\"}", 409);
            verify(notifications, never()).changed(any());
        } finally { if (list != null) service.deleteList(list); service.deleteInventory(id); }
    }

    @Test void rollbackRestoresStockRevisionAndUndoMetadataAndDoesNotNotify() {
        long id = item();
        try {
            adjust(id, "original", "restock");
            var before = row(id);
            var record = adjustment(id);
            clearInvocations(notifications);
            new TransactionTemplate(transactions).executeWithoutResult(tx -> {
                undo(id, "original");
                tx.setRollbackOnly();
            });
            assertThat(row(id)).isEqualTo(before);
            assertThat(adjustment(id)).isEqualTo(record);
            verify(notifications, never()).changed(any());
            assertThat(undo(id, "original").get("status")).isEqualTo("undone");
        } finally { service.deleteInventory(id); }
    }

    @Test void concurrentUndoAppliesOnce() throws Exception {
        long id = item();
        var pool = Executors.newFixedThreadPool(2);
        var start = new CountDownLatch(1);
        try {
            adjust(id, "original", "consume");
            clearInvocations(notifications);
            Callable<String> request = () -> { start.await(); return undo(id, "original").get("status").toString(); };
            var first = pool.submit(request);
            var second = pool.submit(request);
            start.countDown();
            assertThat(List.of(first.get(10, TimeUnit.SECONDS), second.get(10, TimeUnit.SECONDS)))
                .containsExactlyInAnyOrder("undone", "already_undone");
            assertThat(row(id).get("quantity")).isEqualTo(5.0);
            assertThat(row(id).get("revision")).isEqualTo(2L);
            verify(notifications, times(1)).changed(new PantryService.PantryChanged("inventory_changed", id));
        } finally { pool.shutdownNow(); service.deleteInventory(id); }
    }
}
