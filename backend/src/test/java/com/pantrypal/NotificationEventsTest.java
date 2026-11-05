package com.pantrypal;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.*;

class NotificationEventsTest {
    @Test
    void expiryChangesAreComparedPerAccountAndOnlySignalTypesAreBroadcast() {
        PantryService service = mock(PantryService.class);
        when(service.accountIds()).thenReturn(List.of(1L, 2L));
        when(service.suggestions(1L)).thenReturn(List.of());
        when(service.suggestions(2L)).thenReturn(List.of());

        List<String> signals = new ArrayList<>();
        NotificationEvents notifications = new NotificationEvents(service) {
            @Override
            void broadcast(String type) {
                signals.add(type);
            }
        };

        notifications.checkExpiry();
        assertThat(signals).containsExactly("heartbeat");

        when(service.suggestions(1L)).thenReturn(
            List.of(Map.of("name", "Alice milk", "urgency", "expiring_soon")));
        notifications.checkExpiry();
        assertThat(signals).containsExactly("heartbeat", "alerts_changed");

        when(service.suggestions(1L)).thenReturn(List.of());
        notifications.checkExpiry();
        assertThat(signals).containsExactly("heartbeat", "alerts_changed", "alerts_changed");

        verify(service, times(3)).suggestions(1L);
        verify(service, times(3)).suggestions(2L);
        verify(service, never()).suggestions();
        assertThat(signals).containsOnly("heartbeat", "alerts_changed");
    }
}
