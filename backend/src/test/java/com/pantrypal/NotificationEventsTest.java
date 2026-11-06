package com.pantrypal;

import java.io.IOException;
import java.time.Instant;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;
import org.springframework.security.core.Authentication;
import org.springframework.session.MapSession;
import org.springframework.session.SessionRepository;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter.SseEventBuilder;
import org.springframework.web.servlet.mvc.method.annotation.ResponseBodyEmitter.DataWithMediaType;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.*;

class NotificationEventsTest {
    @Test
    void inventoryAndPurchaseEventsOnlyReachTheirAccount() throws IOException {
        PantryService service = mock(PantryService.class);
        NotificationEvents notifications = new NotificationEvents(service, sessions());
        var alice = new RecordingEmitter();
        var bob = new RecordingEmitter();
        notifications.subscribe(authentication("1"), "alice-session", alice);
        notifications.subscribe(authentication("2"), "bob-session", bob);

        assertThat(alice.payloads).contains(Map.of("status", "connected"));
        assertThat(bob.payloads).contains(Map.of("status", "connected"));
        notifications.changed(new PantryService.PantryChanged("inventory_changed", 41L, 1L));
        assertThat(alice.payloads).contains(Map.of("type", "inventory_changed"));
        assertThat(bob.payloads).doesNotContain(Map.of("type", "inventory_changed"));

        notifications.changed(new PantryService.PantryChanged("purchase_completed", null, 2L));
        assertThat(alice.payloads).doesNotContain(Map.of("type", "purchase_completed"));
        assertThat(bob.payloads).contains(Map.of("type", "purchase_completed"));
        assertThat(alice.payloads).allMatch(payload -> !(payload instanceof Map<?,?>) || isContractPayload(payload));
        assertThat(bob.payloads).allMatch(payload -> !(payload instanceof Map<?,?>) || isContractPayload(payload));
    }

    @Test
    void disconnectingOneSessionLeavesOtherSessionsForTheAccountConnected() throws IOException {
        NotificationEvents notifications = new NotificationEvents(mock(PantryService.class), sessions());
        var signedOut = new RecordingEmitter();
        var stillSignedIn = new RecordingEmitter();
        notifications.subscribe(authentication("1"), "session-a", signedOut);
        notifications.subscribe(authentication("1"), "session-b", stillSignedIn);

        notifications.disconnectSession("session-a");
        notifications.changed(new PantryService.PantryChanged("inventory_changed", 41L, 1L));

        assertThat(signedOut.payloads).doesNotContain(Map.of("type", "inventory_changed"));
        assertThat(stillSignedIn.payloads).contains(Map.of("type", "inventory_changed"));
    }

    @Test
    void scheduledAlertChangesAndHeartbeatsStayWithinEachAccount() throws IOException {
        PantryService service = mock(PantryService.class);
        when(service.accountIds()).thenReturn(List.of(1L, 2L));
        when(service.suggestions(1L)).thenReturn(List.of());
        when(service.suggestions(2L)).thenReturn(List.of());
        NotificationEvents notifications = new NotificationEvents(service, sessions());
        var alice = new RecordingEmitter();
        var bob = new RecordingEmitter();
        notifications.subscribe(authentication("1"), "alice-session", alice);
        notifications.subscribe(authentication("2"), "bob-session", bob);

        notifications.checkExpiry();
        assertThat(alice.payloads).contains(Map.of("type", "heartbeat"));
        assertThat(bob.payloads).contains(Map.of("type", "heartbeat"));

        when(service.suggestions(1L)).thenReturn(
            List.of(Map.of("name", "Alice milk", "urgency", "expiring_soon")));
        notifications.checkExpiry();
        assertThat(alice.payloads).contains(Map.of("type", "alerts_changed"));
        assertThat(bob.payloads).doesNotContain(Map.of("type", "alerts_changed"));

        when(service.suggestions(1L)).thenReturn(List.of());
        notifications.checkExpiry();
        assertThat(alice.payloads).contains(Map.of("type", "alerts_changed"));
        assertThat(bob.payloads).doesNotContain(Map.of("type", "alerts_changed"));
        assertThat(alice.payloads).allMatch(payload -> !(payload instanceof Map<?,?>) || isContractPayload(payload));
        assertThat(bob.payloads).allMatch(payload -> !(payload instanceof Map<?,?>) || isContractPayload(payload));
        verify(service, times(3)).suggestions(1L);
        verify(service, times(3)).suggestions(2L);
        verify(service, never()).suggestions();
    }

    @Test
    void streamRequiresAnAuthenticatedAccountIdentity() {
        PantryService service = mock(PantryService.class);
        NotificationEvents notifications = new NotificationEvents(service, sessions());
        Authentication authentication = mock(Authentication.class);
        when(authentication.getName()).thenReturn("not-an-account-id");

        assertThat(org.assertj.core.api.Assertions.catchThrowable(
            () -> notifications.subscribe(authentication, (String) null, new RecordingEmitter())))
            .isInstanceOf(NumberFormatException.class);
    }

    @Test
    void scheduledCheckClosesExpiredAndDeletedSessionsEvenWithoutAccountActivity() {
        var sessions = sessions();
        PantryService service = mock(PantryService.class);
        when(service.accountIds()).thenReturn(List.of());
        var notifications = new NotificationEvents(service, sessions);
        var expired = new RecordingEmitter();
        var deleted = new RecordingEmitter();
        notifications.subscribe(authentication("1"), "expired", expired);
        notifications.subscribe(authentication("1"), "deleted", deleted);
        var oldSession = new MapSession();
        oldSession.setLastAccessedTime(Instant.EPOCH);
        oldSession.setMaxInactiveInterval(Duration.ofSeconds(1));
        when(sessions.findById("expired")).thenReturn(oldSession);
        when(sessions.findById("deleted")).thenReturn(null);

        notifications.checkExpiry();

        assertThat(expired.completed).isTrue();
        assertThat(deleted.completed).isTrue();
        notifications.changed(new PantryService.PantryChanged("inventory_changed", 41L, 1L));
        assertThat(expired.payloads).doesNotContain(Map.of("type", "inventory_changed"));
        assertThat(deleted.payloads).doesNotContain(Map.of("type", "inventory_changed"));
    }

    @Test
    void missingSessionIsClosedBeforeReadyIsSent() {
        var sessions = sessions();
        when(sessions.findById("missing")).thenReturn(null);
        var notifications = new NotificationEvents(mock(PantryService.class), sessions);
        for (String id : new String[] { null, "missing" }) {
            var emitter = new RecordingEmitter();
            notifications.subscribe(authentication("1"), id, emitter);
            assertThat(emitter.completed).isTrue();
            assertThat(emitter.payloads).isEmpty();
        }
    }

    @Test
    void sendingEventsDoesNotRefreshTheSessionIdleTimeout() {
        var sessions = sessions();
        var session = new MapSession();
        Instant lastAccessed = Instant.now().minusSeconds(60);
        session.setLastAccessedTime(lastAccessed);
        when(sessions.findById("active")).thenReturn(session);
        var notifications = new NotificationEvents(mock(PantryService.class), sessions);
        var emitter = new RecordingEmitter();
        notifications.subscribe(authentication("1"), "active", emitter);
        notifications.changed(new PantryService.PantryChanged("inventory_changed", 41L, 1L));
        assertThat(emitter.payloads).contains(Map.of("type", "inventory_changed"));
        assertThat(session.getLastAccessedTime()).isEqualTo(lastAccessed);
        verify(sessions, never()).save(any());
    }

    @Test
    void disconnectDoesNotWaitForSessionLookupAndPreventsThePendingDelivery() throws Exception {
        var sessions = sessions();
        var notifications = new NotificationEvents(mock(PantryService.class), sessions);
        var emitter = new RecordingEmitter();
        notifications.subscribe(authentication("1"), "slow-session", emitter);
        var lookupStarted = new CountDownLatch(1);
        var releaseLookup = new CountDownLatch(1);
        when(sessions.findById("slow-session")).thenAnswer(call -> {
            lookupStarted.countDown();
            assertThat(releaseLookup.await(10, TimeUnit.SECONDS)).isTrue();
            return new MapSession();
        });
        var workers = Executors.newFixedThreadPool(2);
        try {
            var delivery = workers.submit(() -> notifications.changed(
                new PantryService.PantryChanged("inventory_changed", 41L, 1L)));
            assertThat(lookupStarted.await(5, TimeUnit.SECONDS)).isTrue();
            workers.submit(() -> notifications.disconnectSession("slow-session")).get(2, TimeUnit.SECONDS);
            assertThat(emitter.completed).isTrue();
            releaseLookup.countDown();
            delivery.get(5, TimeUnit.SECONDS);
            assertThat(emitter.payloads).doesNotContain(Map.of("type", "inventory_changed"));
        } finally {
            releaseLookup.countDown();
            workers.shutdownNow();
            assertThat(workers.awaitTermination(5, TimeUnit.SECONDS)).isTrue();
            notifications.disconnectSession("slow-session");
        }
    }

    @Test
    void disconnectDoesNotWaitForDeliveryAndDefersCompletionUntilItFinishes() throws Exception {
        var notifications = new NotificationEvents(mock(PantryService.class), sessions());
        var emitter = new BlockingEmitter();
        notifications.subscribe(authentication("1"), "slow-session", emitter);
        emitter.blockDelivery = true;
        var workers = Executors.newFixedThreadPool(2);
        try {
            var delivery = workers.submit(() -> notifications.changed(
                new PantryService.PantryChanged("inventory_changed", 41L, 1L)));
            assertThat(emitter.deliveryStarted.await(5, TimeUnit.SECONDS)).isTrue();
            workers.submit(() -> notifications.disconnectSession("slow-session")).get(2, TimeUnit.SECONDS);
            assertThat(emitter.completed).isFalse();
            notifications.changed(new PantryService.PantryChanged("purchase_completed", null, 1L));
            emitter.releaseDelivery.countDown();
            delivery.get(5, TimeUnit.SECONDS);
            assertThat(emitter.completed).isTrue();
            assertThat(emitter.completedDuringDelivery).isFalse();
            assertThat(emitter.payloads).doesNotContain(Map.of("type", "purchase_completed"));
        } finally {
            emitter.releaseDelivery.countDown();
            workers.shutdownNow();
            assertThat(workers.awaitTermination(5, TimeUnit.SECONDS)).isTrue();
            notifications.disconnectSession("slow-session");
        }
    }

    @SuppressWarnings("unchecked")
    private SessionRepository<MapSession> sessions() {
        SessionRepository<MapSession> sessions = mock(SessionRepository.class);
        when(sessions.findById(anyString())).thenAnswer(call -> new MapSession());
        return sessions;
    }

    private Authentication authentication(String accountId) {
        Authentication authentication = mock(Authentication.class);
        when(authentication.getName()).thenReturn(accountId);
        return authentication;
    }

    private boolean isContractPayload(Object payload) {
        return Map.of("status", "connected").equals(payload)
            || Map.of("type", "inventory_changed").equals(payload)
            || Map.of("type", "purchase_completed").equals(payload)
            || Map.of("type", "alerts_changed").equals(payload)
            || Map.of("type", "heartbeat").equals(payload);
    }

    private static class RecordingEmitter extends SseEmitter {
        final List<Object> payloads = new ArrayList<>();
        volatile boolean completed;

        @Override
        public void complete() {
            completed = true;
            super.complete();
        }

        @Override
        public void send(SseEventBuilder builder) throws IOException {
            for (DataWithMediaType part : builder.build()) {
                payloads.add(part.getData());
            }
        }
    }

    private static class BlockingEmitter extends RecordingEmitter {
        final CountDownLatch deliveryStarted = new CountDownLatch(1);
        final CountDownLatch releaseDelivery = new CountDownLatch(1);
        volatile boolean blockDelivery;
        volatile boolean delivering;
        volatile boolean completedDuringDelivery;

        @Override
        public void send(SseEventBuilder builder) throws IOException {
            delivering = true;
            try {
                if (blockDelivery) {
                    deliveryStarted.countDown();
                    try {
                        if (!releaseDelivery.await(10, TimeUnit.SECONDS)) throw new IOException("Delivery timed out");
                    } catch (InterruptedException e) {
                        Thread.currentThread().interrupt();
                        throw new IOException(e);
                    }
                }
                super.send(builder);
            } finally {
                delivering = false;
            }
        }

        @Override
        public void complete() {
            completedDuringDelivery |= delivering;
            super.complete();
        }
    }
}
