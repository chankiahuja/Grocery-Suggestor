package com.pantrypal;

import java.io.IOException;
import java.time.Instant;
import java.time.Duration;
import java.util.ArrayList;
import java.util.ArrayDeque;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.stream.Stream;
import java.lang.reflect.Field;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.security.core.Authentication;
import org.springframework.session.MapSession;
import org.springframework.session.SessionRepository;
import org.springframework.transaction.CannotCreateTransactionException;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.*;

class NotificationEventsTest {
    @Test void deletionClosesEveryAccountStreamAndSuppressesQueuedSignalsWithoutClosingAnotherAccount() {
        var queued = new ArrayDeque<Runnable>();
        var notifications = new NotificationEvents(mock(PantryService.class), sessions(), queued::add);
        var first = new RecordingEmitter(); var second = new RecordingEmitter(); var other = new RecordingEmitter();
        notifications.subscribe(authentication("1"), "first", first);
        notifications.subscribe(authentication("1"), "second", second);
        notifications.subscribe(authentication("2"), "other", other);
        notifications.changed(new PantryService.PantryChanged("inventory_changed", 1L, 1L));
        notifications.deleted(new AccountDeletionService.AccountDeleted(1));
        queued.remove().run();
        assertThat(first.completed).isTrue(); assertThat(second.completed).isTrue();
        assertThat(other.completed).isFalse();
        assertThat(first.payloads).doesNotContain(Map.of("type", "inventory_changed"));
        assertThat(second.payloads).doesNotContain(Map.of("type", "inventory_changed"));
    }
    @Test
    void committedSignalsEnqueueWithoutSessionLookupAndRevalidateBeforeDelivery() {
        var sessions = sessions();
        var queued = new ArrayDeque<Runnable>();
        var notifications = new NotificationEvents(mock(PantryService.class), sessions, queued::add);
        var alice = new RecordingEmitter();
        var bob = new RecordingEmitter();
        notifications.subscribe(authentication("1"), "alice", alice);
        notifications.subscribe(authentication("2"), "bob", bob);
        clearInvocations((Object) sessions);

        notifications.changed(new PantryService.PantryChanged("inventory_changed", 41L, 1L));
        assertThat(queued).hasSize(1);
        verifyNoInteractions(sessions);
        assertThat(alice.payloads).doesNotContain(Map.of("type", "inventory_changed"));
        queued.remove().run();
        assertThat(alice.payloads).contains(Map.of("type", "inventory_changed"));
        assertThat(bob.payloads).doesNotContain(Map.of("type", "inventory_changed"));

        notifications.changed(new PantryService.PantryChanged("purchase_completed", null, 1L));
        when(sessions.findById("alice")).thenReturn(null);
        queued.remove().run();
        assertThat(alice.completed).isTrue();
        assertThat(alice.payloads).doesNotContain(Map.of("type", "purchase_completed"));
    }

    @Test
    void logoutPreventsDeliveryOfAnAlreadyQueuedSignal() {
        var queued = new ArrayDeque<Runnable>();
        var notifications = new NotificationEvents(mock(PantryService.class), sessions(), queued::add);
        var emitter = new RecordingEmitter();
        notifications.subscribe(authentication("1"), "revoked", emitter);
        notifications.changed(new PantryService.PantryChanged("inventory_changed", 41L, 1L));
        notifications.disconnectSession("revoked");
        queued.remove().run();
        assertThat(emitter.completed).isTrue();
        assertThat(emitter.payloads).doesNotContain(Map.of("type", "inventory_changed"));
    }

    @Test
    void subscriptionRacingWithSessionRotationCannotLeaveAnActiveStream() throws Exception {
        var registrationWindowEntered = new CountDownLatch(1);
        var releaseRegistration = new CountDownLatch(1);
        var revocationStarted = new CountDownLatch(1);
        var notifications = new NotificationEvents(mock(PantryService.class), sessions()) {
            @Override
            void beforeSubscriberRegistration(String sessionId) {
                if ("rotated-session".equals(sessionId)) {
                    registrationWindowEntered.countDown();
                    await(releaseRegistration);
                }
            }

            @Override
            void beforeSessionRevocation(String sessionId) {
                if ("rotated-session".equals(sessionId)) revocationStarted.countDown();
            }
        };
        var emitter = new RecordingEmitter();
        var workers = Executors.newFixedThreadPool(2);
        try {
            var subscription = workers.submit(() -> notifications.subscribe(
                authentication("1"), "rotated-session", emitter));
            assertThat(registrationWindowEntered.await(5, TimeUnit.SECONDS)).isTrue();

            var revocation = workers.submit(() -> notifications.disconnectSession("rotated-session"));
            assertThat(revocationStarted.await(5, TimeUnit.SECONDS)).isTrue();
            releaseRegistration.countDown();
            subscription.get(5, TimeUnit.SECONDS);
            revocation.get(5, TimeUnit.SECONDS);

            notifications.changed(new PantryService.PantryChanged("inventory_changed", 41L, 1L));
            assertThat(emitter.completed).isTrue();
            assertThat(emitter.payloads).doesNotContain(Map.of("type", "inventory_changed"));
            assertThat(subscriberCount(notifications)).isZero();
        } finally {
            releaseRegistration.countDown();
            workers.shutdownNow();
            assertThat(workers.awaitTermination(5, TimeUnit.SECONDS)).isTrue();
            notifications.disconnectSession("rotated-session");
        }
    }

    @Test
    void alreadyClosedSubscriberDoesNotRevokeItsStillActiveSession() throws Exception {
        var sessions = sessions();
        var workers = Executors.newFixedThreadPool(2);
        var broadcasts = new ArrayList<java.util.concurrent.Future<?>>();
        var secondBroadcastRetainedSubscriber = new CountDownLatch(1);
        var releaseSecondBroadcast = new CountDownLatch(1);
        var notifications = new NotificationEvents(mock(PantryService.class), sessions, command ->
            broadcasts.add(workers.submit(command))) {
            @Override
            void beforeSubscriberSend(String sessionId, String type) {
                if ("shared-session".equals(sessionId) && "purchase_completed".equals(type)) {
                    secondBroadcastRetainedSubscriber.countDown();
                    await(releaseSecondBroadcast);
                }
            }
        };
        var failing = new FailingEmitter();
        var surviving = new RecordingEmitter();
        notifications.subscribe(authentication("1"), "shared-session", failing);
        notifications.subscribe(authentication("1"), "shared-session", surviving);
        try {
            failing.failNextSend = true;
            notifications.changed(new PantryService.PantryChanged("inventory_changed", 41L, 1L));
            assertThat(failing.sendStarted.await(5, TimeUnit.SECONDS)).isTrue();
            notifications.changed(new PantryService.PantryChanged("purchase_completed", null, 1L));
            assertThat(secondBroadcastRetainedSubscriber.await(5, TimeUnit.SECONDS)).isTrue();

            // The second broadcast has retained the failing subscriber. Close and
            // remove it in the first broadcast before allowing the second send.
            failing.releaseSend.countDown();
            broadcasts.get(0).get(5, TimeUnit.SECONDS);
            releaseSecondBroadcast.countDown();
            broadcasts.get(1).get(5, TimeUnit.SECONDS);

            // The second broadcast observed a closed subscriber. It must not
            // revoke the still-valid session or close its other stream.
            notifications.changed(new PantryService.PantryChanged("alerts_changed", null, 1L));
            broadcasts.get(2).get(5, TimeUnit.SECONDS);
            assertThat(surviving.payloads).contains(Map.of("type", "alerts_changed"));
            assertThat(surviving.completed).isFalse();
        } finally {
            failing.releaseSend.countDown();
            releaseSecondBroadcast.countDown();
            notifications.disconnectSession("shared-session");
            workers.shutdownNow();
            assertThat(workers.awaitTermination(5, TimeUnit.SECONDS)).isTrue();
        }
    }

    @Test
    void registeredEmitterCallbacksRemoveUnusedSessionGuards() throws Exception {
        var notifications = new NotificationEvents(mock(PantryService.class), sessions());
        var completed = new RecordingEmitter();
        var timedOut = new RecordingEmitter();
        var failed = new RecordingEmitter();
        notifications.subscribe(authentication("1"), "completed-session", completed);
        notifications.subscribe(authentication("1"), "timed-out-session", timedOut);
        notifications.subscribe(authentication("1"), "failed-session", failed);

        completed.fireCompletion();
        timedOut.fireTimeout();
        failed.fireError(new IOException("client disconnected"));

        assertThat(sessionGuardCount(notifications)).isZero();
        assertThat(subscriberCount(notifications)).isZero();
    }

    @Test
    void failedInitialRegistrationRemovesItsGuardWithoutCreatingARevocationTombstone() throws Exception {
        var sessions = sessions();
        when(sessions.findById("failed-registration")).thenThrow(
            new DataAccessResourceFailureException("Session store unavailable"));
        var notifications = new NotificationEvents(mock(PantryService.class), sessions);
        notifications.subscribe(authentication("1"), "failed-registration", new RecordingEmitter());

        assertThat(sessionGuardCount(notifications)).isZero();
        assertThat(revokedSessionCount(notifications)).isZero();
    }

    @Test
    void saturatedDeliveryQueueDoesNotBlockOrRunOnThePublisherThread() throws Exception {
        var executor = new NotificationDeliveryConfig().notificationDeliveryExecutor();
        executor.initialize();
        var started = new CountDownLatch(1);
        var release = new CountDownLatch(1);
        try {
            executor.execute(() -> {
                started.countDown();
                try { release.await(); }
                catch (InterruptedException e) { Thread.currentThread().interrupt(); }
            });
            assertThat(started.await(5, TimeUnit.SECONDS)).isTrue();
            for (int i = 0; i < 128; i++) executor.execute(() -> {});
            assertThat(executor.getThreadPoolExecutor().getQueue()).hasSize(128);
            var sessions = sessions();
            var notifications = new NotificationEvents(mock(PantryService.class), sessions, executor);
            var emitter = new RecordingEmitter();
            notifications.subscribe(authentication("1"), "active", emitter);
            clearInvocations((Object) sessions);
            notifications.changed(new PantryService.PantryChanged("inventory_changed", 41L, 1L));
            verifyNoInteractions(sessions);
            assertThat(executor.getThreadPoolExecutor().getQueue()).hasSize(128);
            assertThat(emitter.payloads).doesNotContain(Map.of("type", "inventory_changed"));
        } finally {
            release.countDown();
            executor.shutdown();
        }
    }

    private static Stream<RuntimeException> sessionLookupFailures() {
        return Stream.of(
            new DataAccessResourceFailureException("Session store unavailable"),
            new CannotCreateTransactionException("Could not open session transaction"));
    }

    @ParameterizedTest
    @MethodSource("sessionLookupFailures")
    void initialSessionLookupFailureClosesAndRemovesSubscriberWithoutSendingReady(RuntimeException failure) {
        var sessions = sessions();
        when(sessions.findById("unavailable")).thenThrow(failure);
        PantryService service = mock(PantryService.class);
        when(service.accountIds()).thenReturn(List.of());
        var notifications = new NotificationEvents(service, sessions);
        var emitter = new RecordingEmitter();

        assertThat(notifications.subscribe(authentication("1"), "unavailable", emitter)).isSameAs(emitter);
        assertThat(emitter.completed).isTrue();
        assertThat(emitter.payloads).isEmpty();

        // A closed subscriber must also leave the registry, even before another broadcast.
        doReturn(new MapSession()).when(sessions).findById("unavailable");
        notifications.checkExpiry();
        notifications.changed(new PantryService.PantryChanged("inventory_changed", 41L, 1L));
        verify(sessions, times(1)).findById("unavailable");
        assertThat(emitter.payloads).isEmpty();
    }

    @ParameterizedTest
    @MethodSource("sessionLookupFailures")
    void broadcastSkipsFailedSessionLookupContinuesOtherSubscribersAndRecovers(RuntimeException failure) {
        var sessions = sessions();
        var notifications = new NotificationEvents(mock(PantryService.class), sessions);
        var unavailable = new RecordingEmitter();
        var healthy = new RecordingEmitter();
        var otherAccount = new RecordingEmitter();
        notifications.subscribe(authentication("1"), "unavailable", unavailable);
        notifications.subscribe(authentication("1"), "healthy", healthy);
        notifications.subscribe(authentication("2"), "other-account", otherAccount);
        var readyPayloads = List.copyOf(unavailable.payloads);
        when(sessions.findById("unavailable")).thenThrow(failure);

        notifications.changed(new PantryService.PantryChanged("inventory_changed", 41L, 1L));
        assertThat(unavailable.payloads).containsExactlyElementsOf(readyPayloads);
        assertThat(unavailable.completed).isFalse();
        assertThat(healthy.payloads).contains(Map.of("type", "inventory_changed"));
        assertThat(otherAccount.payloads).doesNotContain(Map.of("type", "inventory_changed"));

        notifications.changed(new PantryService.PantryChanged("purchase_completed", null, 2L));
        assertThat(otherAccount.payloads).contains(Map.of("type", "purchase_completed"));
        doReturn(new MapSession()).when(sessions).findById("unavailable");
        notifications.changed(new PantryService.PantryChanged("purchase_completed", null, 1L));
        assertThat(unavailable.payloads).contains(Map.of("type", "purchase_completed"));
        assertThat(unavailable.payloads).doesNotContain(Map.of("type", "inventory_changed"));
    }

    @ParameterizedTest
    @MethodSource("sessionLookupFailures")
    void expiryCheckContinuesCleanupAndBroadcastsAfterSessionLookupFailure(RuntimeException failure) {
        var sessions = sessions();
        PantryService service = mock(PantryService.class);
        when(service.accountIds()).thenReturn(List.of(1L, 2L));
        when(service.suggestions(anyLong())).thenReturn(List.of());
        var notifications = new NotificationEvents(service, sessions);
        var unavailable = new RecordingEmitter();
        var deleted = new RecordingEmitter();
        var healthy = new RecordingEmitter();
        var otherAccount = new RecordingEmitter();
        notifications.subscribe(authentication("1"), "unavailable", unavailable);
        notifications.subscribe(authentication("1"), "deleted", deleted);
        notifications.subscribe(authentication("1"), "healthy", healthy);
        notifications.subscribe(authentication("2"), "other-account", otherAccount);
        when(sessions.findById("unavailable")).thenThrow(failure);
        when(sessions.findById("deleted")).thenReturn(null);

        notifications.checkExpiry();
        assertThat(unavailable.completed).isFalse();
        assertThat(unavailable.payloads).doesNotContain(Map.of("type", "heartbeat"));
        assertThat(deleted.completed).isTrue();
        assertThat(deleted.payloads).doesNotContain(Map.of("type", "heartbeat"));
        assertThat(healthy.payloads).contains(Map.of("type", "heartbeat"));
        assertThat(otherAccount.payloads).contains(Map.of("type", "heartbeat"));

        doReturn(new MapSession()).when(sessions).findById("unavailable");
        notifications.checkExpiry();
        assertThat(unavailable.payloads).contains(Map.of("type", "heartbeat"));
    }

    @ParameterizedTest
    @MethodSource("sessionLookupFailures")
    void scheduledBroadcastRevalidatesSessionsAndIsolatesALookupFailureAfterTheExpirySweep(RuntimeException failure) {
        var sessions = sessions();
        PantryService service = mock(PantryService.class);
        when(service.accountIds()).thenReturn(List.of(1L));
        when(service.suggestions(1L)).thenReturn(List.of(Map.of("name", "Milk", "urgency", "critical")));
        var notifications = new NotificationEvents(service, sessions);
        var unavailable = new RecordingEmitter();
        var healthy = new RecordingEmitter();
        notifications.subscribe(authentication("1"), "unavailable", unavailable);
        notifications.subscribe(authentication("1"), "healthy", healthy);
        when(sessions.findById("unavailable")).thenReturn(new MapSession())
            .thenThrow(failure);

        notifications.checkExpiry();
        assertThat(unavailable.payloads).doesNotContain(Map.of("type", "alerts_changed"));
        assertThat(healthy.payloads).contains(Map.of("type", "alerts_changed"));
        assertThat(unavailable.completed).isFalse();
    }

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
    void simultaneousSessionsForOneAccountRemainIndependentAcrossRevocation() {
        NotificationEvents notifications = new NotificationEvents(mock(PantryService.class), sessions());
        var firstSession = new RecordingEmitter();
        var secondSession = new RecordingEmitter();
        notifications.subscribe(authentication("1"), "same-account-a", firstSession);
        notifications.subscribe(authentication("1"), "same-account-b", secondSession);

        notifications.disconnectSession("same-account-a");
        notifications.changed(new PantryService.PantryChanged("inventory_changed", 41L, 1L));

        assertThat(firstSession.completed).isTrue();
        assertThat(firstSession.payloads).doesNotContain(Map.of("type", "inventory_changed"));
        assertThat(secondSession.completed).isFalse();
        assertThat(secondSession.payloads).contains(Map.of("type", "inventory_changed"));
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

    @Test
    void stalledDeliveryForOneAccountDoesNotDelayLogoutForAnotherAccount() throws Exception {
        var notifications = new NotificationEvents(mock(PantryService.class), sessions());
        var stalled = new BlockingEmitter();
        var other = new RecordingEmitter();
        notifications.subscribe(authentication("1"), "account-a-session", stalled);
        notifications.subscribe(authentication("2"), "account-b-session", other);
        stalled.blockDelivery = true;

        var workers = Executors.newFixedThreadPool(2);
        try {
            var delivery = workers.submit(() -> notifications.changed(
                new PantryService.PantryChanged("inventory_changed", 41L, 1L)));
            assertThat(stalled.deliveryStarted.await(5, TimeUnit.SECONDS)).isTrue();

            var logout = workers.submit(() -> notifications.disconnectSession("account-b-session"));
            logout.get(2, TimeUnit.SECONDS);
            assertThat(other.completed).isTrue();

            stalled.releaseDelivery.countDown();
            delivery.get(5, TimeUnit.SECONDS);
            assertThat(stalled.completed).isFalse();
        } finally {
            stalled.releaseDelivery.countDown();
            workers.shutdownNow();
            assertThat(workers.awaitTermination(5, TimeUnit.SECONDS)).isTrue();
            notifications.disconnectSession("account-a-session");
        }
    }

    @Test
    void expiredSessionReceivesNoSignalBeforeTheNextCleanupSweep() {
        var sessions = sessions();
        var notifications = new NotificationEvents(mock(PantryService.class), sessions);
        var emitter = new RecordingEmitter();
        notifications.subscribe(authentication("1"), "expired-before-sweep", emitter);
        emitter.payloads.clear();

        var expired = new MapSession();
        expired.setLastAccessedTime(Instant.EPOCH);
        expired.setMaxInactiveInterval(Duration.ofSeconds(1));
        when(sessions.findById("expired-before-sweep")).thenReturn(expired);

        notifications.changed(new PantryService.PantryChanged("inventory_changed", 41L, 1L));
        assertThat(emitter.payloads).doesNotContain(Map.of("type", "inventory_changed"));
        assertThat(emitter.completed).isTrue();

        notifications.checkExpiry();
        assertThat(emitter.payloads).doesNotContain(Map.of("type", "heartbeat"));
    }

    @Test
    void expiredRevocationTombstonesAndGuardsAreCleanedDuringTheExpirySweep() throws Exception {
        var sessions = sessions();
        var notifications = new NotificationEvents(mock(PantryService.class), sessions);
        notifications.disconnectSession("expired-tombstone");
        var blocked = new RecordingEmitter();
        notifications.subscribe(authentication("1"), "expired-tombstone", blocked);
        assertThat(blocked.completed).isTrue();
        assertThat(subscriberCount(notifications)).isZero();
        assertThat(revokedSessionCount(notifications)).isOne();

        var expired = new MapSession();
        expired.setLastAccessedTime(Instant.EPOCH);
        expired.setMaxInactiveInterval(Duration.ofSeconds(1));
        when(sessions.findById("expired-tombstone")).thenReturn(expired);

        notifications.checkExpiry();
        assertThat(sessionGuardCount(notifications)).isZero();
        assertThat(revokedSessionCount(notifications)).isZero();

        var expiredAgain = new RecordingEmitter();
        notifications.subscribe(authentication("1"), "expired-tombstone", expiredAgain);
        assertThat(expiredAgain.completed).isTrue();
        assertThat(expiredAgain.payloads).isEmpty();
        assertThat(subscriberCount(notifications)).isZero();
    }

    @Test
    void concurrentCleanupAndSubscriptionShareTheSessionGuardAndPreserveOtherSessions() throws Exception {
        var sessions = sessions();
        var service = mock(PantryService.class);
        when(service.accountIds()).thenReturn(List.of(1L));
        when(service.suggestions(1L)).thenReturn(List.of());
        var notifications = new NotificationEvents(service, sessions);
        var active = new RecordingEmitter();
        notifications.subscribe(authentication("1"), "active-session", active);

        var expired = new MapSession();
        expired.setLastAccessedTime(Instant.EPOCH);
        expired.setMaxInactiveInterval(Duration.ofSeconds(1));
        when(sessions.findById("active-session")).thenReturn(expired);

        var start = new CountDownLatch(1);
        var workers = Executors.newFixedThreadPool(2);
        try {
            var cleanup = workers.submit(() -> {
                await(start);
                notifications.checkExpiry();
            });
            var subscribe = workers.submit(() -> {
                await(start);
                return notifications.subscribe(authentication("1"), "active-session", new RecordingEmitter());
            });
            start.countDown();
            cleanup.get(5, TimeUnit.SECONDS);
            var replacement = (RecordingEmitter) subscribe.get(5, TimeUnit.SECONDS);

            notifications.checkExpiry();
            assertThat(active.completed).isTrue();
            assertThat(replacement.completed).isTrue();
            assertThat(active.payloads).doesNotContain(Map.of("type", "heartbeat"));
            assertThat(replacement.payloads).doesNotContain(Map.of("type", "heartbeat"));
            assertThat(subscriberCount(notifications)).isZero();
            assertThat(sessionGuardCount(notifications)).isZero();
        } finally {
            workers.shutdownNow();
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

    private void await(CountDownLatch latch) {
        try {
            assertThat(latch.await(5, TimeUnit.SECONDS)).isTrue();
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new AssertionError(e);
        }
    }

    private boolean isContractPayload(Object payload) {
        return Map.of("status", "connected").equals(payload)
            || Map.of("type", "inventory_changed").equals(payload)
            || Map.of("type", "purchase_completed").equals(payload)
            || Map.of("type", "alerts_changed").equals(payload)
            || Map.of("type", "heartbeat").equals(payload);
    }

    @SuppressWarnings("unchecked")
    private int sessionGuardCount(NotificationEvents notifications) throws Exception {
        Field field = NotificationEvents.class.getDeclaredField("sessionGuards");
        field.setAccessible(true);
        return ((Map<String, ?>) field.get(notifications)).size();
    }

    @SuppressWarnings("unchecked")
    private int subscriberCount(NotificationEvents notifications) throws Exception {
        Field field = NotificationEvents.class.getDeclaredField("clients");
        field.setAccessible(true);
        return ((Map<Long, java.util.concurrent.CopyOnWriteArrayList<?>>) field.get(notifications))
            .values().stream().mapToInt(List::size).sum();
    }

    @SuppressWarnings("unchecked")
    private int revokedSessionCount(NotificationEvents notifications) throws Exception {
        Field field = NotificationEvents.class.getDeclaredField("revokedSessions");
        field.setAccessible(true);
        return ((java.util.Set<String>) field.get(notifications)).size();
    }

    private static class RecordingEmitter extends SseEmitter {
        final List<Object> payloads = new ArrayList<>();
        volatile boolean completed;
        private Runnable completionCallback;
        private Runnable timeoutCallback;
        private java.util.function.Consumer<Throwable> errorCallback;

        @Override
        public void onCompletion(Runnable callback) {
            completionCallback = callback;
            super.onCompletion(callback);
        }

        @Override
        public void onTimeout(Runnable callback) {
            timeoutCallback = callback;
            super.onTimeout(callback);
        }

        @Override
        public void onError(java.util.function.Consumer<Throwable> callback) {
            errorCallback = callback;
            super.onError(callback);
        }

        void fireCompletion() {
            completionCallback.run();
        }

        void fireTimeout() {
            timeoutCallback.run();
        }

        void fireError(Throwable error) {
            errorCallback.accept(error);
        }

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

    private static class FailingEmitter extends RecordingEmitter {
        final CountDownLatch sendStarted = new CountDownLatch(1);
        final CountDownLatch releaseSend = new CountDownLatch(1);
        volatile boolean failNextSend;

        @Override
        public void send(SseEventBuilder builder) throws IOException {
            if (failNextSend) {
                failNextSend = false;
                sendStarted.countDown();
                try {
                    if (!releaseSend.await(5, TimeUnit.SECONDS)) throw new IOException("send timed out");
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                    throw new IOException(e);
                }
                throw new IOException("simulated send failure");
            }
            super.send(builder);
        }
    }
}
