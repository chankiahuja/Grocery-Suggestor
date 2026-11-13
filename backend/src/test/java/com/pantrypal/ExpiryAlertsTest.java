package com.pantrypal;

import java.time.*;
import java.util.*;
import java.util.concurrent.atomic.AtomicLong;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.transaction.annotation.Transactional;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

@SpringBootTest
@Transactional
class ExpiryAlertsTest {
    @Autowired PantryService service;
    @Autowired PantryRepository repo;
    @MockitoBean Clock clock;
    final AtomicLong now = new AtomicLong();
    @BeforeEach void setup() {
        now.set(Instant.parse("2026-11-08T23:59:59Z").toEpochMilli());
        when(clock.millis()).thenAnswer(call -> now.get());
    }
    private long item(Long owner, String name, double quantity, String expiry) {
        return PantryService.id(service.saveInventory(owner, null, Map.of("name", name, "category", "Dairy",
            "quantity", quantity, "unit", "litres", "minThreshold", 2, "expiresAt", expiry)));
    }
    @Test void expiredAndUpcomingAreDistinctAndZeroStockDoesNotCreateExpiredAlerts() {
        item(null, "Expired", 5, "2026-11-07");
        item(null, "Expired and low", 1, "2026-11-07");
        item(null, "Empty", 0, "2026-11-07");
        item(null, "Today", 5, "2026-11-08");
        item(null, "Day seven", 5, "2026-11-15");
        item(null, "Day eight", 5, "2026-11-16");
        assertThat(service.stats()).containsEntry("expiredCount", 2L).containsEntry("expiringCount", 2L);
        var alerts = service.suggestions();
        assertThat(alerts.stream().filter(a -> a.get("urgency").equals("expired"))).hasSize(2);
        assertThat(alerts.stream().filter(a -> a.get("name").equals("Expired and low")))
            .extracting(a -> a.get("urgency")).containsExactly("expired");
        assertThat(alerts.stream().filter(a -> a.get("name").equals("Expired and low")).findFirst().orElseThrow().get("reason"))
            .asString().contains("Expired on 2026-11-07", "minimum is 2.0 litres");
        assertThat(alerts.stream().filter(a -> a.get("name").equals("Empty")))
            .extracting(a -> a.get("urgency")).containsExactly("critical");
        assertThat(alerts.stream().filter(a -> a.get("name").equals("Day eight"))).isEmpty();
        assertThat(alerts.get(0).get("reason")).isEqualTo("Expired on 2026-11-07");
    }
    @Test void expiryTakesPriorityWhileLowStockRemainsInTheCombinedReason() {
        item(null, "Expiring low", 1.5, "2026-11-10");
        var alert = service.suggestions().get(0);
        assertThat(alert).containsEntry("urgency", "expiring_soon");
        assertThat(alert.get("reason")).asString().contains("Expires on 2026-11-10", "minimum is 2.0 litres");
    }
    @Test void zeroQuantityDoesNotCountAsExpiringOrCarryExpiryAlert() {
        item(null, "Empty future", 0, "2026-11-10");
        assertThat(service.stats()).containsEntry("expiringCount", 0L);
        assertThat(service.suggestions()).hasSize(1);
        assertThat(service.suggestions().get(0)).containsEntry("urgency", "critical");
    }
    @Test void expiryOnlyAlertsCannotGeneratePurchasesAndOverlappingLowStockAppearsOnce() {
        long expired = item(null, "Expired", 5, "2026-11-07");
        assertThatThrownBy(service::generateList).hasMessageContaining("No low-stock");
        assertThatThrownBy(() -> service.generateList(Map.of("items", List.of(Map.of("inventoryItemId", expired, "quantity", 1)))))
            .isInstanceOf(org.springframework.web.server.ResponseStatusException.class);
        long low = item(null, "Expired low", 1, "2026-11-07");
        var list = service.generateList();
        var rows = repo.query("SELECT * FROM shopping_list_items WHERE shopping_list_id=?", PantryService.id(list));
        assertThat(rows).hasSize(1);
        assertThat(rows.get(0).get("inventoryItemId")).isEqualTo(low);
    }
    @Test void correctingDeletingAndUsingUpInventoryClearsExpiredAttention() {
        long id = item(null, "Milk", 5, "2026-11-07");
        service.saveInventory(id, Map.of("expiresAt", "2026-12-01"));
        assertThat(service.suggestions()).isEmpty();
        service.saveInventory(id, Map.of("expiresAt", "2026-11-07", "quantity", 0));
        assertThat(service.stats().get("expiredCount")).isEqualTo(0L);
        service.deleteInventory(id);
        assertThat(service.suggestions()).isEmpty();
    }
    @Test void rolloverChangesTodayIntoExpiredWithoutAnInventoryEdit() {
        item(null, "Milk", 5, "2026-11-08");
        assertThat(service.suggestions()).extracting(a -> a.get("urgency")).containsExactly("expiring_soon");
        now.addAndGet(1000);
        assertThat(service.suggestions()).extracting(a -> a.get("urgency")).containsExactly("expired");
        assertThat(service.stats()).containsEntry("expiredCount", 1L).containsEntry("expiringCount", 0L);
    }
    @Test void alertsAndCountsAreScopedToTheirOwner() {
        repo.execute("INSERT INTO accounts(email,display_name) VALUES ('expiry-owner@example.com','Owner')");
        repo.execute("INSERT INTO accounts(email,display_name) VALUES ('expiry-other@example.com','Other')");
        long owner = ((Number) repo.one("SELECT id FROM accounts WHERE email='expiry-owner@example.com'").get("id")).longValue();
        long other = ((Number) repo.one("SELECT id FROM accounts WHERE email='expiry-other@example.com'").get("id")).longValue();
        long id = item(owner, "Private milk", 5, "2026-11-07");
        assertThat(service.suggestions(owner)).hasSize(1);
        assertThat(service.stats(owner).get("expiredCount")).isEqualTo(1L);
        assertThat(service.suggestions(other)).isEmpty();
        assertThat(service.stats(other).get("expiredCount")).isEqualTo(0L);
        assertThatThrownBy(() -> service.inventory(other, id)).isInstanceOf(org.springframework.web.server.ResponseStatusException.class);
    }
}
