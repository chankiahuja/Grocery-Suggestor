package com.pantrypal;

import java.time.LocalDate;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.test.context.transaction.TestTransaction;
import static org.mockito.Mockito.*;
import static org.assertj.core.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest
@AutoConfigureMockMvc(addFilters=false) // Business-flow tests; AuthFlowTest exercises the real security chain.
@Transactional
class PantryFlowTest {
    @Autowired PantryService service;
    @Autowired PantryRepository repository;
    @Autowired MockMvc mvc;
    @MockitoSpyBean NotificationEvents notifications;
    Map<String,Object> item(String name, double quantity) {
        return service.saveInventory(null, Map.of("name",name,"category","Dairy","quantity",quantity,"unit","litres","minThreshold",2));
    }
    @Test void shoppingListNamesShareUnicodeBoundariesAndPreserveLegacyReads() {
        String[] boundaries = {"\t", "\n", "\u000B", "\f", "\r", " ", "\u00A0", "\u1680", "\u2000", "\u2001", "\u2002", "\u2003", "\u2004", "\u2005", "\u2006", "\u2007", "\u2008", "\u2009", "\u200A", "\u2028", "\u2029", "\u202F", "\u205F", "\u3000", "\uFEFF"};
        for (String boundary : boundaries) {
            assertThat(PantryService.trimShoppingListBoundaryWhitespace(boundary + "List" + boundary)).isEqualTo("List");
            assertThatThrownBy(() -> service.createList(Map.of("name", boundary))).isInstanceOf(org.springframework.web.server.ResponseStatusException.class);
        }
        assertThat(service.createList(Map.of("name", "  Weekly\u00A0 shop  ")).get("name")).isEqualTo("Weekly\u00A0 shop");
        assertThat(service.createList(Map.of("name", "😀".repeat(100))).get("name")).isEqualTo("😀".repeat(100));
        assertThatThrownBy(() -> service.createList(Map.of("name", "😀".repeat(101)))).isInstanceOf(org.springframework.web.server.ResponseStatusException.class);
        assertThatThrownBy(() -> service.createList(Map.of("name", "a".repeat(101)))).isInstanceOf(org.springframework.web.server.ResponseStatusException.class);

        long legacyId = repository.insert("shopping_lists", Map.of("name", "L".repeat(101)));
        assertThat(service.list(legacyId).get("name")).isEqualTo("L".repeat(101));
        assertThatThrownBy(() -> service.updateList(legacyId, Map.of("name", "x".repeat(101)))).isInstanceOf(org.springframework.web.server.ResponseStatusException.class);
        assertThat(service.updateList(legacyId, Map.of("name", " Valid ")).get("name")).isEqualTo("Valid");
    }
    @Test void shortageToPurchaseAndRepeatedCompletion() {
        long milk = PantryService.id(item("Milk", 0));
        item("Cheese", 5);
        var generated = service.generateList();
        long listId = PantryService.id(generated);
        var rows = repository.query("SELECT * FROM shopping_list_items WHERE shopping_list_id=?", listId);
        assertThat(rows).hasSize(1);
        long rowId = PantryService.id(rows.get(0));
        service.updateItem(listId,rowId,Map.of("purchased",true));
        assertThat(service.purchase(listId).get("updatedInventoryItems")).isEqualTo(1);
        assertThat(PantryService.number(service.inventory(milk),"quantity")).isEqualTo(2);
        assertThat(service.purchase(listId).get("updatedInventoryItems")).isEqualTo(0);
        assertThat(PantryService.number(service.inventory(milk),"quantity")).isEqualTo(2);
    }
    @Test void shoppingListsPreserveNumericUnitsAndLegacyGeneratedUnits() {
        long listId = PantryService.id(service.createList(Map.of("name", "Numeric units")));
        assertThatThrownBy(() -> service.addItem(listId, Map.of("name", "Legacy sugar", "category", "Pantry", "quantity", 2, "unit", "2")))
            .isInstanceOf(org.springframework.web.server.ResponseStatusException.class);

        long legacyId = repository.insert("inventory_items", Map.of(
            "name", "Legacy rice", "category", "Grains", "quantity", 0, "unit", "2", "min_threshold", 1));
        var generated = service.generateList();
        var generatedRows = repository.query("SELECT * FROM shopping_list_items WHERE shopping_list_id=?", PantryService.id(generated));
        assertThat(generatedRows).anySatisfy(row -> {
            assertThat(row.get("inventoryItemId")).isEqualTo(legacyId);
            assertThat(row.get("unit")).isEqualTo("2");
        });
    }
    @Test void expiryRemindersAreExcludedFromGeneratedShoppingList() {
        var cheese = item("Cheese",5);
        service.saveInventory(PantryService.id(cheese), Map.of("expiresAt", LocalDate.now(java.time.ZoneOffset.UTC).plusDays(2).toString()));
        assertThat(service.suggestions()).extracting(s -> s.get("urgency")).containsExactly("expiring_soon");
        assertThatThrownBy(service::generateList).isInstanceOf(org.springframework.web.server.ResponseStatusException.class);
    }
    @Test void reviewedGenerationUsesSelectedQuantitiesAndExcludesItems() {
        long milk = PantryService.id(item("Milk", 0));
        long cheese = PantryService.id(item("Cheese", 0));
        var generated = service.generateList(Map.of("items", java.util.List.of(
            Map.of("inventoryItemId", milk, "quantity", 4),
            Map.of("inventoryItemId", cheese, "quantity", 0))));
        var rows = repository.query("SELECT * FROM shopping_list_items WHERE shopping_list_id=?", PantryService.id(generated));
        assertThat(rows).hasSize(1);
        assertThat(PantryService.number(rows.get(0), "quantity")).isEqualTo(4);
        assertThat(rows.get(0).get("inventoryItemId")).isEqualTo(milk);
    }
    @Test void cannotModifyAnotherListsItem() {
        long first = PantryService.id(service.createList(Map.of("name","First")));
        long second = PantryService.id(service.createList(Map.of("name","Second")));
        long row = PantryService.id(service.addItem(first, Map.of("name","Eggs","category","Dairy","quantity",1,"unit","box")));
        assertThatThrownBy(() -> service.updateItem(second,row,Map.of("purchased",true))).isInstanceOf(org.springframework.web.server.ResponseStatusException.class);
    }
    @Test void inventoryLinkedShoppingItemsKeepTheirInventoryUnit() {
        var inventoryItem = item("Rice", 0);
        long inventoryItemId = PantryService.id(inventoryItem);
        long listId = PantryService.id(service.createList(Map.of("name", "Units")));
        long shoppingItemId = PantryService.id(service.addItem(listId, Map.of(
            "inventoryItemId", inventoryItemId, "name", "Rice", "category", "Grains", "quantity", 1, "unit", "litres")));
        assertThatThrownBy(() -> service.updateItem(listId, shoppingItemId, Map.of("unit", "kg")))
            .isInstanceOf(org.springframework.web.server.ResponseStatusException.class);
        assertThat(service.updateItem(listId, shoppingItemId, Map.of("unit", " litres ")).get("unit"))
            .isEqualTo("litres");
    }
    @Test void apiValidationAndCombinedFilters() throws Exception {
        item("Milk",0);
        mvc.perform(get("/api/inventory").param("category","Produce").param("lowStock","true")).andExpect(status().isOk()).andExpect(content().json("[]"));
        mvc.perform(post("/api/inventory").contentType("application/json").content("{\"name\":\"Milk\",\"quantity\":-1}")).andExpect(status().isBadRequest()).andExpect(jsonPath("$.error").exists());
        mvc.perform(get("/api/inventory/999999")).andExpect(status().isNotFound());
        mvc.perform(get("/api/healthz")).andExpect(status().isOk()).andExpect(jsonPath("$.status").value("ok"));
    }
    @Test void inventoryRejectsBlankAndNumericOnlyUnitsAndTrimsValidUnits() throws Exception {
        mvc.perform(post("/api/inventory").contentType("application/json")
            .content("{\"name\":\"Rice\",\"category\":\"Grains\",\"quantity\":2,\"unit\":\"   \",\"minThreshold\":1}"))
            .andExpect(status().isBadRequest()).andExpect(jsonPath("$.error").value("unit is required"));
        mvc.perform(post("/api/inventory").contentType("application/json")
            .content("{\"name\":\"Rice\",\"category\":\"Grains\",\"quantity\":2,\"unit\":\"2\",\"minThreshold\":1}"))
            .andExpect(status().isBadRequest()).andExpect(jsonPath("$.error").value("unit must describe a unit, not only a number"));
        mvc.perform(post("/api/inventory").contentType("application/json")
            .content("{\"name\":\"Rice\",\"category\":\"Grains\",\"quantity\":2,\"unit\":\"  bags  \",\"minThreshold\":1}"))
            .andExpect(status().isCreated()).andExpect(jsonPath("$.unit").value("bags"));
        mvc.perform(post("/api/inventory").contentType("application/json")
            .content("{\"name\":\"Rice\",\"category\":\"Grains\",\"quantity\":2,\"unit\":\"٢\",\"minThreshold\":1}"))
            .andExpect(status().isBadRequest()).andExpect(jsonPath("$.error").value("unit must describe a unit, not only a number"));
        mvc.perform(post("/api/inventory").contentType("application/json")
            .content("{\"name\":\"Rice\",\"category\":\"Grains\",\"quantity\":2,\"unit\":\"²\",\"minThreshold\":1}"))
            .andExpect(status().isBadRequest()).andExpect(jsonPath("$.error").value("unit must describe a unit, not only a number"));
        mvc.perform(post("/api/inventory").contentType("application/json")
            .content("{\"name\":\"Rice\",\"category\":\"Grains\",\"quantity\":2,\"unit\":\"Ⅳ\",\"minThreshold\":1}"))
            .andExpect(status().isBadRequest()).andExpect(jsonPath("$.error").value("unit must describe a unit, not only a number"));
        for (String numericLookingUnit : new String[]{"1,000", "1 000", "1/2", "−١٫٥"}) {
            mvc.perform(post("/api/inventory").contentType("application/json")
                .content("{\"name\":\"Rice\",\"category\":\"Grains\",\"quantity\":2,\"unit\":\"" + numericLookingUnit + "\",\"minThreshold\":1}"))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.error").value("unit must describe a unit, not only a number"));
        }
        mvc.perform(post("/api/inventory").contentType("application/json")
            .content("{\"name\":\"Rice\",\"category\":\"Grains\",\"quantity\":2,\"unit\":\"\ufeff\",\"minThreshold\":1}"))
            .andExpect(status().isBadRequest()).andExpect(jsonPath("$.error").value("unit is required"));
        mvc.perform(post("/api/inventory").contentType("application/json")
            .content("{\"name\":\"Rice\",\"category\":\"Grains\",\"quantity\":2,\"unit\":\"m²\",\"minThreshold\":1}"))
            .andExpect(status().isCreated()).andExpect(jsonPath("$.unit").value("m²"));
        mvc.perform(post("/api/inventory").contentType("application/json")
            .content("{\"name\":\"Rice\",\"category\":\"Grains\",\"quantity\":2,\"unit\":\"\u00a0\u00a0\",\"minThreshold\":1}"))
            .andExpect(status().isBadRequest()).andExpect(jsonPath("$.error").value("unit is required"));
        mvc.perform(post("/api/inventory").contentType("application/json")
            .content("{\"name\":\"Rice\",\"category\":\"Grains\",\"quantity\":2,\"unit\":\"\u20032\u2003\",\"minThreshold\":1}"))
            .andExpect(status().isBadRequest()).andExpect(jsonPath("$.error").value("unit must describe a unit, not only a number"));
    }
    @Test void stockFiltersMatchDistinctDashboardCounts() throws Exception {
        item("Empty milk", 0);
        item("Low milk", 1);
        item("Full milk", 3);
        mvc.perform(get("/api/inventory/stats"))
            .andExpect(jsonPath("$.lowStockCount").value(1))
            .andExpect(jsonPath("$.outOfStockCount").value(1));
        mvc.perform(get("/api/inventory").param("lowStock", "true"))
            .andExpect(jsonPath("$[0].name").value("Low milk"))
            .andExpect(jsonPath("$.length()").value(1));
        mvc.perform(get("/api/inventory").param("outOfStock", "true").param("category", "Dairy"))
            .andExpect(jsonPath("$[0].name").value("Empty milk"))
            .andExpect(jsonPath("$.length()").value(1));
        mvc.perform(get("/api/inventory").param("outOfStock", "true").param("category", "Produce"))
            .andExpect(content().json("[]"));
    }
    @Test void inventoryAdjustmentsAreAtomicAndValidateStock() throws Exception {
        long id = PantryService.id(item("Adjustment test", 5));
        mvc.perform(post("/api/inventory/" + id + "/adjust").header("Idempotency-Key", "adjust-consume-1").contentType("application/json")
            .content("{\"operation\":\"consume\",\"amount\":2}"))
            .andExpect(status().isOk()).andExpect(jsonPath("$.quantity").value(3));
        mvc.perform(post("/api/inventory/" + id + "/adjust").header("Idempotency-Key", "adjust-restock-1").contentType("application/json")
            .content("{\"operation\":\"restock\",\"amount\":4}"))
            .andExpect(status().isOk()).andExpect(jsonPath("$.quantity").value(7));
        mvc.perform(post("/api/inventory/" + id + "/adjust").header("Idempotency-Key", "adjust-overconsume-1").contentType("application/json")
            .content("{\"operation\":\"consume\",\"amount\":8}"))
            .andExpect(status().isBadRequest()).andExpect(jsonPath("$.error").value("amount exceeds available stock"));
        assertThat(PantryService.number(service.inventory(id), "quantity")).isEqualTo(7);
    }
    @Test void inventoryAdjustmentRejectsInvalidRequests() throws Exception {
        long id = PantryService.id(item("Invalid adjustment", 5));
        mvc.perform(post("/api/inventory/" + id + "/adjust").header("Idempotency-Key", "adjust-invalid-1").contentType("application/json")
            .content("{\"operation\":\"consume\",\"amount\":0}"))
            .andExpect(status().isBadRequest()).andExpect(jsonPath("$.error").value("amount must be greater than zero"));
        mvc.perform(post("/api/inventory/" + id + "/adjust").header("Idempotency-Key", "adjust-invalid-2").contentType("application/json")
            .content("{\"operation\":\"replace\",\"amount\":1}"))
            .andExpect(status().isBadRequest()).andExpect(jsonPath("$.error").value("operation must be consume or restock"));
        mvc.perform(post("/api/inventory/999999/adjust").header("Idempotency-Key", "adjust-missing-1").contentType("application/json")
            .content("{\"operation\":\"restock\",\"amount\":1}"))
            .andExpect(status().isNotFound());
    }
    @Test void repeatedAdjustmentKeyDoesNotApplyTwiceAndConflictsAreRejected() throws Exception {
        long id = PantryService.id(item("Retry-safe adjustment", 5));
        mvc.perform(post("/api/inventory/" + id + "/adjust").header("Idempotency-Key", "retry-1").contentType("application/json")
            .content("{\"operation\":\"consume\",\"amount\":2}"))
            .andExpect(status().isOk()).andExpect(jsonPath("$.quantity").value(3));
        mvc.perform(post("/api/inventory/" + id + "/adjust").header("Idempotency-Key", "retry-1").contentType("application/json")
            .content("{\"operation\":\"consume\",\"amount\":2}"))
            .andExpect(status().isOk()).andExpect(jsonPath("$.quantity").value(3));
        mvc.perform(post("/api/inventory/" + id + "/adjust").header("Idempotency-Key", "retry-1").contentType("application/json")
            .content("{\"operation\":\"restock\",\"amount\":2}"))
            .andExpect(status().isBadRequest()).andExpect(jsonPath("$.error").value("Idempotency-Key was already used for a different adjustment"));
        assertThat(repository.query("SELECT * FROM inventory_adjustments WHERE inventory_item_id=?", id)).hasSize(1);
    }
    @Test void adjustmentRequiresAnIdempotencyKey() throws Exception {
        long id = PantryService.id(item("Missing key", 5));
        mvc.perform(post("/api/inventory/" + id + "/adjust").contentType("application/json")
            .content("{\"operation\":\"restock\",\"amount\":1}"))
            .andExpect(status().isBadRequest());
    }
    @Test void directInventoryEditInvalidatesPendingUndo() {
        long id = PantryService.id(item("Manual edit", 5));
        service.adjustInventory(id, "manual-edit-undo", Map.of("operation", "consume", "amount", 2));

        service.saveInventory(id, Map.of("quantity", 4));

        assertThatThrownBy(() -> service.undoInventoryAdjustment(id, Map.of("idempotencyKey", "manual-edit-undo")))
            .hasMessageContaining("Inventory changed after this adjustment");
        assertThat(PantryService.number(service.inventory(id), "quantity")).isEqualTo(4);
    }
    @Test void notificationIsDeliveredOnlyAfterCommit() {
        clearInvocations(notifications);
        long id = PantryService.id(item("Event test",0));
        verify(notifications, never()).changed(any());
        TestTransaction.flagForCommit();
        TestTransaction.end();
        verify(notifications).changed(new PantryService.PantryChanged("inventory_changed", id));
        repository.execute("DELETE FROM inventory_items WHERE id=?", id);
    }
    @Test void rollbackDoesNotDeliverNotification() {
        clearInvocations(notifications);
        item("Rolled back",0);
        TestTransaction.flagForRollback();
        TestTransaction.end();
        verify(notifications, never()).changed(any());
    }
    @Test void inventoryResponseMatchesReactContract() throws Exception {
        mvc.perform(post("/api/inventory").contentType("application/json")
            .content("{\"name\":\"Rice\",\"category\":\"Grains\",\"quantity\":3,\"unit\":\"kg\",\"minThreshold\":1,\"expiresAt\":\"2027-01-01\"}"))
            .andExpect(status().isCreated()).andExpect(jsonPath("$.id").isNumber())
            .andExpect(jsonPath("$.minThreshold").value(1))
            .andExpect(jsonPath("$.expiresAt").value("2027-01-01"))
            .andExpect(jsonPath("$.createdAt").isString());
    }
}
