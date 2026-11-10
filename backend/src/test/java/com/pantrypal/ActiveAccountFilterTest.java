package com.pantrypal;

import java.util.concurrent.atomic.AtomicBoolean;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.*;

class ActiveAccountFilterTest {
    @Test void staleSessionSavedAfterDeletionIsInvalidatedBeforeAnyApiHandler() throws Exception {
        var jdbc = mock(JdbcTemplate.class);
        when(jdbc.queryForObject("SELECT COUNT(*) FROM accounts WHERE id=?", Integer.class, 137L)).thenReturn(0);
        var request = new MockHttpServletRequest("GET", "/api/inventory");
        var session = new MockHttpSession(); request.setSession(session);
        var response = new MockHttpServletResponse();
        var handled = new AtomicBoolean();
        try {
            SecurityContextHolder.getContext().setAuthentication(UsernamePasswordAuthenticationToken.authenticated("137", null, java.util.List.of()));
            new ActiveAccountFilter(jdbc).doFilter(request, response, (req, res) -> handled.set(true));
            assertThat(response.getStatus()).isEqualTo(401);
            assertThat(session.isInvalid()).isTrue();
            assertThat(SecurityContextHolder.getContext().getAuthentication()).isNull();
            assertThat(handled).isFalse();
        } finally { SecurityContextHolder.clearContext(); }
    }
}
