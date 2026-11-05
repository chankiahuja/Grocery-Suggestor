package com.pantrypal;

import java.util.*;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;
import org.springframework.http.HttpStatus;

@RestController
@RequestMapping("/api")
public class PantryController {
    final PantryService service;
    public PantryController(PantryService service) { this.service = service; }
    private Long account(Authentication authentication) { return authentication == null ? null : Long.parseLong(authentication.getName()); }
    @GetMapping("/healthz") public Object health() { return Map.of("status", "ok"); }
    @GetMapping("/inventory") public Object inventory(@RequestParam(required=false) String category, @RequestParam(required=false) Boolean lowStock, @RequestParam(required=false) Boolean outOfStock, Authentication authentication) {
        return service.inventory(account(authentication)).stream().filter(i -> category == null || category.equals(i.get("category")))
            .filter(i -> !Boolean.TRUE.equals(lowStock) || (PantryService.number(i,"quantity") > 0 && PantryService.number(i,"quantity") <= PantryService.number(i,"minThreshold")))
            .filter(i -> !Boolean.TRUE.equals(outOfStock) || PantryService.number(i,"quantity") == 0).toList();
    }
    @GetMapping("/inventory/stats") public Object stats(Authentication authentication) { return service.stats(account(authentication)); }
    @GetMapping("/inventory/{id}") public Object inventory(@PathVariable long id, Authentication authentication) { return service.inventory(account(authentication), id); }
    @PostMapping("/inventory") @ResponseStatus(HttpStatus.CREATED) public Object createInventory(@RequestBody Map<String,Object> body, Authentication authentication) { return service.saveInventory(account(authentication), null, body); }
    @PatchMapping("/inventory/{id}") public Object updateInventory(@PathVariable long id, @RequestBody Map<String,Object> body, Authentication authentication) { return service.saveInventory(account(authentication), id, body); }
    @PostMapping("/inventory/{id}/adjust") public Object adjustInventory(@PathVariable long id, @RequestHeader("Idempotency-Key") String idempotencyKey, @RequestBody Map<String,Object> body, Authentication authentication) { return service.adjustInventory(account(authentication), id, idempotencyKey, body); }
    @PostMapping("/inventory/{id}/undo") public Object undoInventoryAdjustment(@PathVariable long id, @RequestBody Map<String,Object> body, Authentication authentication) { return service.undoInventoryAdjustment(account(authentication), id, body); }
    @DeleteMapping("/inventory/{id}") @ResponseStatus(HttpStatus.NO_CONTENT) public void deleteInventory(@PathVariable long id, Authentication authentication) { service.deleteInventory(account(authentication), id); }
    @GetMapping("/suggestions") public Object suggestions(Authentication authentication) { return service.suggestions(account(authentication)); }
    @PostMapping("/suggestions/generate-list") @ResponseStatus(HttpStatus.CREATED) public Object generate(@RequestBody(required=false) Map<String,Object> body, Authentication authentication) { return service.generateList(account(authentication), body == null ? Map.of() : body); }
    @GetMapping("/shopping-lists") public Object lists(Authentication authentication) { return service.lists(account(authentication)); }
    @PostMapping("/shopping-lists") @ResponseStatus(HttpStatus.CREATED) public Object createList(@RequestBody Map<String,Object> body, Authentication authentication) { return service.createList(account(authentication), body); }
    @GetMapping("/shopping-lists/{id}") public Object list(@PathVariable long id, Authentication authentication) { return service.list(account(authentication), id); }
    @DeleteMapping("/shopping-lists/{id}") @ResponseStatus(HttpStatus.NO_CONTENT) public void deleteList(@PathVariable long id, Authentication authentication) { service.deleteList(account(authentication), id); }
    @PostMapping("/shopping-lists/{id}/items") @ResponseStatus(HttpStatus.CREATED) public Object addItem(@PathVariable long id, @RequestBody Map<String,Object> body, Authentication authentication) { return service.addItem(account(authentication), id, body); }
    @PatchMapping("/shopping-lists/{id}/items/{itemId}") public Object updateItem(@PathVariable long id, @PathVariable long itemId, @RequestBody Map<String,Object> body, Authentication authentication) { return service.updateItem(account(authentication), id, itemId, body); }
    @DeleteMapping("/shopping-lists/{id}/items/{itemId}") @ResponseStatus(HttpStatus.NO_CONTENT) public void deleteItem(@PathVariable long id, @PathVariable long itemId, Authentication authentication) { service.deleteItem(account(authentication), id, itemId); }
    @PostMapping("/shopping-lists/{id}/purchase") public Object purchase(@PathVariable long id, Authentication authentication) { return service.purchase(account(authentication), id); }
}
