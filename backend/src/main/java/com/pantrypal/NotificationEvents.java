package com.pantrypal;

import java.io.IOException;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.security.core.Authentication;
import org.springframework.transaction.event.TransactionalEventListener;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

/** Prototype process-local event fan-out. Reconnects recover current alerts from /suggestions. */
@RestController
@RequestMapping("/api/notifications")
public class NotificationEvents {
    private final Map<Long,CopyOnWriteArrayList<SseEmitter>> clients = new ConcurrentHashMap<>();
    private final PantryService service;
    private final Map<Long,String> previousByAccount = new HashMap<>();
    public NotificationEvents(PantryService service) { this.service = service; }
    @GetMapping(value="/stream", produces="text/event-stream")
    public SseEmitter subscribe(Authentication authentication) {
        return subscribe(authentication, new SseEmitter(0L));
    }
    SseEmitter subscribe(Authentication authentication, SseEmitter emitter) {
        long accountId = Long.parseLong(authentication.getName());
        clients.computeIfAbsent(accountId, ignored -> new CopyOnWriteArrayList<>()).add(emitter);
        emitter.onCompletion(() -> removeClient(accountId, emitter));
        emitter.onTimeout(() -> removeClient(accountId, emitter));
        emitter.onError(error -> removeClient(accountId, emitter));
        try { emitter.send(SseEmitter.event().name("ready").data(Map.of("status", "connected"))); }
        catch (IOException e) { removeClient(accountId, emitter); emitter.complete(); }
        return emitter;
    }
    @TransactionalEventListener
    public void changed(PantryService.PantryChanged event) {
        if (event.accountId() != null) broadcast(event.accountId(), event.type());
    }
    @Scheduled(fixedDelayString="${pantrypal.expiry-check-ms:60000}")
    public synchronized void checkExpiry() {
        var accountIds = service.accountIds();
        previousByAccount.keySet().retainAll(accountIds);
        for (Long accountId : accountIds) {
            String current = service.suggestions(accountId).toString();
            String previous = previousByAccount.put(accountId, current);
            if (previous == null ? !current.equals("[]") : !current.equals(previous)) {
                broadcast(accountId, "alerts_changed");
            } else {
                broadcast(accountId, "heartbeat");
            }
        }
    }
    private void broadcast(Long accountId, String type) {
        if (accountId == null) return;
        var accountClients = clients.get(accountId);
        if (accountClients == null) return;
        for (var emitter : accountClients) {
            try { emitter.send(SseEmitter.event().name("pantry-event").data(Map.of("type", type))); }
            catch (IOException | IllegalStateException e) { removeClient(accountId, emitter); emitter.complete(); }
        }
    }
    private void removeClient(Long accountId, SseEmitter emitter) {
        clients.computeIfPresent(accountId, (ignored, accountClients) -> {
            accountClients.remove(emitter);
            return accountClients.isEmpty() ? null : accountClients;
        });
    }
}
