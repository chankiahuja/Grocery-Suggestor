package com.pantrypal;

import java.io.IOException;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.Executor;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.locks.ReentrantLock;
import java.util.function.BooleanSupplier;
import jakarta.servlet.http.HttpServletRequest;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
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
    private static final Logger log = LoggerFactory.getLogger(NotificationEvents.class);
    private static final class SessionGuard {
        private final Object monitor = new Object();
        private int users;
    }
    private enum SendResult { DELIVERED, CLOSED, INACTIVE }
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

        private SendResult send(SseEmitter.SseEventBuilder event, BooleanSupplier sessionActive) throws IOException {
            deliveryLock.lock();
            try {
                synchronized (this) {
                    if (closed) return SendResult.CLOSED;
                }
                if (!sessionActive.getAsBoolean()) {
                    close();
                    return SendResult.INACTIVE;
                }
                synchronized (this) {
                    // Disconnect may have completed while the session lookup was in progress.
                    if (closed) return SendResult.CLOSED;
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
                return SendResult.DELIVERED;
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
    private final Set<String> revokedSessions = ConcurrentHashMap.newKeySet();
    private final Map<String,SessionGuard> sessionGuards = new ConcurrentHashMap<>();
    private final PantryService service;
    private final SessionRepository<? extends Session> sessions;
    private final Executor deliveryExecutor;
    private final Map<Long,String> previousByAccount = new ConcurrentHashMap<>();
    @Autowired
    public NotificationEvents(PantryService service, SessionRepository<? extends Session> sessions,
        @Qualifier("notificationDeliveryExecutor") Executor deliveryExecutor) {
        this.service = service;
        this.sessions = sessions;
        this.deliveryExecutor = deliveryExecutor;
    }
    // Direct delivery keeps repository/emitter unit tests deterministic without starting workers.
    NotificationEvents(PantryService service, SessionRepository<? extends Session> sessions) {
        this(service, sessions, Runnable::run);
    }
    @GetMapping(value="/stream", produces="text/event-stream")
    public SseEmitter subscribe(Authentication authentication, HttpServletRequest request) {
        var session = request.getSession(false);
        return subscribe(authentication, session == null ? null : session.getId(), new SseEmitter(0L));
    }
    SseEmitter subscribe(Authentication authentication, String sessionId, SseEmitter emitter) {
        long accountId = Long.parseLong(authentication.getName());
        var subscriber = new Subscriber(sessionId, emitter);
        if (sessionId != null) {
            var guard = acquireSessionGuard(sessionId);
            try {
                synchronized (guard.monitor) {
                    if (revokedSessions.contains(sessionId)) {
                        subscriber.close();
                        return emitter;
                    }
                    beforeSubscriberRegistration(sessionId);
                    register(accountId, subscriber);
                }
            } finally {
                releaseSessionGuard(sessionId, guard);
            }
        } else {
            register(accountId, subscriber);
        }
        emitter.onCompletion(() -> removeClient(accountId, subscriber));
        emitter.onTimeout(() -> removeClient(accountId, subscriber));
        emitter.onError(error -> removeClient(accountId, subscriber));
        try { send(accountId, subscriber, SseEmitter.event().name("ready").data(Map.of("status", "connected"))); }
        catch (IOException | DataAccessException | CannotCreateTransactionException e) { subscriber.close(); removeClient(accountId, subscriber); }
        return emitter;
    }
    void beforeSubscriberRegistration(String sessionId) {
        // Test seam for deterministic subscription/revocation interleavings.
    }
    @TransactionalEventListener
    public void deleted(AccountDeletionService.AccountDeleted event) {
        var subscribers = clients.remove(event.accountId());
        if (subscribers != null) subscribers.forEach(subscriber -> {
            subscriber.close();
            cleanupSessionGuard(subscriber.sessionId);
        });
        previousByAccount.remove(event.accountId());
    }
    public void disconnectSession(String sessionId) {
        if (sessionId == null) return;
        var guard = acquireSessionGuard(sessionId);
        beforeSessionRevocation(sessionId);
        try {
            synchronized (guard.monitor) {
                revokedSessions.add(sessionId);
                clients.forEach((accountId, accountClients) -> {
                    for (var subscriber : accountClients) {
                        if (subscriber.belongsTo(sessionId)) {
                            subscriber.close();
                            removeClient(accountId, subscriber);
                        }
                    }
                });
            }
        } finally {
            releaseSessionGuard(sessionId, guard);
        }
    }
    void beforeSessionRevocation(String sessionId) {
        // Test seam for deterministic subscription/revocation interleavings.
    }
    @TransactionalEventListener
    public void changed(PantryService.PantryChanged event) {
        if (event.accountId() == null) return;
        try {
            // AFTER_COMMIT still runs before transaction connection cleanup. Enqueue only here.
            deliveryExecutor.execute(() -> broadcast(event.accountId(), event.type()));
        } catch (RejectedExecutionException e) {
            // These are best-effort refresh signals; HTTP responses and snapshot polling recover state.
            log.warn("Notification delivery queue unavailable; skipping refresh signal");
        }
    }
    @Scheduled(fixedDelayString="${pantrypal.expiry-check-ms:60000}")
    public synchronized void checkExpiry() {
        cleanupRevokedSessions();
        clients.forEach((accountId, accountClients) -> {
            for (var subscriber : accountClients) {
                try {
                    if (!sessionActive(subscriber.sessionId)) {
                        disconnectSession(subscriber.sessionId);
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
            beforeSubscriberSend(subscriber.sessionId, type);
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
    void beforeSubscriberSend(String sessionId, String type) {
        // Test seam for deterministic concurrency interleavings.
    }
    private boolean sessionActive(String sessionId) {
        if (sessionId == null) return false;
        var session = sessions.findById(sessionId);
        return session != null && !session.isExpired();
    }

    private void cleanupRevokedSessions() {
        for (String sessionId : revokedSessions) {
            try {
                if (sessionActive(sessionId)) continue;
                var guard = acquireSessionGuard(sessionId);
                try {
                    synchronized (guard.monitor) {
                        revokedSessions.remove(sessionId);
                    }
                } finally {
                    releaseSessionGuard(sessionId, guard);
                }
            } catch (DataAccessException | CannotCreateTransactionException e) {
                // Keep the tombstone when the session store is unavailable.
            }
        }
    }
    private void send(Long accountId, Subscriber subscriber, SseEmitter.SseEventBuilder event) throws IOException {
        var result = subscriber.send(event, () -> sessionActive(subscriber.sessionId));
        if (result == SendResult.INACTIVE) {
            disconnectSession(subscriber.sessionId);
            removeClient(accountId, subscriber);
        } else if (result == SendResult.CLOSED) {
            removeClient(accountId, subscriber);
        }
    }

    private void register(Long accountId, Subscriber subscriber) {
        clients.compute(accountId, (ignored, accountClients) -> {
            var registeredClients = accountClients == null ? new CopyOnWriteArrayList<Subscriber>() : accountClients;
            registeredClients.add(subscriber);
            return registeredClients;
        });
    }
    private void removeClient(Long accountId, Subscriber subscriber) {
        clients.computeIfPresent(accountId, (ignored, accountClients) -> {
            accountClients.remove(subscriber);
            return accountClients.isEmpty() ? null : accountClients;
        });
        cleanupSessionGuard(subscriber.sessionId);
    }
    private SessionGuard acquireSessionGuard(String sessionId) {
        return sessionGuards.compute(sessionId, (ignored, existing) -> {
            var guard = existing == null ? new SessionGuard() : existing;
            guard.users++;
            return guard;
        });
    }
    private void releaseSessionGuard(String sessionId, SessionGuard guard) {
        sessionGuards.computeIfPresent(sessionId, (ignored, current) -> {
            if (current != guard) return current;
            current.users--;
            return current.users == 0 && !revokedSessions.contains(sessionId)
                && !hasSubscriber(sessionId) ? null : current;
        });
    }
    private void cleanupSessionGuard(String sessionId) {
        if (sessionId == null) return;
        sessionGuards.computeIfPresent(sessionId, (ignored, current) ->
            current.users == 0 && !revokedSessions.contains(sessionId)
                && !hasSubscriber(sessionId) ? null : current);
    }
    private boolean hasSubscriber(String sessionId) {
        return clients.values().stream().anyMatch(accountClients ->
            accountClients.stream().anyMatch(subscriber -> subscriber.belongsTo(sessionId)));
    }
}
