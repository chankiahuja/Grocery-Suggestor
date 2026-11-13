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
    private static final int MAX_UNIT_LENGTH = 64;
    final PantryRepository repo;
    final ApplicationEventPublisher events;
    final Clock clock;
    public record PantryChanged(String type, Long inventoryItemId, Long accountId) {
        public PantryChanged(String type, Long inventoryItemId) { this(type, inventoryItemId, null); }
    }
    public PantryService(PantryRepository repo, ApplicationEventPublisher events, Clock clock) { this.repo = repo; this.events = events; this.clock = clock; }
    static double number(Map<String,Object> row, String key) { return ((Number) row.get(key)).doubleValue(); }
    static long id(Map<String,Object> row) { return ((Number) row.get("id")).longValue(); }
    static void bad(String reason) { throw new ResponseStatusException(HttpStatus.BAD_REQUEST, reason); }
    static String trimUnit(String value) {
        int start = 0;
        int end = value.length();
        while (start < end) {
            int codePoint = value.codePointAt(start);
            if (!Character.isWhitespace(codePoint) && !Character.isSpaceChar(codePoint) && codePoint != '\uFEFF') break;
            start += Character.charCount(codePoint);
        }
        while (end > start) {
            int codePoint = value.codePointBefore(end);
            if (!Character.isWhitespace(codePoint) && !Character.isSpaceChar(codePoint) && codePoint != '\uFEFF') break;
            end -= Character.charCount(codePoint);
        }
        return value.substring(start, end);
    }
    static boolean numericLookingUnit(String value) {
        boolean hasNumber = false;
        boolean hasLetter = false;
        for (int offset = 0; offset < value.length();) {
            int codePoint = value.codePointAt(offset);
            int type = Character.getType(codePoint);
            if (type == Character.DECIMAL_DIGIT_NUMBER
                || type == Character.LETTER_NUMBER
                || type == Character.OTHER_NUMBER) hasNumber = true;
            if (Character.isLetter(codePoint)) hasLetter = true;
            offset += Character.charCount(codePoint);
        }
        return hasNumber && !hasLetter;
    }
    public List<Long> accountIds() { return repo.accountIds(); }
    private void lockOwner(Long ownerId) {
        if (ownerId != null && repo.query("SELECT id FROM accounts WHERE id=? FOR UPDATE", ownerId).isEmpty()) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Sign in to continue");
        }
    }

    // Explicit allowlist: client keys never become SQL identifiers.
    Map<String,Object> fields(Map<String,Object> body, boolean create, boolean inventory) {
        Map<String,Object> result = new LinkedHashMap<>();
        for (String key : List.of("name", "category", "quantity", "unit", "minThreshold", "expiresAt", "notes", "inventoryItemId", "purchased")) {
            if (!inventory && List.of("minThreshold", "expiresAt").contains(key)) continue;
            if (inventory && List.of("inventoryItemId", "purchased").contains(key)) continue;
            if (!body.containsKey(key)) continue;
            Object value = body.get(key);
            if (List.of("name", "category", "unit").contains(key) && (!(value instanceof String s) || s.isBlank())) bad(key + " is required");
            if (inventory && key.equals("unit")) {
                String unit = trimUnit((String) value);
                if (unit.isEmpty()) bad("unit is required");
                if (unit.length() > MAX_UNIT_LENGTH) bad("unit must be 64 characters or fewer");
                if (numericLookingUnit(unit)) bad("unit must describe a unit, not only a number");
                value = unit;
            }
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

    private static final String INVENTORY_COLUMNS = "id,name,category,quantity,unit,min_threshold,expires_at,notes,created_at,updated_at";
    private static final String SHOPPING_LIST_COLUMNS = "id,name,created_at,updated_at";
    private static final String SHOPPING_LIST_ITEM_COLUMNS = "id,shopping_list_id,inventory_item_id,name,category,quantity,unit,purchased,notes";
    static final int MAX_SHOPPING_LIST_NAME_CODE_POINTS = 100;
    private String ownerWhere(String column, Long ownerId) { return ownerId == null ? column + " IS NULL" : column + "=" + ownerId; }
    public List<Map<String,Object>> inventory() { return inventory(null); }
    public List<Map<String,Object>> inventory(Long ownerId) { return repo.query("SELECT " + INVENTORY_COLUMNS + " FROM inventory_items WHERE " + ownerWhere("account_id", ownerId) + " ORDER BY name"); }
    public Map<String,Object> inventory(long id) { return inventory(null, id); }
    public Map<String,Object> inventory(Long ownerId, long id) { return repo.one("SELECT " + INVENTORY_COLUMNS + " FROM inventory_items WHERE id=? AND " + ownerWhere("account_id", ownerId), id); }
    public Map<String,Object> saveInventory(Long id, Map<String,Object> body) { return saveInventory(null, id, body); }
    public Map<String,Object> saveInventory(Long ownerId, Long id, Map<String,Object> body) {
        lockOwner(ownerId);
        var values = fields(body, id == null, true);
        if (id == null) { if (ownerId != null) values.put("account_id", ownerId); id = repo.insert("inventory_items", values); }
        else { inventory(ownerId, id); values.put("updated_at", OffsetDateTime.now(ZoneOffset.UTC)); repo.update("inventory_items", id, values, ownerId); }
        events.publishEvent(new PantryChanged("inventory_changed", id, ownerId));
        return inventory(ownerId, id);
    }
    public Map<String,Object> adjustInventory(long id, String idempotencyKey, Map<String,Object> body) { return adjustInventory(null, id, idempotencyKey, body); }
    public Map<String,Object> adjustInventory(Long ownerId, long id, String idempotencyKey, Map<String,Object> body) {
        lockOwner(ownerId);
        if (idempotencyKey == null || idempotencyKey.isBlank() || idempotencyKey.length() > 128) bad("Idempotency-Key must be 1 to 128 characters");
        var item = repo.one("SELECT * FROM inventory_items WHERE id=? AND " + ownerWhere("account_id", ownerId) + " FOR UPDATE", id);
        Object operationValue = body.get("operation");
        if (!(operationValue instanceof String) || !(operationValue.equals("consume") || operationValue.equals("restock"))) {
            bad("operation must be consume or restock");
        }
        String operation = operationValue.toString();
        Object amountValue = body.get("amount");
        if (!(amountValue instanceof Number) || !Double.isFinite(((Number) amountValue).doubleValue()) || ((Number) amountValue).doubleValue() <= 0) {
            bad("amount must be greater than zero");
        }
        double amount = ((Number) amountValue).doubleValue();
        var previous = repo.query("SELECT operation, amount FROM inventory_adjustments WHERE inventory_item_id=? AND idempotency_key=?", id, idempotencyKey);
        if (!previous.isEmpty()) {
            var existing = previous.get(0);
            if (!existing.get("operation").equals(operation) || Double.compare(number(existing, "amount"), amount) != 0) {
                bad("Idempotency-Key was already used for a different adjustment");
            }
            return inventory(ownerId, id);
        }
        double quantityBefore = number(item, "quantity");
        int changed;
        if (operation.equals("consume")) {
            changed = repo.execute("UPDATE inventory_items SET quantity=quantity-?, revision=revision+1, updated_at=CURRENT_TIMESTAMP WHERE id=? AND quantity>=?", amount, id, amount);
            if (changed == 0) bad("amount exceeds available stock");
        } else {
            changed = repo.execute("UPDATE inventory_items SET quantity=quantity+?, revision=revision+1, updated_at=CURRENT_TIMESTAMP WHERE id=?", amount, id);
        }
        double quantityAfter = operation.equals("consume") ? quantityBefore - amount : quantityBefore + amount;
        var adjustment = new LinkedHashMap<String,Object>();
        adjustment.put("inventory_item_id", id);
        adjustment.put("idempotency_key", idempotencyKey);
        adjustment.put("operation", operation);
        adjustment.put("amount", amount);
        adjustment.put("quantity_before", quantityBefore);
        adjustment.put("quantity_after", quantityAfter);
        adjustment.put("inventory_revision", ((Number) item.get("revision")).longValue() + 1);
        adjustment.put("undo_expires_at", OffsetDateTime.now(ZoneOffset.UTC).plusMinutes(5));
        repo.insert("inventory_adjustments", adjustment);
        events.publishEvent(new PantryChanged("inventory_changed", id, ownerId));
        return inventory(ownerId, id);
    }
    public Map<String,Object> undoInventoryAdjustment(long id, Map<String,Object> body) { return undoInventoryAdjustment(null, id, body); }
    public Map<String,Object> undoInventoryAdjustment(Long ownerId, long id, Map<String,Object> body) {
        lockOwner(ownerId);
        Object key = body.get("idempotencyKey");
        if (!(key instanceof String s) || s.isBlank() || s.length() > 128) bad("idempotencyKey must be 1 to 128 characters");
        // All stock writers acquire this row lock (explicitly or through UPDATE).
        // Check time after waiting for the lock, rather than using transaction-start time.
        var item = repo.one("SELECT * FROM inventory_items WHERE id=? AND " + ownerWhere("account_id", ownerId) + " FOR UPDATE", id);
        var adjustment = repo.one("SELECT * FROM inventory_adjustments WHERE inventory_item_id=? AND idempotency_key=?", id, key);
        if (adjustment.get("undoneAt") != null) return Map.of("status", "already_undone", "inventory", inventory(ownerId, id));
        if (adjustment.get("inventoryRevision") == null || adjustment.get("undoExpiresAt") == null) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Historical adjustment is not eligible for undo");
        }
        Instant now = Instant.now();
        if (!now.isBefore(Instant.parse(adjustment.get("undoExpiresAt").toString()))) {
            throw new ResponseStatusException(HttpStatus.GONE, "The five-minute undo window has expired");
        }
        long revision = ((Number) item.get("revision")).longValue();
        if (revision != ((Number) adjustment.get("inventoryRevision")).longValue()) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Inventory changed after this adjustment");
        }
        // Restore the recorded value exactly, avoiding inverse floating-point arithmetic.
        repo.execute("UPDATE inventory_items SET quantity=?, revision=revision+1, updated_at=? WHERE id=?",
            adjustment.get("quantityBefore"), OffsetDateTime.ofInstant(now, ZoneOffset.UTC), id);
        repo.execute("UPDATE inventory_adjustments SET undone_at=?, undo_revision=? WHERE id=?",
            OffsetDateTime.ofInstant(now, ZoneOffset.UTC), revision + 1, adjustment.get("id"));
        events.publishEvent(new PantryChanged("inventory_changed", id, ownerId));
        return Map.of("status", "undone", "inventory", inventory(ownerId, id));
    }
    public void deleteInventory(long id) { deleteInventory(null, id); }
    public void deleteInventory(Long ownerId, long id) { lockOwner(ownerId); inventory(ownerId, id); repo.execute("DELETE FROM inventory_items WHERE id=? AND " + ownerWhere("account_id", ownerId), id); events.publishEvent(new PantryChanged("inventory_changed", id, ownerId)); }
    boolean expired(Map<String,Object> item) {
        return number(item, "quantity") > 0 && item.get("expiresAt") != null
            && LocalDate.parse(item.get("expiresAt").toString()).isBefore(Instant.ofEpochMilli(clock.millis()).atZone(ZoneOffset.UTC).toLocalDate());
    }
    boolean expiring(Map<String,Object> item) {
        if (number(item, "quantity") <= 0 || item.get("expiresAt") == null) return false;
        var date = LocalDate.parse(item.get("expiresAt").toString());
        var today = Instant.ofEpochMilli(clock.millis()).atZone(ZoneOffset.UTC).toLocalDate();
        return !date.isBefore(today) && !date.isAfter(today.plusDays(7));
    }
    private boolean lowStock(Map<String,Object> item) {
        double quantity = number(item, "quantity");
        return quantity > 0 && quantity <= number(item, "minThreshold");
    }
    private String primaryUrgency(Map<String,Object> item) {
        if (expired(item)) return "expired";
        if (number(item, "quantity") == 0) return "critical";
        if (expiring(item)) return "expiring_soon";
        if (lowStock(item)) return "low";
        return null;
    }
    private String suggestionReason(Map<String,Object> item, String urgency) {
        double quantity = number(item, "quantity"), threshold = number(item, "minThreshold");
        String unit = String.valueOf(item.get("unit"));
        String stock = lowStock(item) ? quantity + " " + unit + " left (minimum is " + threshold + " " + unit + ")" : null;
        String expiry = expired(item) ? "Expired on " : "Expires on ";
        if (urgency.equals("critical")) return "Out of stock";
        if (urgency.equals("expired")) return expiry + item.get("expiresAt") + (stock == null ? "" : "; " + stock);
        if (urgency.equals("expiring_soon")) return expiry + item.get("expiresAt") + (stock == null ? "" : "; " + stock);
        return stock;
    }
    public List<Map<String,Object>> suggestions() { return suggestions(null); }
    public List<Map<String,Object>> suggestions(Long ownerId) {
        var result = new ArrayList<Map<String,Object>>();
        for (var item : inventory(ownerId)) {
            double quantity = number(item, "quantity");
            String urgency = primaryUrgency(item);
            if (urgency != null) {
                Map<String,Object> suggestion = new LinkedHashMap<>();
                suggestion.put("inventoryItemId", item.get("id"));
                for (String key : List.of("name", "category", "minThreshold", "unit")) suggestion.put(key, item.get(key));
                suggestion.put("currentQuantity", quantity); suggestion.put("urgency", urgency);
                suggestion.put("reason", suggestionReason(item, urgency));
                result.add(suggestion);
            }
        }
        result.sort(Comparator.comparingInt(s -> List.of("expired", "critical", "expiring_soon", "low").indexOf(s.get("urgency"))));
        return result;
    }
    public Map<String,Object> stats() { return stats(null); }
    public Map<String,Object> stats(Long ownerId) {
        var items = inventory(ownerId);
        Map<String,Long> categories = new TreeMap<>();
        items.forEach(i -> categories.merge(i.get("category").toString(), 1L, Long::sum));
        return Map.of("totalItems", items.size(), "outOfStockCount", items.stream().filter(i -> number(i,"quantity") == 0).count(),
            "lowStockCount", items.stream().filter(i -> number(i,"quantity") > 0 && number(i,"quantity") <= number(i,"minThreshold")).count(),
            "expiringCount", items.stream().filter(this::expiring).count(),
            "expiredCount", items.stream().filter(this::expired).count(),
            "categoryBreakdown", categories.entrySet().stream().map(e -> Map.of("category",e.getKey(),"count",e.getValue())).toList());
    }
    public Map<String,Object> list(long id) { return list(null, id); }
    public Map<String,Object> list(Long ownerId, long id) {
        var list = repo.one("SELECT " + SHOPPING_LIST_COLUMNS + " FROM shopping_lists WHERE id=? AND " + ownerWhere("account_id", ownerId), id);
        list.put("items", repo.query("SELECT " + SHOPPING_LIST_ITEM_COLUMNS + " FROM shopping_list_items WHERE shopping_list_id=? AND " + ownerWhere("account_id", ownerId) + " ORDER BY id", id));
        return list;
    }
    public List<Map<String,Object>> lists() { return lists(null); }
    public List<Map<String,Object>> lists(Long ownerId) {
        var lists = repo.query("SELECT " + SHOPPING_LIST_COLUMNS + " FROM shopping_lists WHERE " + ownerWhere("account_id", ownerId) + " ORDER BY created_at");
        for (var list : lists) {
            var items = repo.query("SELECT purchased FROM shopping_list_items WHERE shopping_list_id=? AND " + ownerWhere("account_id", ownerId), id(list));
            list.put("itemCount", items.size()); list.put("purchasedCount", items.stream().filter(i -> Boolean.TRUE.equals(i.get("purchased"))).count());
        }
        return lists;
    }
    public Map<String,Object> createList(Map<String,Object> body) { return createList(null, body); }
    public Map<String,Object> createList(Long ownerId, Map<String,Object> body) {
        lockOwner(ownerId);
        String name = shoppingListName(body);
        Map<String,Object> values = new LinkedHashMap<>(); values.put("name", name); if (ownerId != null) values.put("account_id", ownerId);
        long id = repo.insert("shopping_lists", values);
        var list = list(ownerId, id);
        list.put("itemCount", 0); list.put("purchasedCount", 0); return list;
    }
    public Map<String,Object> updateList(long id, Map<String,Object> body) { return updateList(null, id, body); }
    public Map<String,Object> updateList(Long ownerId, long id, Map<String,Object> body) {
        lockOwner(ownerId);
        var existing = list(ownerId, id);
        String name = shoppingListName(body);
        if (name.equals(existing.get("name"))) return existing;
        repo.update("shopping_lists", id, Map.of("name", name, "updated_at", OffsetDateTime.now(ZoneOffset.UTC)), ownerId);
        return list(ownerId, id);
    }
    public void deleteList(long id) { deleteList(null, id); }
    public void deleteList(Long ownerId, long id) { lockOwner(ownerId); list(ownerId, id); repo.execute("DELETE FROM shopping_lists WHERE id=? AND " + ownerWhere("account_id", ownerId), id); }

    private String shoppingListName(Map<String,Object> body) {
        Object value = body.get("name");
        if (!(value instanceof String)) bad("name is required");
        String raw = (String) value;
        String name = trimShoppingListBoundaryWhitespace(raw);
        if (name.isEmpty()) bad("name is required");
        if (name.codePointCount(0, name.length()) > MAX_SHOPPING_LIST_NAME_CODE_POINTS) {
            bad("name must be 100 Unicode code points or fewer");
        }
        return name;
    }

    /** Matches the explicit boundary-whitespace table in the React application. */
    static String trimShoppingListBoundaryWhitespace(String value) {
        int start = 0;
        int end = value.length();
        while (start < end) {
            int codePoint = value.codePointAt(start);
            if (!isShoppingListBoundaryWhitespace(codePoint)) break;
            start += Character.charCount(codePoint);
        }
        while (end > start) {
            int codePoint = value.codePointBefore(end);
            if (!isShoppingListBoundaryWhitespace(codePoint)) break;
            end -= Character.charCount(codePoint);
        }
        return value.substring(start, end);
    }

    private static boolean isShoppingListBoundaryWhitespace(int codePoint) {
        return codePoint == 0x0009 || codePoint == 0x000A || codePoint == 0x000B
            || codePoint == 0x000C || codePoint == 0x000D || codePoint == 0x0020
            || codePoint == 0x00A0 || codePoint == 0x1680
            || (codePoint >= 0x2000 && codePoint <= 0x200A)
            || codePoint == 0x2028 || codePoint == 0x2029 || codePoint == 0x202F
            || codePoint == 0x205F || codePoint == 0x3000 || codePoint == 0xFEFF;
    }
    public Map<String,Object> addItem(long listId, Map<String,Object> body) { return addItem(null, listId, body); }
    public Map<String,Object> addItem(Long ownerId, long listId, Map<String,Object> body) {
        lockOwner(ownerId);
        list(ownerId, listId); var values = fields(body, true, false);
        values.remove("purchased");
        if (values.get("inventory_item_id") != null) inventory(ownerId, ((Number)values.get("inventory_item_id")).longValue());
        values.put("shopping_list_id", listId);
        if (ownerId != null) values.put("account_id", ownerId);
        long id = repo.insert("shopping_list_items", values);
        return repo.one("SELECT " + SHOPPING_LIST_ITEM_COLUMNS + " FROM shopping_list_items WHERE id=? AND " + ownerWhere("account_id", ownerId), id);
    }
    public Map<String,Object> updateItem(long listId, long id, Map<String,Object> body) { return updateItem(null, listId, id, body); }
    public Map<String,Object> updateItem(Long ownerId, long listId, long id, Map<String,Object> body) {
        lockOwner(ownerId);
        repo.one("SELECT * FROM shopping_list_items WHERE id=? AND shopping_list_id=? AND " + ownerWhere("account_id", ownerId), id, listId);
        var values = fields(body, false, false); values.keySet().retainAll(Set.of("quantity", "notes", "purchased"));
        repo.update("shopping_list_items", id, values, ownerId);
        return repo.one("SELECT " + SHOPPING_LIST_ITEM_COLUMNS + " FROM shopping_list_items WHERE id=? AND " + ownerWhere("account_id", ownerId), id);
    }
    public void deleteItem(long listId, long id) { deleteItem(null, listId, id); }
    public void deleteItem(Long ownerId, long listId, long id) {
        lockOwner(ownerId);
        repo.one("SELECT * FROM shopping_list_items WHERE id=? AND shopping_list_id=? AND " + ownerWhere("account_id", ownerId), id, listId);
        repo.execute("DELETE FROM shopping_list_items WHERE id=? AND " + ownerWhere("account_id", ownerId), id);
    }
    public Map<String,Object> generateList() { return generateList(null, Map.of()); }
    public Map<String,Object> generateList(Map<String,Object> request) { return generateList(null, request); }
    public Map<String,Object> generateList(Long ownerId, Map<String,Object> request) {
        lockOwner(ownerId);
        var suggestions = suggestions(ownerId).stream()
            .filter(s -> number(s, "currentQuantity") == 0
                || number(s, "currentQuantity") <= number(s, "minThreshold"))
            .toList();
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
        long listId = id(createList(ownerId, Map.of("name", "Low-stock shopping list")));
        for (var suggestion : selected.values()) {
            var body = new LinkedHashMap<>(suggestion);
            body.putIfAbsent("quantity", Math.max(number(suggestion,"minThreshold") - number(suggestion,"currentQuantity"), 1));
            body.put("notes", suggestion.get("reason")); addItem(ownerId, listId, body);
        }
        return list(ownerId, listId);
    }
    public Map<String,Object> purchase(long listId) { return purchase(null, listId); }
    public Map<String,Object> purchase(Long ownerId, long listId) {
        lockOwner(ownerId);
        repo.one("SELECT * FROM shopping_lists WHERE id=? AND " + ownerWhere("account_id", ownerId) + " FOR UPDATE", listId);
        var items = repo.query("SELECT * FROM shopping_list_items WHERE shopping_list_id=? AND " + ownerWhere("account_id", ownerId) + " AND purchased=TRUE AND restocked=FALSE AND inventory_item_id IS NOT NULL", listId);
        for (var item : items) {
            repo.execute("UPDATE inventory_items SET quantity=quantity+?, revision=revision+1, updated_at=CURRENT_TIMESTAMP WHERE id=? AND " + ownerWhere("account_id", ownerId), item.get("quantity"), item.get("inventoryItemId"));
            repo.execute("UPDATE shopping_list_items SET restocked=TRUE WHERE id=? AND " + ownerWhere("account_id", ownerId), item.get("id"));
        }
        events.publishEvent(new PantryChanged("purchase_completed", null, ownerId));
        return Map.of("purchasedCount", items.size(), "updatedInventoryItems", items.size());
    }
}
