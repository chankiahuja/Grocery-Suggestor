package com.pantrypal;

import java.util.Map;
import java.time.LocalDate;
import java.time.ZoneOffset;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.transaction.annotation.Transactional;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

@SpringBootTest
@Transactional
class AccountIsolationTest {
    @Autowired PantryService service;
    @Autowired PantryRepository repository;

    @Test
    void inventoryAndShoppingListsAreIsolatedByAccount() {
        long alice = repository.insert("accounts", Map.of("email", "alice-isolation@example.com", "display_name", "Alice"));
        long bob = repository.insert("accounts", Map.of("email", "bob-isolation@example.com", "display_name", "Bob"));

        long aliceItem = PantryService.id(service.saveInventory(alice, null,
            Map.of("name", "Alice Rice", "category", "Grains", "quantity", 2, "unit", "kg", "minThreshold", 1,
                "expiresAt", LocalDate.now(ZoneOffset.UTC).plusDays(1).toString())));
        service.saveInventory(bob, null,
            Map.of("name", "Bob Beans", "category", "Canned", "quantity", 4, "unit", "cans", "minThreshold", 1));

        assertThat(service.inventory(Long.valueOf(alice))).hasSize(1);
        Map<String,Object> aliceRow = service.inventory(Long.valueOf(alice)).get(0);
        assertThat(aliceRow.get("name")).isEqualTo("Alice Rice");
        assertThat(service.suggestions(alice)).extracting(suggestion -> suggestion.get("name"))
            .containsExactly("Alice Rice");
        assertThat(service.inventory(Long.valueOf(bob))).hasSize(1);
        Map<String,Object> bobRow = service.inventory(Long.valueOf(bob)).get(0);
        assertThat(bobRow.get("name")).isEqualTo("Bob Beans");
        assertThat(service.suggestions(bob)).isEmpty();
        assertThatThrownBy(() -> service.inventory(bob, aliceItem))
            .isInstanceOf(org.springframework.web.server.ResponseStatusException.class)
            .hasMessageContaining("Resource not found");

        long aliceList = PantryService.id(service.createList(alice, Map.of("name", "Alice List")));
        service.addItem(alice, aliceList, Map.of("name", "Alice Rice", "category", "Grains", "quantity", 1, "unit", "kg", "inventoryItemId", aliceItem));
        assertThat(service.lists(alice)).hasSize(1);
        assertThat(service.lists(bob)).isEmpty();
        assertThatThrownBy(() -> service.list(bob, aliceList))
            .isInstanceOf(org.springframework.web.server.ResponseStatusException.class)
            .hasMessageContaining("Resource not found");
    }

    @Test
    void accountCannotUpdateAnotherAccountsInventory() {
        long alice = repository.insert("accounts", Map.of("email", "alice-update@example.com", "display_name", "Alice"));
        long bob = repository.insert("accounts", Map.of("email", "bob-update@example.com", "display_name", "Bob"));
        long item = PantryService.id(service.saveInventory(alice, null,
            Map.of("name", "Alice Flour", "category", "Baking", "quantity", 1, "unit", "kg", "minThreshold", 1)));

        assertThatThrownBy(() -> service.saveInventory(bob, item, Map.of("notes", "cross-account mutation")))
            .isInstanceOf(org.springframework.web.server.ResponseStatusException.class)
            .hasMessageContaining("Resource not found");
        assertThat(service.inventory(alice, item).get("notes")).isNull();
    }
}
