package com.pantrypal;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.Cookie;
import java.time.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicLong;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mail.MailSendException;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.web.server.ResponseStatusException;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest
@AutoConfigureMockMvc
class AuthFlowTest {
    @Autowired MockMvc mvc;
    @Autowired ObjectMapper json;
    @Autowired JdbcTemplate jdbc;
    @Autowired AuthService auth;
    @MockitoBean OtpMailSender mail;
    @MockitoBean Clock clock;
    final AtomicLong now = new AtomicLong();
    final Map<String,String> codes = new ConcurrentHashMap<>();
    @BeforeEach void setup() {
        jdbc.update("DELETE FROM spring_session");
        jdbc.update("DELETE FROM email_challenges");
        jdbc.update("DELETE FROM auth_rate_limits");
        jdbc.update("DELETE FROM accounts");
        now.set(Instant.parse("2026-11-03T05:00:00Z").toEpochMilli());
        codes.clear();
        when(clock.millis()).thenAnswer(call -> now.get());
        doAnswer(call -> { codes.put(call.getArgument(0), call.getArgument(1)); return null; })
            .when(mail).send(anyString(), anyString(), anyLong());
    }
    class Browser {
        Cookie cookie;
        String csrf;
        JsonNode read(MvcResult result) throws Exception {
            Cookie next = result.getResponse().getCookie("PANTRYPAL_SESSION");
            if (next != null) cookie = next;
            JsonNode body = json.readTree(result.getResponse().getContentAsString());
            if (body.has("csrfToken")) csrf = body.get("csrfToken").asText();
            return body;
        }
        JsonNode session() throws Exception {
            var request = get("/api/auth/session");
            if (cookie != null) request.cookie(cookie);
            return read(mvc.perform(request)
                .andExpect(status().isOk()).andReturn());
        }
        JsonNode post(String path, Object body, int expected) throws Exception {
            var request = postRequest(path).content(json.writeValueAsString(body));
            return read(mvc.perform(request).andExpect(status().is(expected)).andReturn());
        }
        org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder postRequest(String path) {
            var request = org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post(path)
                .header("X-CSRF-TOKEN", csrf).contentType("application/json");
            if (cookie != null) request.cookie(cookie);
            return request;
        }
        JsonNode requestCode(String email) throws Exception {
            return post("/api/auth/code", Map.of("email", email, "intent", "signup", "name", "Test Person"), 200);
        }
        JsonNode verify(String email, JsonNode challenge, String code, int expected) throws Exception {
            return post("/api/auth/verify", Map.of("email", email, "challengeId", challenge.get("challengeId").asText(), "code", code), expected);
        }
    }

    @Test void sessionIsRotatedPersistedRestoredAndRevokedByLogout() throws Exception {
        var browser = new Browser();
        assertThat(browser.session().get("authenticated").asBoolean()).isFalse();
        Cookie anonymous = browser.cookie;
        assertThat(anonymous.isHttpOnly()).isTrue();
        assertThat(anonymous.getAttribute("SameSite")).isEqualTo("Lax");
        var challenge = browser.requestCode("Person@Example.com");
        assertThat(codes.get("person@example.com")).matches("[0-9]{6}").isNotEqualTo("123456");
        String stored = jdbc.queryForObject("SELECT code_hash FROM email_challenges WHERE email='person@example.com'", String.class);
        assertThat(stored).hasSize(64).isNotEqualTo(codes.get("person@example.com"));
        var session = browser.verify("PERSON@example.com", challenge, codes.get("person@example.com"), 200);
        assertThat(session.get("account").get("name").asText()).isEqualTo("Test Person");
        assertThat(browser.cookie.getValue()).isNotEqualTo(anonymous.getValue());
        Cookie authenticated = browser.cookie;
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM spring_session WHERE principal_name IS NOT NULL", Integer.class)).isEqualTo(1);
        var refreshed = new Browser();
        refreshed.cookie = authenticated;
        assertThat(refreshed.session().get("authenticated").asBoolean()).isTrue();
        mvc.perform(get("/api/inventory").cookie(authenticated)).andExpect(status().isOk());
        mvc.perform(get("/api/inventory").cookie(anonymous)).andExpect(status().isUnauthorized());
        String tokenBeforeLogout = refreshed.csrf;
        assertThat(refreshed.post("/api/auth/logout", Map.of(), 200).get("authenticated").asBoolean()).isFalse();
        assertThat(refreshed.csrf).isNotEqualTo(tokenBeforeLogout);
        mvc.perform(get("/api/inventory").cookie(authenticated)).andExpect(status().isUnauthorized());
        assertThat(new Browser().session().get("authenticated").asBoolean()).isFalse();
    }

    @Test void csrfAndAuthenticationAreEnforcedOnApiAndLogout() throws Exception {
        mvc.perform(get("/api/healthz")).andExpect(status().isOk());
        for (String path : List.of("/api/inventory", "/api/suggestions", "/api/shopping-lists", "/api/notifications/stream")) {
            mvc.perform(get(path)).andExpect(status().isUnauthorized());
        }
        mvc.perform(post("/api/auth/code").contentType("application/json").content("{\"email\":\"a@example.com\",\"intent\":\"login\"}"))
            .andExpect(status().isForbidden());
        var browser = new Browser(); browser.session();
        var challenge = browser.requestCode("a@example.com");
        browser.verify("a@example.com", challenge, codes.get("a@example.com"), 200);
        mvc.perform(post("/api/auth/logout").cookie(browser.cookie)).andExpect(status().isForbidden());
        mvc.perform(post("/api/inventory").cookie(browser.cookie).contentType("application/json").content("{}"))
            .andExpect(status().isForbidden());
        browser.post("/api/inventory", Map.of("name", "Auth test", "category", "Other", "quantity", 1, "unit", "each", "minThreshold", 0), 201);
        jdbc.update("DELETE FROM inventory_items WHERE name='Auth test'");
    }

    @Test void demoCodeFailsAndAttemptsRemainLimitedAcrossRequests() throws Exception {
        var browser = new Browser(); browser.session();
        var challenge = browser.requestCode("attempts@example.com");
        for (int attempt = 0; attempt < 5; attempt++) browser.verify("attempts@example.com", challenge, "123456", 400);
        browser.verify("attempts@example.com", challenge, codes.get("attempts@example.com"), 429);
        assertThat(jdbc.queryForObject("SELECT attempts FROM email_challenges WHERE email='attempts@example.com'", Integer.class)).isEqualTo(5);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM accounts", Integer.class)).isZero();
    }

    @Test void loginForUnknownEmailDoesNotCreateAccountOrRevealItsExistenceAtCodeRequest() throws Exception {
        var browser = new Browser(); browser.session();
        var login = browser.post("/api/auth/code", Map.of("email", "new@example.com", "intent", "login"), 200);
        assertThat(login.get("challengeId").asText()).isNotBlank();
        browser.verify("new@example.com", login, codes.get("new@example.com"), 400);
        assertThat(browser.session().get("authenticated").asBoolean()).isFalse();
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM accounts WHERE email='new@example.com'", Integer.class)).isZero();
        assertThat(jdbc.queryForObject("SELECT used FROM email_challenges WHERE email='new@example.com'", Boolean.class)).isTrue();

        now.addAndGet(30_000);
        var signup = browser.post("/api/auth/code", Map.of("email", "new@example.com", "intent", "signup", "name", "New Person"), 200);
        var registered = browser.verify("new@example.com", signup, codes.get("new@example.com"), 200);
        assertThat(registered.get("account").get("name").asText()).isEqualTo("New Person");

        now.addAndGet(30_000);
        var existingLogin = browser.post("/api/auth/code", Map.of("email", "new@example.com", "intent", "login"), 200);
        var signedIn = browser.verify("new@example.com", existingLogin, codes.get("new@example.com"), 200);
        assertThat(signedIn.get("account").get("name").asText()).isEqualTo("New Person");
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM accounts WHERE email='new@example.com'", Integer.class)).isEqualTo(1);
    }

    @Test void resendHasServerCooldownAndInvalidatesEarlierChallenge() throws Exception {
        var browser = new Browser(); browser.session();
        var first = browser.requestCode("resend@example.com");
        String firstCode = codes.get("resend@example.com");
        browser.post("/api/auth/code", Map.of("email", "RESEND@example.com", "intent", "login"), 429);
        now.addAndGet(30_000);
        var second = browser.requestCode("resend@example.com");
        assertThat(second.get("challengeId")).isNotEqualTo(first.get("challengeId"));
        browser.verify("resend@example.com", first, firstCode, 400);
        browser.verify("resend@example.com", second, codes.get("resend@example.com"), 200);
        browser.verify("resend@example.com", second, codes.get("resend@example.com"), 400);
    }

    @Test void expiryIsCheckedByServerAndDeliveryFailureCannotAuthenticate() throws Exception {
        var browser = new Browser(); browser.session();
        var challenge = browser.requestCode("expired@example.com");
        now.addAndGet(300_000);
        browser.verify("expired@example.com", challenge, codes.get("expired@example.com"), 410);
        doThrow(new MailSendException("Delivery unavailable")).when(mail).send(eq("failed@example.com"), anyString(), anyLong());
        browser.post("/api/auth/code", Map.of("email", "failed@example.com", "intent", "login"), 503);
        assertThat(jdbc.queryForObject("SELECT used FROM email_challenges WHERE email='failed@example.com'", Boolean.class)).isTrue();
        assertThat(jdbc.queryForObject("SELECT code_hash FROM email_challenges WHERE email='failed@example.com'", String.class)).isNull();
    }

    @Test void requestAndVerificationLimitsCannotBeBypassedByNewSessions() throws Exception {
        for (int attempt = 0; attempt < 5; attempt++) {
            var browser = new Browser(); browser.session(); browser.requestCode("limits@example.com"); now.addAndGet(30_000);
        }
        var browser = new Browser(); browser.session();
        browser.post("/api/auth/code", Map.of("email", "limits@example.com", "intent", "login"), 429);
        // IP quota also bounds requests across different recipient addresses.
        for (int i = 0; i < 14; i++) browser.requestCode("other" + i + "@example.com");
        browser.post("/api/auth/code", Map.of("email", "last@example.com", "intent", "login"), 429);
    }

    @Test void existingAccountIsReusedAndConcurrentVerificationConsumesCodeOnce() throws Exception {
        var challenge = auth.requestCode("race@example.com", "signup", "Original name", "test-ip");
        String code = codes.get("race@example.com");
        var pool = Executors.newFixedThreadPool(2);
        var start = new CountDownLatch(1);
        try {
            Callable<Integer> verify = () -> {
                start.await();
                try { auth.verify("race@example.com", challenge.challengeId(), code, "test-ip"); return 200; }
                catch (ResponseStatusException error) { return error.getStatusCode().value(); }
            };
            var first = pool.submit(verify); var second = pool.submit(verify); start.countDown();
            assertThat(List.of(first.get(10, TimeUnit.SECONDS), second.get(10, TimeUnit.SECONDS))).containsExactlyInAnyOrder(200, 400);
        } finally { start.countDown(); pool.shutdownNow(); assertThat(pool.awaitTermination(10, TimeUnit.SECONDS)).isTrue(); }
        now.addAndGet(30_000);
        var second = auth.requestCode("race@example.com", "signup", "Do not overwrite", "test-ip");
        assertThat(auth.verify("race@example.com", second.challengeId(), codes.get("race@example.com"), "test-ip").name()).isEqualTo("Original name");
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM accounts", Integer.class)).isEqualTo(1);
    }
}
