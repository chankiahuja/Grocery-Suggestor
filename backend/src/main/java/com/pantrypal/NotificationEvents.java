package com.pantrypal;

import java.io.IOException;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.locks.ReentrantLock;
import java.util.function.BooleanSupplier;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.dao.DataAccessException;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.security.core.Authentication;
import org.springframework.session.Session;
import org.springframework.session.SessionRepository;
import org.springframework.transaction.CannotCreateTransactionException;
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
        // Serializes senders only; disconnect never waits on slow I/O through this lock.
        private final ReentrantLock deliveryLock = new ReentrantLock();
        private boolean closed;
        private boolean delivering;

        private Subscriber(String sessionId, SseEmitter emitter) {
            this.sessionId = sessionId;
            this.emitter = emitter;
        }

        private boolean send(SseEmitter.SseEventBuilder event, BooleanSupplier sessionActive) throws IOException {
            deliveryLock.lock();
            try {
                synchronized (this) {
                    if (closed) return false;
                }
                if (!sessionActive.getAsBoolean()) {
                    close();
                    return false;
                }
                synchronized (this) {
                    // Disconnect may have completed while the session lookup was in progress.
                    if (closed) return false;
                    delivering = true;
                }
                try {
                    emitter.send(event);
                } finally {
                    boolean complete;
                    synchronized (this) {
                        delivering = false;
                        complete = closed;
                    }
                    if (complete) emitter.complete();
                }
                return true;
            } finally {
                deliveryLock.unlock();
            }
        }

        private boolean belongsTo(String candidateSessionId) {
            return Objects.equals(sessionId, candidateSessionId);
        }

        private void close() {
            boolean complete;
            synchronized (this) {
                if (closed) return;
                closed = true;
                complete = !delivering;
            }
            // An admitted send may finish; its sender completes the emitter instead of blocking logout.
            if (complete) emitter.complete();
        }
    }

    private final Map<Long,CopyOnWriteArrayList<Subscriber>> clients = new ConcurrentHashMap<>();
    private final PantryService service;
    private final SessionRepository<? extends Session> sessions;
    private final Map<Long,String> previousByAccount = new HashMap<>();
    public NotificationEvents(PantryService service, SessionRepository<? extends Session> sessions) {
        this.service = service;
        this.sessions = sessions;
    }
    @GetMapping(value="/stream", produces="text/event-stream")
    public SseEmitter subscribe(Authentication authentication, HttpServletRequest request) {
        var session = request.getSession(false);
        return subscribe(authentication, session == null ? null : session.getId(), new SseEmitter(0L));
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
        try { send(accountId, subscriber, SseEmitter.event().name("ready").data(Map.of("status", "connected"))); }
        catch (IOException | DataAccessException | CannotCreateTransactionException e) { subscriber.close(); removeClient(accountId, subscriber); }
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
        clients.forEach((accountId, accountClients) -> {
            for (var subscriber : accountClients) {
                try {
                    if (!sessionActive(subscriber.sessionId)) {
                        subscriber.close();
                        removeClient(accountId, subscriber);
                    }
                } catch (DataAccessException | CannotCreateTransactionException e) {
                    // A failed lookup does not establish expiry. Later sends must validate again.
                }
            }
        });
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
            try { send(accountId, subscriber, SseEmitter.event().name("pantry-event").data(Map.of("type", type))); }
            catch (DataAccessException | CannotCreateTransactionException e) {
                // Send nothing for an unvalidated session; retain the stream for a later retry.
            }
            catch (IOException | IllegalStateException e) {
                subscriber.close();
                removeClient(accountId, subscriber);
            }
        }
    }
    private boolean sessionActive(String sessionId) {
        if (sessionId == null) return false;
        var session = sessions.findById(sessionId);
        return session != null && !session.isExpired();
    }
    private void send(Long accountId, Subscriber subscriber, SseEmitter.SseEventBuilder event) throws IOException {
        if (!subscriber.send(event, () -> sessionActive(subscriber.sessionId))) removeClient(accountId, subscriber);
    }
    private void removeClient(Long accountId, Subscriber subscriber) {
        clients.computeIfPresent(accountId, (ignored, accountClients) -> {
            accountClients.remove(subscriber);
            return accountClients.isEmpty() ? null : accountClients;
        });
    }
}
