package com.pantrypal;

import java.io.IOException;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.security.core.Authentication;
import org.springframework.transaction.event.TransactionalEventListener;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

/** Prototype process-local event fan-out. Reconnects recover current alerts from /suggestions. */
@RestController
@RequestMapping("/api/notifications")
public class NotificationEvents {
    private static final class Subscriber {
        private final String sessionId;
        private final SseEmitter emitter;
        private boolean closed;

        private Subscriber(String sessionId, SseEmitter emitter) {
            this.sessionId = sessionId;
            this.emitter = emitter;
        }

        private synchronized void send(SseEmitter.SseEventBuilder event) throws IOException {
            if (!closed) emitter.send(event);
        }

        private synchronized boolean belongsTo(String candidateSessionId) {
            return Objects.equals(sessionId, candidateSessionId);
        }

        private synchronized void close() {
            if (closed) return;
            closed = true;
            emitter.complete();
        }
    }

    private final Map<Long,CopyOnWriteArrayList<Subscriber>> clients = new ConcurrentHashMap<>();
    private final PantryService service;
    private final Map<Long,String> previousByAccount = new HashMap<>();
    public NotificationEvents(PantryService service) { this.service = service; }
    @GetMapping(value="/stream", produces="text/event-stream")
    public SseEmitter subscribe(Authentication authentication, HttpServletRequest request) {
        var session = request.getSession(false);
        return subscribe(authentication, session == null ? null : session.getId(), new SseEmitter(0L));
    }
    SseEmitter subscribe(Authentication authentication, SseEmitter emitter) {
        return subscribe(authentication, null, emitter);
    }
    SseEmitter subscribe(Authentication authentication, String sessionId, SseEmitter emitter) {
        long accountId = Long.parseLong(authentication.getName());
        var subscriber = new Subscriber(sessionId, emitter);
        clients.compute(accountId, (ignored, accountClients) -> {
            var registeredClients = accountClients == null ? new CopyOnWriteArrayList<Subscriber>() : accountClients;
            registeredClients.add(subscriber);
            return registeredClients;
        });
        emitter.onCompletion(() -> removeClient(accountId, subscriber));
        emitter.onTimeout(() -> removeClient(accountId, subscriber));
        emitter.onError(error -> removeClient(accountId, subscriber));
        try { subscriber.send(SseEmitter.event().name("ready").data(Map.of("status", "connected"))); }
        catch (IOException e) { subscriber.close(); removeClient(accountId, subscriber); }
        return emitter;
    }
    public void disconnectSession(String sessionId) {
        if (sessionId == null) return;
        clients.forEach((accountId, accountClients) -> {
            for (var subscriber : accountClients) {
                if (subscriber.belongsTo(sessionId)) {
                    subscriber.close();
                    removeClient(accountId, subscriber);
                }
            }
        });
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
        for (var subscriber : accountClients) {
            try { subscriber.send(SseEmitter.event().name("pantry-event").data(Map.of("type", type))); }
            catch (IOException | IllegalStateException e) {
                subscriber.close();
                removeClient(accountId, subscriber);
            }
        }
    }
    private void removeClient(Long accountId, Subscriber subscriber) {
        clients.computeIfPresent(accountId, (ignored, accountClients) -> {
            accountClients.remove(subscriber);
            return accountClients.isEmpty() ? null : accountClients;
        });
    }
}
