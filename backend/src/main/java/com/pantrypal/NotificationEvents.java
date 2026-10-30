package com.pantrypal;

import java.io.IOException;
import java.util.*;
import java.util.concurrent.CopyOnWriteArrayList;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.transaction.event.TransactionalEventListener;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

/** Prototype process-local event fan-out. Reconnects recover current alerts from /suggestions. */
@RestController
@RequestMapping("/api/notifications")
public class NotificationEvents {
    private final List<SseEmitter> clients = new CopyOnWriteArrayList<>();
    private final PantryService service;
    private volatile String previous = "";
    public NotificationEvents(PantryService service) { this.service = service; }
    @GetMapping(value="/stream", produces="text/event-stream")
    public SseEmitter subscribe() {
        var emitter = new SseEmitter(0L);
        clients.add(emitter);
        emitter.onCompletion(() -> clients.remove(emitter));
        emitter.onTimeout(() -> clients.remove(emitter));
        emitter.onError(error -> clients.remove(emitter));
        try { emitter.send(SseEmitter.event().name("ready").data(Map.of("status", "connected"))); }
        catch (IOException e) { clients.remove(emitter); emitter.complete(); }
        return emitter;
    }
    @TransactionalEventListener
    public void changed(PantryService.PantryChanged event) { broadcast(event.type()); }
    @Scheduled(fixedDelayString="${pantrypal.expiry-check-ms:60000}")
    public void checkExpiry() {
        String current = service.suggestions().toString();
        if (!current.equals(previous)) { previous = current; broadcast("alerts_changed"); }
        else broadcast("heartbeat");
    }
    private void broadcast(String type) {
        for (var emitter : clients) {
            try { emitter.send(SseEmitter.event().name("pantry-event").data(Map.of("type", type))); }
            catch (IOException | IllegalStateException e) { clients.remove(emitter); emitter.complete(); }
        }
    }
}
