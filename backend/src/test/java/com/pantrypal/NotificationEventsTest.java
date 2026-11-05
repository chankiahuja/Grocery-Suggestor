package com.pantrypal;

import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.security.core.Authentication;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter.SseEventBuilder;
import org.springframework.web.servlet.mvc.method.annotation.ResponseBodyEmitter.DataWithMediaType;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.*;

class NotificationEventsTest {
    @Test
    void inventoryAndPurchaseEventsOnlyReachTheirAccount() throws IOException {
        PantryService service = mock(PantryService.class);
        NotificationEvents notifications = new NotificationEvents(service);
        var alice = new RecordingEmitter();
        var bob = new RecordingEmitter();
        notifications.subscribe(authentication("1"), alice);
        notifications.subscribe(authentication("2"), bob);

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
        NotificationEvents notifications = new NotificationEvents(mock(PantryService.class));
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
        NotificationEvents notifications = new NotificationEvents(service);
        var alice = new RecordingEmitter();
        var bob = new RecordingEmitter();
        notifications.subscribe(authentication("1"), alice);
        notifications.subscribe(authentication("2"), bob);

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
        NotificationEvents notifications = new NotificationEvents(service);
        Authentication authentication = mock(Authentication.class);
        when(authentication.getName()).thenReturn("not-an-account-id");

        assertThat(org.assertj.core.api.Assertions.catchThrowable(
            () -> notifications.subscribe(authentication, (String) null, new RecordingEmitter())))
            .isInstanceOf(NumberFormatException.class);
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
        private final List<Object> payloads = new ArrayList<>();

        @Override
        public void send(SseEventBuilder builder) throws IOException {
            for (DataWithMediaType part : builder.build()) {
                payloads.add(part.getData());
            }
        }
    }
}
