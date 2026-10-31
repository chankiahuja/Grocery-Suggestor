package com.pantrypal;

import java.util.*;
import org.springframework.web.bind.annotation.*;
import org.springframework.http.HttpStatus;

@RestController
@RequestMapping("/api")
public class PantryController {
    final PantryService service;
    public PantryController(PantryService service) { this.service = service; }
    @GetMapping("/healthz") public Object health() { return Map.of("status", "ok"); }
    @GetMapping("/inventory") public Object inventory(@RequestParam(required=false) String category, @RequestParam(required=false) Boolean lowStock) {
        return service.inventory().stream().filter(i -> category == null || category.equals(i.get("category")))
            .filter(i -> !Boolean.TRUE.equals(lowStock) || PantryService.number(i,"quantity") <= PantryService.number(i,"minThreshold")).toList();
    }
    @GetMapping("/inventory/stats") public Object stats() { return service.stats(); }
    @GetMapping("/inventory/{id}") public Object inventory(@PathVariable long id) { return service.inventory(id); }
    @PostMapping("/inventory") @ResponseStatus(HttpStatus.CREATED) public Object createInventory(@RequestBody Map<String,Object> body) { return service.saveInventory(null, body); }
    @PatchMapping("/inventory/{id}") public Object updateInventory(@PathVariable long id, @RequestBody Map<String,Object> body) { return service.saveInventory(id, body); }
    @PostMapping("/inventory/{id}/adjust") public Object adjustInventory(@PathVariable long id, @RequestHeader("Idempotency-Key") String idempotencyKey, @RequestBody Map<String,Object> body) { return service.adjustInventory(id, idempotencyKey, body); }
    @PostMapping("/inventory/{id}/undo") public Object undoInventoryAdjustment(@PathVariable long id, @RequestBody Map<String,Object> body) { return service.undoInventoryAdjustment(id, body); }
    @DeleteMapping("/inventory/{id}") @ResponseStatus(HttpStatus.NO_CONTENT) public void deleteInventory(@PathVariable long id) { service.deleteInventory(id); }
    @GetMapping("/suggestions") public Object suggestions() { return service.suggestions(); }
    @PostMapping("/suggestions/generate-list") @ResponseStatus(HttpStatus.CREATED) public Object generate(@RequestBody(required=false) Map<String,Object> body) { return service.generateList(body == null ? Map.of() : body); }
    @GetMapping("/shopping-lists") public Object lists() { return service.lists(); }
    @PostMapping("/shopping-lists") @ResponseStatus(HttpStatus.CREATED) public Object createList(@RequestBody Map<String,Object> body) { return service.createList(body); }
    @GetMapping("/shopping-lists/{id}") public Object list(@PathVariable long id) { return service.list(id); }
    @DeleteMapping("/shopping-lists/{id}") @ResponseStatus(HttpStatus.NO_CONTENT) public void deleteList(@PathVariable long id) { service.deleteList(id); }
    @PostMapping("/shopping-lists/{id}/items") @ResponseStatus(HttpStatus.CREATED) public Object addItem(@PathVariable long id, @RequestBody Map<String,Object> body) { return service.addItem(id, body); }
    @PatchMapping("/shopping-lists/{id}/items/{itemId}") public Object updateItem(@PathVariable long id, @PathVariable long itemId, @RequestBody Map<String,Object> body) { return service.updateItem(id, itemId, body); }
    @DeleteMapping("/shopping-lists/{id}/items/{itemId}") @ResponseStatus(HttpStatus.NO_CONTENT) public void deleteItem(@PathVariable long id, @PathVariable long itemId) { service.deleteItem(id, itemId); }
    @PostMapping("/shopping-lists/{id}/purchase") public Object purchase(@PathVariable long id) { return service.purchase(id); }
}
