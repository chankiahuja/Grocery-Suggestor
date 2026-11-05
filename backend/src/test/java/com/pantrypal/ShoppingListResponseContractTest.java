package com.pantrypal;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.security.authentication.TestingAuthenticationToken;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.transaction.annotation.Transactional;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc(addFilters = false)
@Transactional
class ShoppingListResponseContractTest {
    @Autowired MockMvc mvc;
    @Autowired ObjectMapper objectMapper;
    @Autowired PantryRepository repository;
    @Autowired PantryService service;

    @Test
    void shoppingListResponsesExposeOnlyPublicOwnershipIndependentFields() throws Exception {
        long accountId = repository.insert("accounts", Map.of(
            "email", "shopping-response-" + System.nanoTime() + "@example.com",
            "display_name", "Shopping response test"));
        var principal = new TestingAuthenticationToken(Long.toString(accountId), null);

        JsonNode created = body(mvc.perform(post("/api/shopping-lists")
                .principal(principal)
                .contentType("application/json")
                .content("{\"name\":\"Weekly groceries\"}"))
            .andExpect(status().isCreated())
            .andReturn());
        assertNoAccountId(created);
        assertHasFields(created, "id", "name", "itemCount", "purchasedCount", "createdAt", "updatedAt");
        long listId = created.get("id").asLong();

        JsonNode addedItem = body(mvc.perform(post("/api/shopping-lists/" + listId + "/items")
                .principal(principal)
                .contentType("application/json")
                .content("{\"name\":\"Tea\",\"category\":\"Other\",\"quantity\":2,\"unit\":\"box\",\"notes\":\"Black tea\"}"))
            .andExpect(status().isCreated())
            .andReturn());
        assertNoAccountId(addedItem);
        assertFields(addedItem, "id", "shoppingListId", "inventoryItemId", "name", "category",
            "quantity", "unit", "purchased", "notes");
        long itemId = addedItem.get("id").asLong();

        JsonNode updatedItem = body(mvc.perform(patch("/api/shopping-lists/" + listId + "/items/" + itemId)
                .principal(principal)
                .contentType("application/json")
                .content("{\"quantity\":3,\"purchased\":true}"))
            .andExpect(status().isOk())
            .andReturn());
        assertNoAccountId(updatedItem);
        assertFields(updatedItem, "id", "shoppingListId", "inventoryItemId", "name", "category",
            "quantity", "unit", "purchased", "notes");

        JsonNode list = body(mvc.perform(get("/api/shopping-lists/" + listId).principal(principal))
            .andExpect(status().isOk())
            .andReturn());
        assertNoAccountId(list);
        assertFields(list, "id", "name", "items", "createdAt", "updatedAt");
        assertFields(list.get("items").get(0), "id", "shoppingListId", "inventoryItemId", "name",
            "category", "quantity", "unit", "purchased", "notes");

        JsonNode lists = body(mvc.perform(get("/api/shopping-lists").principal(principal))
            .andExpect(status().isOk())
            .andReturn());
        assertNoAccountId(lists);
        assertThat(lists).hasSize(1);
        assertFields(lists.get(0), "id", "name", "itemCount", "purchasedCount", "createdAt", "updatedAt");

        var inventoryItem = service.saveInventory(accountId, null, Map.of(
            "name", "Rice", "category", "Grains", "quantity", 0, "unit", "kg", "minThreshold", 1));
        JsonNode generated = body(mvc.perform(post("/api/suggestions/generate-list")
                .principal(principal)
                .contentType("application/json")
                .content("{\"items\":[{\"inventoryItemId\":" + PantryService.id(inventoryItem) + ",\"quantity\":2}]}"))
            .andExpect(status().isCreated())
            .andReturn());
        assertNoAccountId(generated);
        assertFields(generated, "id", "name", "items", "createdAt", "updatedAt");
        assertFields(generated.get("items").get(0), "id", "shoppingListId", "inventoryItemId", "name",
            "category", "quantity", "unit", "purchased", "notes");
    }

    private JsonNode body(MvcResult result) throws Exception {
        return objectMapper.readTree(result.getResponse().getContentAsString());
    }

    private void assertNoAccountId(JsonNode node) {
        if (node.isObject()) {
            assertThat(node.has("accountId")).isFalse();
            node.elements().forEachRemaining(this::assertNoAccountId);
        } else if (node.isArray()) {
            node.elements().forEachRemaining(this::assertNoAccountId);
        }
    }

    private void assertHasFields(JsonNode node, String... fields) {
        for (String field : fields) assertThat(node.has(field)).isTrue();
    }

    private void assertFields(JsonNode node, String... fields) {
        Set<String> actual = new HashSet<>();
        node.fieldNames().forEachRemaining(actual::add);
        assertThat(actual).containsExactlyInAnyOrder(fields);
    }
}
