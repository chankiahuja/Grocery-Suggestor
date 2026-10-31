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
@AutoConfigureMockMvc
@Transactional
class PantryFlowTest {
    @Autowired PantryService service;
    @Autowired PantryRepository repository;
    @Autowired MockMvc mvc;
    @MockitoSpyBean NotificationEvents notifications;
    Map<String,Object> item(String name, double quantity) {
        return service.saveInventory(null, Map.of("name",name,"category","Dairy","quantity",quantity,"unit","litres","minThreshold",2));
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
    @Test void apiValidationAndCombinedFilters() throws Exception {
        item("Milk",0);
        mvc.perform(get("/api/inventory").param("category","Produce").param("lowStock","true")).andExpect(status().isOk()).andExpect(content().json("[]"));
        mvc.perform(post("/api/inventory").contentType("application/json").content("{\"name\":\"Milk\",\"quantity\":-1}")).andExpect(status().isBadRequest()).andExpect(jsonPath("$.error").exists());
        mvc.perform(get("/api/inventory/999999")).andExpect(status().isNotFound());
        mvc.perform(get("/api/healthz")).andExpect(status().isOk()).andExpect(jsonPath("$.status").value("ok"));
    }
    @Test void inventoryAdjustmentsAreAtomicAndValidateStock() throws Exception {
        long id = PantryService.id(item("Adjustment test", 5));
        mvc.perform(post("/api/inventory/" + id + "/adjust").contentType("application/json")
            .content("{\"operation\":\"consume\",\"amount\":2}"))
            .andExpect(status().isOk()).andExpect(jsonPath("$.quantity").value(3));
        mvc.perform(post("/api/inventory/" + id + "/adjust").contentType("application/json")
            .content("{\"operation\":\"restock\",\"amount\":4}"))
            .andExpect(status().isOk()).andExpect(jsonPath("$.quantity").value(7));
        mvc.perform(post("/api/inventory/" + id + "/adjust").contentType("application/json")
            .content("{\"operation\":\"consume\",\"amount\":8}"))
            .andExpect(status().isBadRequest()).andExpect(jsonPath("$.error").value("amount exceeds available stock"));
        assertThat(PantryService.number(service.inventory(id), "quantity")).isEqualTo(7);
    }
    @Test void inventoryAdjustmentRejectsInvalidRequests() throws Exception {
        long id = PantryService.id(item("Invalid adjustment", 5));
        mvc.perform(post("/api/inventory/" + id + "/adjust").contentType("application/json")
            .content("{\"operation\":\"consume\",\"amount\":0}"))
            .andExpect(status().isBadRequest()).andExpect(jsonPath("$.error").value("amount must be greater than zero"));
        mvc.perform(post("/api/inventory/" + id + "/adjust").contentType("application/json")
            .content("{\"operation\":\"replace\",\"amount\":1}"))
            .andExpect(status().isBadRequest()).andExpect(jsonPath("$.error").value("operation must be consume or restock"));
        mvc.perform(post("/api/inventory/999999/adjust").contentType("application/json")
            .content("{\"operation\":\"restock\",\"amount\":1}"))
            .andExpect(status().isNotFound());
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
