package com.pantrypal;

import java.time.*;
import java.util.*;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.http.HttpStatus;

@Service
@Transactional
public class PantryService {
    final PantryRepository repo;
    final ApplicationEventPublisher events;
    public record PantryChanged(String type, Long inventoryItemId) {}
    public PantryService(PantryRepository repo, ApplicationEventPublisher events) { this.repo = repo; this.events = events; }
    static double number(Map<String,Object> row, String key) { return ((Number) row.get(key)).doubleValue(); }
    static long id(Map<String,Object> row) { return ((Number) row.get("id")).longValue(); }
    static void bad(String reason) { throw new ResponseStatusException(HttpStatus.BAD_REQUEST, reason); }

    // Explicit allowlist: client keys never become SQL identifiers.
    Map<String,Object> fields(Map<String,Object> body, boolean create, boolean inventory) {
        Map<String,Object> result = new LinkedHashMap<>();
        for (String key : List.of("name", "category", "quantity", "unit", "minThreshold", "expiresAt", "notes", "inventoryItemId", "purchased")) {
            if (!inventory && List.of("minThreshold", "expiresAt").contains(key)) continue;
            if (inventory && List.of("inventoryItemId", "purchased").contains(key)) continue;
            if (!body.containsKey(key)) continue;
            Object value = body.get(key);
            if (List.of("name", "category", "unit").contains(key) && (!(value instanceof String s) || s.isBlank())) bad(key + " is required");
            if (List.of("quantity", "minThreshold").contains(key) && (!(value instanceof Number n) || !Double.isFinite(n.doubleValue()) || n.doubleValue() < 0)) bad(key + " must be non-negative");
            if (key.equals("purchased") && !(value instanceof Boolean)) bad("purchased must be boolean");
            if (key.equals("inventoryItemId") && value != null && (!(value instanceof Number n) || n.longValue() <= 0 || n.doubleValue() != n.longValue())) bad("Invalid inventory item ID");
            if (key.equals("notes") && value != null && !(value instanceof String)) bad("notes must be text");
            if (key.equals("expiresAt") && value != null) {
                try { value = LocalDate.parse(value.toString()); } catch (RuntimeException e) { bad("expiresAt must be YYYY-MM-DD"); }
            }
            String column = key.replaceAll("([A-Z])", "_$1").toLowerCase(Locale.ROOT);
            result.put(column, value);
        }
        if (create) for (String key : inventory ? List.of("name", "category", "quantity", "unit", "min_threshold") : List.of("name", "category", "quantity", "unit")) {
            if (!result.containsKey(key)) bad(key + " is required");
        }
        return result;
    }

    public List<Map<String,Object>> inventory() { return repo.query("SELECT * FROM inventory_items ORDER BY name"); }
    public Map<String,Object> inventory(long id) { return repo.one("SELECT * FROM inventory_items WHERE id=?", id); }
    public Map<String,Object> saveInventory(Long id, Map<String,Object> body) {
        var values = fields(body, id == null, true);
        if (id == null) id = repo.insert("inventory_items", values);
        else { inventory(id); values.put("updated_at", OffsetDateTime.now(ZoneOffset.UTC)); repo.update("inventory_items", id, values); }
        events.publishEvent(new PantryChanged("inventory_changed", id));
        return inventory(id);
    }
    public void deleteInventory(long id) { inventory(id); repo.execute("DELETE FROM inventory_items WHERE id=?", id); events.publishEvent(new PantryChanged("inventory_changed", id)); }
    static boolean expiring(Map<String,Object> item) {
        if (item.get("expiresAt") == null) return false;
        var date = LocalDate.parse(item.get("expiresAt").toString());
        var today = LocalDate.now(ZoneOffset.UTC);
        return !date.isBefore(today) && !date.isAfter(today.plusDays(7));
    }
    public List<Map<String,Object>> suggestions() {
        var result = new ArrayList<Map<String,Object>>();
        for (var item : inventory()) {
            double quantity = number(item, "quantity"), threshold = number(item, "minThreshold");
            String urgency = quantity == 0 ? "critical" : quantity <= threshold ? "low" : expiring(item) ? "expiring_soon" : null;
            if (urgency == null) continue;
            Map<String,Object> suggestion = new LinkedHashMap<>();
            suggestion.put("inventoryItemId", item.get("id"));
            for (String key : List.of("name", "category", "minThreshold", "unit")) suggestion.put(key, item.get(key));
            suggestion.put("currentQuantity", quantity); suggestion.put("urgency", urgency);
            suggestion.put("reason", urgency.equals("critical") ? "Out of stock" : urgency.equals("low") ? quantity + " " + item.get("unit") + " left (minimum is " + threshold + ")" : "Expires on " + item.get("expiresAt"));
            result.add(suggestion);
        }
        result.sort(Comparator.comparingInt(s -> List.of("critical", "low", "expiring_soon").indexOf(s.get("urgency"))));
        return result;
    }
    public Map<String,Object> stats() {
        var items = inventory();
        Map<String,Long> categories = new TreeMap<>();
        items.forEach(i -> categories.merge(i.get("category").toString(), 1L, Long::sum));
        return Map.of("totalItems", items.size(), "outOfStockCount", items.stream().filter(i -> number(i,"quantity") == 0).count(),
            "lowStockCount", items.stream().filter(i -> number(i,"quantity") > 0 && number(i,"quantity") <= number(i,"minThreshold")).count(),
            "expiringCount", items.stream().filter(PantryService::expiring).count(),
            "categoryBreakdown", categories.entrySet().stream().map(e -> Map.of("category",e.getKey(),"count",e.getValue())).toList());
    }
    public Map<String,Object> list(long id) {
        var list = repo.one("SELECT * FROM shopping_lists WHERE id=?", id);
        list.put("items", repo.query("SELECT * FROM shopping_list_items WHERE shopping_list_id=? ORDER BY id", id));
        return list;
    }
    public List<Map<String,Object>> lists() {
        var lists = repo.query("SELECT * FROM shopping_lists ORDER BY created_at");
        for (var list : lists) {
            var items = repo.query("SELECT * FROM shopping_list_items WHERE shopping_list_id=?", id(list));
            list.put("itemCount", items.size()); list.put("purchasedCount", items.stream().filter(i -> Boolean.TRUE.equals(i.get("purchased"))).count());
        }
        return lists;
    }
    public Map<String,Object> createList(Map<String,Object> body) {
        if (!(body.get("name") instanceof String name) || name.isBlank()) bad("name is required");
        long id = repo.insert("shopping_lists", Map.of("name", body.get("name")));
        var list = repo.one("SELECT * FROM shopping_lists WHERE id=?", id);
        list.put("itemCount", 0); list.put("purchasedCount", 0); return list;
    }
    public void deleteList(long id) { list(id); repo.execute("DELETE FROM shopping_lists WHERE id=?", id); }
    public Map<String,Object> addItem(long listId, Map<String,Object> body) {
        list(listId); var values = fields(body, true, false);
        values.remove("purchased");
        if (values.get("inventory_item_id") != null) inventory(((Number)values.get("inventory_item_id")).longValue());
        values.put("shopping_list_id", listId);
        long id = repo.insert("shopping_list_items", values); return repo.one("SELECT * FROM shopping_list_items WHERE id=?", id);
    }
    public Map<String,Object> updateItem(long listId, long id, Map<String,Object> body) {
        repo.one("SELECT * FROM shopping_list_items WHERE id=? AND shopping_list_id=?", id, listId);
        var values = fields(body, false, false); values.keySet().retainAll(Set.of("quantity", "notes", "purchased"));
        repo.update("shopping_list_items", id, values); return repo.one("SELECT * FROM shopping_list_items WHERE id=?", id);
    }
    public void deleteItem(long listId, long id) {
        repo.one("SELECT * FROM shopping_list_items WHERE id=? AND shopping_list_id=?", id, listId);
        repo.execute("DELETE FROM shopping_list_items WHERE id=?", id);
    }
    public Map<String,Object> generateList() { return generateList(Map.of()); }
    public Map<String,Object> generateList(Map<String,Object> request) {
        var suggestions = suggestions().stream().filter(s -> !s.get("urgency").equals("expiring_soon")).toList();
        if (suggestions.isEmpty()) bad("No low-stock suggestions are available.");
        var selected = new LinkedHashMap<Long, Map<String,Object>>();
        Object requestedItems = request.get("items");
        if (requestedItems == null) {
            for (var suggestion : suggestions) selected.put(((Number) suggestion.get("inventoryItemId")).longValue(), suggestion);
        } else if (requestedItems instanceof List<?> items) {
            for (Object raw : items) {
                if (!(raw instanceof Map<?,?>)) bad("items must contain objects");
                Map<?,?> rawItem = (Map<?,?>) raw;
                Object inventoryItemId = rawItem.get("inventoryItemId");
                Object quantity = rawItem.get("quantity");
                if (!(inventoryItemId instanceof Number) || !(quantity instanceof Number)) bad("Invalid generated item");
                Number itemId = (Number) inventoryItemId;
                Number amount = (Number) quantity;
                if (!Double.isFinite(amount.doubleValue()) || amount.doubleValue() < 0) bad("Invalid generated item");
                if (itemId.doubleValue() != itemId.longValue() || itemId.longValue() <= 0) bad("Invalid generated item");
                long id = itemId.longValue();
                var suggestion = suggestions.stream().filter(s -> ((Number) s.get("inventoryItemId")).longValue() == id).findFirst().orElse(null);
                if (suggestion == null) bad("Selected item is no longer a low-stock suggestion");
                if (amount.doubleValue() == 0) continue;
                var selectedSuggestion = new LinkedHashMap<>(suggestion);
                selectedSuggestion.put("quantity", amount.doubleValue());
                selected.merge(id, selectedSuggestion, (existing, duplicate) -> {
                    existing.put("quantity", number(existing, "quantity") + number(duplicate, "quantity"));
                    return existing;
                });
            }
        } else bad("items must be an array");
        if (selected.isEmpty()) bad("Select at least one shopping item.");
        long listId = id(createList(Map.of("name", "Low-stock shopping list")));
        for (var suggestion : selected.values()) {
            var body = new LinkedHashMap<>(suggestion);
            body.putIfAbsent("quantity", Math.max(number(suggestion,"minThreshold") - number(suggestion,"currentQuantity"), 1));
            body.put("notes", suggestion.get("reason")); addItem(listId, body);
        }
        return list(listId);
    }
    public Map<String,Object> purchase(long listId) {
        repo.one("SELECT * FROM shopping_lists WHERE id=? FOR UPDATE", listId);
        var items = repo.query("SELECT * FROM shopping_list_items WHERE shopping_list_id=? AND purchased=TRUE AND restocked=FALSE AND inventory_item_id IS NOT NULL", listId);
        for (var item : items) {
            repo.execute("UPDATE inventory_items SET quantity=quantity+?, updated_at=CURRENT_TIMESTAMP WHERE id=?", item.get("quantity"), item.get("inventoryItemId"));
            repo.execute("UPDATE shopping_list_items SET restocked=TRUE WHERE id=?", item.get("id"));
        }
        events.publishEvent(new PantryChanged("purchase_completed", null));
        return Map.of("purchasedCount", items.size(), "updatedInventoryItems", items.size());
    }
}
