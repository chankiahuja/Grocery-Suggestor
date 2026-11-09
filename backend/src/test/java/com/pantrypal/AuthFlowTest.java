package com.pantrypal;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.Cookie;
import java.io.IOException;
import java.net.SocketTimeoutException;
import java.time.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicLong;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.security.core.Authentication;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mail.MailSendException;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;
import org.springframework.web.server.ResponseStatusException;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.awaitility.Awaitility.await;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest
@AutoConfigureMockMvc
class AuthFlowTest {
    @Autowired MockMvc mvc;
    @Autowired ObjectMapper json;
    @Autowired JdbcTemplate jdbc;
    @Autowired AuthService auth;
    @Autowired @Qualifier("loginMailExecutor") ThreadPoolTaskExecutor loginMailExecutor;
    @MockitoBean OtpMailSender mail;
    @MockitoBean Clock clock;
    @MockitoSpyBean NotificationEvents notifications;
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
            var response = read(mvc.perform(request).andExpect(status().is(expected)).andReturn());
            if (path.equals("/api/auth/code") && expected == 200) {
                await().atMost(Duration.ofSeconds(5)).until(() ->
                    loginMailExecutor.getActiveCount() == 0 && loginMailExecutor.getThreadPoolExecutor().getQueue().isEmpty());
            }
            return response;
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

    @Test void logoutStopsAnAlreadyOpenNotificationStream() throws Exception {
        var browser = new Browser();
        browser.session();
        var challenge = browser.requestCode("stream-logout@example.com");
        long accountId = browser.verify("stream-logout@example.com", challenge, codes.get("stream-logout@example.com"), 200)
            .get("account").get("id").asLong();
        String sessionId = jdbc.queryForObject("SELECT session_id FROM spring_session WHERE principal_name=?",
            String.class, Long.toString(accountId));
        Authentication authentication = mock(Authentication.class);
        when(authentication.getName()).thenReturn(Long.toString(accountId));
        var emitter = new RecordingEmitter();
        notifications.subscribe(authentication, sessionId, emitter);

        try {
            browser.post("/api/auth/logout", Map.of(), 200);
            notifications.changed(new PantryService.PantryChanged("inventory_changed", 41L, accountId));

            assertThat(emitter.payloads).contains(Map.of("status", "connected"));
            assertThat(emitter.payloads).doesNotContain(Map.of("type", "inventory_changed"));
        } finally {
            emitter.complete();
        }
    }

    @Test void expiredSessionStopsReceivingEventsWhileAnotherSessionStaysConnected() throws Exception {
        var browser = new Browser();
        browser.session();
        String email = "stream-expiry@example.com";
        var challenge = browser.requestCode(email);
        long accountId = browser.verify(email, challenge, codes.get(email), 200)
            .get("account").get("id").asLong();
        String expiredSessionId = jdbc.queryForObject("SELECT session_id FROM spring_session WHERE principal_name=?",
            String.class, Long.toString(accountId));
        var otherBrowser = new Browser();
        otherBrowser.session();
        now.addAndGet(31_000);
        var otherChallenge = otherBrowser.requestCode(email);
        otherBrowser.verify(email, otherChallenge, codes.get(email), 200);
        String activeSessionId = jdbc.queryForObject(
            "SELECT session_id FROM spring_session WHERE principal_name=? AND session_id<>?",
            String.class, Long.toString(accountId), expiredSessionId);
        Authentication authentication = mock(Authentication.class);
        when(authentication.getName()).thenReturn(Long.toString(accountId));
        var expired = new RecordingEmitter();
        var active = new RecordingEmitter();
        notifications.subscribe(authentication, expiredSessionId, expired);
        notifications.subscribe(authentication, activeSessionId, active);

        try {
            jdbc.update("UPDATE spring_session SET last_access_time=0, expiry_time=0 WHERE session_id=?", expiredSessionId);
            mvc.perform(get("/api/inventory").cookie(browser.cookie)).andExpect(status().isUnauthorized());
            notifications.changed(new PantryService.PantryChanged("inventory_changed", 41L, accountId));
            notifications.changed(new PantryService.PantryChanged("purchase_completed", null, accountId));

            assertThat(expired.payloads).contains(Map.of("status", "connected"));
            assertThat(expired.payloads).doesNotContain(
                Map.of("type", "inventory_changed"), Map.of("type", "purchase_completed"));
            await().atMost(Duration.ofSeconds(5)).untilAsserted(() -> {
                assertThat(expired.completed).isTrue();
                assertThat(active.payloads).contains(
                    Map.of("type", "inventory_changed"), Map.of("type", "purchase_completed"));
            });
            assertThat(active.completed).isFalse();
            mvc.perform(get("/api/inventory").cookie(otherBrowser.cookie)).andExpect(status().isOk());
        } finally {
            notifications.disconnectSession(expiredSessionId);
            notifications.disconnectSession(activeSessionId);
        }
    }

    @Test void switchingAccountsClosesThePreviousAccountsNotificationStream() throws Exception {
        var browser = new Browser();
        browser.session();
        var aliceChallenge = browser.requestCode("stream-switch-alice@example.com");
        long aliceId = browser.verify("stream-switch-alice@example.com", aliceChallenge,
            codes.get("stream-switch-alice@example.com"), 200).get("account").get("id").asLong();
        String oldSessionId = jdbc.queryForObject("SELECT session_id FROM spring_session WHERE principal_name=?",
            String.class, Long.toString(aliceId));
        jdbc.update("INSERT INTO accounts(email, display_name) VALUES (?,?)",
            "stream-switch-bob@example.com", "Bob");

        Authentication aliceAuthentication = mock(Authentication.class);
        when(aliceAuthentication.getName()).thenReturn(Long.toString(aliceId));
        var emitter = new RecordingEmitter();
        notifications.subscribe(aliceAuthentication, oldSessionId, emitter);

        try {
            var bobChallenge = browser.post("/api/auth/code",
                Map.of("email", "stream-switch-bob@example.com", "intent", "login"), 200);
            long bobId = browser.verify("stream-switch-bob@example.com", bobChallenge,
                codes.get("stream-switch-bob@example.com"), 200).get("account").get("id").asLong();
            assertThat(bobId).isNotEqualTo(aliceId);

            notifications.changed(new PantryService.PantryChanged("inventory_changed", 41L, aliceId));

            assertThat(emitter.payloads).doesNotContain(Map.of("type", "inventory_changed"));
        } finally {
            emitter.complete();
        }
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

    private static class RecordingEmitter extends SseEmitter {
        private final List<Object> payloads = new CopyOnWriteArrayList<>();
        private volatile boolean completed;

        @Override
        public void complete() {
            completed = true;
            super.complete();
        }

        @Override
        public void send(SseEventBuilder builder) throws IOException {
            for (DataWithMediaType part : builder.build()) payloads.add(part.getData());
        }
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
        verify(mail, never()).send(eq("new@example.com"), anyString(), anyLong());
        browser.verify("new@example.com", login, "000000", 400);
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

    @Test void signupDoesNotClaimUnownedLegacyPantryData() throws Exception {
        var browser = new Browser();
        browser.session();
        String suffix = UUID.randomUUID().toString();
        String itemName = "Unclaimed legacy rice " + suffix;
        String listName = "Unclaimed legacy list " + suffix;
        jdbc.update("""
            INSERT INTO inventory_items (name, category, quantity, unit, min_threshold)
            VALUES (?, 'Grains', 2, 'kg', 1)
            """, itemName);
        Long itemId = jdbc.queryForObject(
            "SELECT id FROM inventory_items WHERE name=?", Long.class, itemName);
        jdbc.update("INSERT INTO shopping_lists (name) VALUES (?)", listName);
        Long listId = jdbc.queryForObject(
            "SELECT id FROM shopping_lists WHERE name=?", Long.class, listName);
        jdbc.update("""
            INSERT INTO shopping_list_items
                (shopping_list_id, inventory_item_id, name, category, quantity, unit)
            VALUES (?, ?, ?, 'Grains', 1, 'kg')
            """, listId, itemId, itemName);

        try {
            var challenge = browser.requestCode("claim-test@example.com");
            browser.verify("claim-test@example.com", challenge, codes.get("claim-test@example.com"), 200);

            assertThat(jdbc.queryForObject(
                "SELECT account_id FROM inventory_items WHERE id=?", Long.class, itemId)).isNull();
            assertThat(jdbc.queryForObject(
                "SELECT account_id FROM shopping_lists WHERE id=?", Long.class, listId)).isNull();
            assertThat(jdbc.queryForObject(
                "SELECT account_id FROM shopping_list_items WHERE shopping_list_id=?", Long.class, listId)).isNull();
            assertThat(mvc.perform(get("/api/inventory").cookie(browser.cookie))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString()).isEqualTo("[]");
            assertThat(mvc.perform(get("/api/shopping-lists").cookie(browser.cookie))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString()).isEqualTo("[]");
        } finally {
            jdbc.update("DELETE FROM shopping_list_items WHERE shopping_list_id=?", listId);
            jdbc.update("DELETE FROM shopping_lists WHERE id=?", listId);
            jdbc.update("DELETE FROM inventory_items WHERE id=?", itemId);
        }
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
        browser.post("/api/auth/code", Map.of("email", "failed@example.com", "intent", "signup", "name", "Test"), 503);
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

    @Test
    @ExtendWith(OutputCaptureExtension.class)
    void deliveryTimeoutIsSanitizedAndCanRecoverAfterCooldown(CapturedOutput output) throws Exception {
        var browser = new Browser(); browser.session();
        String email = "timeout@example.com";
        String diagnostic = "synthetic-smtp-secret-do-not-expose";
        doAnswer(call -> {
            codes.put(email, call.getArgument(1));
            throw new MailSendException(diagnostic, new SocketTimeoutException("Read timed out"));
        }).when(mail).send(eq(email), anyString(), anyLong());

        var failure = browser.post("/api/auth/code",
            Map.of("email", email, "intent", "signup", "name", "Timeout test"), 503);
        assertThat(failure.get("error").asText()).isEqualTo("Email could not be sent. Please try again shortly.");
        String failedId = jdbc.queryForObject("SELECT challenge_id FROM email_challenges WHERE email=?", String.class, email);
        String failedCode = codes.get(email);
        assertThat(failure.toString()).doesNotContain(diagnostic, failedCode, failedId);
        assertThat(jdbc.queryForObject("SELECT code_hash FROM email_challenges WHERE email=?", String.class, email)).isNull();
        assertThat(jdbc.queryForObject("SELECT used FROM email_challenges WHERE email=?", Boolean.class, email)).isTrue();
        browser.verify(email, json.createObjectNode().put("challengeId", failedId), failedCode, 400);
        assertThat(browser.session().get("authenticated").asBoolean()).isFalse();
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM accounts", Integer.class)).isZero();
        browser.post("/api/auth/code", Map.of("email", email, "intent", "signup", "name", "Timeout test"), 429);

        doAnswer(call -> { codes.put(email, call.getArgument(1)); return null; })
            .when(mail).send(eq(email), anyString(), anyLong());
        now.addAndGet(30_000);
        var recovered = browser.requestCode(email);
        browser.verify(email, json.createObjectNode().put("challengeId", failedId), failedCode, 400);
        assertThat(browser.verify(email, recovered, codes.get(email), 200).get("authenticated").asBoolean()).isTrue();
        assertThat(output.getAll()).doesNotContain(diagnostic, failedCode);
    }

    @Test void verificationEmailQuotaAppliesAcrossDifferentIps() {
        String challengeId = UUID.randomUUID().toString();
        for (int attempt = 0; attempt < 20; attempt++) {
            final String ip = "email-quota-ip-" + attempt;
            assertThatThrownBy(() -> auth.verify("quota@example.com", challengeId, "000000", ip))
                .isInstanceOf(ResponseStatusException.class).satisfies(error ->
                    assertThat(((ResponseStatusException) error).getStatusCode().value()).isEqualTo(400));
        }
        assertThatThrownBy(() -> auth.verify("QUOTA@example.com", challengeId, "000000", "fresh-ip"))
            .isInstanceOf(ResponseStatusException.class).satisfies(error ->
                assertThat(((ResponseStatusException) error).getStatusCode().value()).isEqualTo(429));
    }

    @Test void verificationIpQuotaAppliesAcrossDifferentEmails() {
        String challengeId = UUID.randomUUID().toString();
        for (int attempt = 0; attempt < 60; attempt++) {
            final String email = "quota" + attempt + "@example.com";
            assertThatThrownBy(() -> auth.verify(email, challengeId, "000000", "shared-ip"))
                .isInstanceOf(ResponseStatusException.class).satisfies(error ->
                    assertThat(((ResponseStatusException) error).getStatusCode().value()).isEqualTo(400));
        }
        assertThatThrownBy(() -> auth.verify("another@example.com", challengeId, "000000", "shared-ip"))
            .isInstanceOf(ResponseStatusException.class).satisfies(error ->
                assertThat(((ResponseStatusException) error).getStatusCode().value()).isEqualTo(429));
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
