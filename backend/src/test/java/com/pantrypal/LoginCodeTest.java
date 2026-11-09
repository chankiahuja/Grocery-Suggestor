package com.pantrypal;

import java.time.Clock;
import java.time.Duration;
import java.util.Map;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicLong;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mail.MailSendException;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.web.server.ResponseStatusException;
import static org.assertj.core.api.Assertions.*;
import static org.awaitility.Awaitility.await;
import static org.mockito.Mockito.*;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest(properties = "spring.datasource.url=${AUTH_LOGIN_DB_URL:jdbc:h2:mem:login_codes;MODE=PostgreSQL;DB_CLOSE_DELAY=-1;DATABASE_TO_LOWER=TRUE}")
@AutoConfigureMockMvc
class LoginCodeTest {
    @Autowired AuthService auth;
    @Autowired JdbcTemplate jdbc;
    @Autowired MockMvc mvc;
    @Autowired ObjectMapper json;
    @Autowired @Qualifier("loginMailExecutor") ThreadPoolTaskExecutor executor;
    @MockitoBean OtpMailSender mail;
    @MockitoBean Clock clock;
    final AtomicLong now = new AtomicLong();
    final Map<String, String> codes = new ConcurrentHashMap<>();

    void delivered() {
        await().atMost(Duration.ofSeconds(10)).until(() ->
            executor.getActiveCount() == 0 && executor.getThreadPoolExecutor().getQueue().isEmpty());
    }
    @BeforeEach void setup() {
        delivered();
        jdbc.update("DELETE FROM spring_session");
        jdbc.update("DELETE FROM email_challenges");
        jdbc.update("DELETE FROM auth_rate_limits");
        jdbc.update("DELETE FROM accounts");
        now.set(1_800_000_000_000L);
        when(clock.millis()).thenAnswer(call -> now.get());
        codes.clear();
        doAnswer(call -> { codes.put(call.getArgument(0), call.getArgument(1)); return null; })
            .when(mail).send(anyString(), anyString(), anyLong());
        jdbc.update("INSERT INTO accounts(email,display_name) VALUES (?,?)", "known@example.com", "Known");
    }
    @AfterEach void finish() { delivered(); }

    JsonNode request(String email, int expected) throws Exception {
        var response = mvc.perform(post("/api/auth/code").with(csrf().asHeader()).contentType("application/json")
            .content(json.writeValueAsString(Map.of("email", email, "intent", "login"))))
            .andExpect(status().is(expected)).andReturn().getResponse();
        return json.readTree(response.getContentAsString());
    }
    JsonNode responseFields(JsonNode challenge) {
        com.fasterxml.jackson.databind.node.ObjectNode copy = challenge.deepCopy();
        copy.remove("challengeId");
        return copy;
    }

    @Test void loginResponsesMatchButOnlyNormalizedExistingAccountReceivesMail() throws Exception {
        var known = request(" Known@Example.com ", 200);
        var absent = request("absent@example.com", 200);
        assertThat(known.properties()).hasSameSizeAs(absent.properties());
        assertThat(known.get("challengeId").asText()).matches("[0-9a-f-]{36}");
        assertThat(absent.get("challengeId").asText()).matches("[0-9a-f-]{36}");
        assertThat(responseFields(known)).isEqualTo(responseFields(absent));
        delivered();
        verify(mail).send(eq("known@example.com"), anyString(), eq(300L));
        verify(mail, never()).send(eq("absent@example.com"), anyString(), anyLong());
        assertThat(auth.verify("KNOWN@example.com", known.get("challengeId").asText(), codes.get("known@example.com"), "verify-ip").name()).isEqualTo("Known");
        assertThatThrownBy(() -> auth.verify("absent@example.com", absent.get("challengeId").asText(), "000000", "verify-ip"))
            .isInstanceOf(ResponseStatusException.class);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM accounts", Integer.class)).isEqualTo(1);
    }

    @Test void slowSmtpCannotDelayEitherLoginResponse() throws Exception {
        var entered = new CountDownLatch(1);
        var release = new CountDownLatch(1);
        doAnswer(call -> {
            entered.countDown();
            assertThat(release.await(10, TimeUnit.SECONDS)).isTrue();
            return null;
        }).when(mail).send(eq("known@example.com"), anyString(), anyLong());
        var requests = Executors.newSingleThreadExecutor();
        try {
            var known = requests.submit(() -> request("known@example.com", 200));
            assertThat(entered.await(5, TimeUnit.SECONDS)).isTrue();
            // Deterministic ordering check, not a brittle elapsed-time comparison:
            // HTTP completes while SMTP is still blocked.
            assertThat(known.get(2, TimeUnit.SECONDS).has("challengeId")).isTrue();
            assertThat(requests.submit(() -> request("absent@example.com", 200)).get(2, TimeUnit.SECONDS).has("challengeId")).isTrue();
        } finally {
            release.countDown();
            requests.shutdownNow();
            assertThat(requests.awaitTermination(5, TimeUnit.SECONDS)).isTrue();
        }
    }

    @Test void smtpFailureDoesNotChangeLoginResponseOrLeaveAUsableCode() throws Exception {
        doThrow(new MailSendException("synthetic SMTP failure"))
            .when(mail).send(eq("known@example.com"), anyString(), anyLong());
        var known = request("known@example.com", 200);
        var absent = request("absent@example.com", 200);
        delivered();
        for (String email : new String[] {"known@example.com", "absent@example.com"}) {
            assertThat(jdbc.queryForObject("SELECT code_hash FROM email_challenges WHERE email=?", String.class, email)).isNull();
            assertThat(jdbc.queryForObject("SELECT used FROM email_challenges WHERE email=?", Boolean.class, email)).isTrue();
        }
        assertThat(responseFields(known)).isEqualTo(responseFields(absent));
    }

    @Test void loginVerificationFailuresStayGenericEvenAfterExpiryOrAttemptCap() throws Exception {
        var known = request("known@example.com", 200);
        var absent = request("absent@example.com", 200);
        delivered();
        for (int attempt = 0; attempt < 7; attempt++) {
            assertSameFailure(known, absent);
        }
        now.addAndGet(300_000);
        assertSameFailure(known, absent);
    }
    void assertSameFailure(JsonNode known, JsonNode absent) {
        String[] emails = {"known@example.com", "absent@example.com"};
        JsonNode[] challenges = {known, absent};
        String message = null;
        for (int i = 0; i < emails.length; i++) {
            try {
                // The generator never emits the demo code.
                auth.verify(emails[i], challenges[i].get("challengeId").asText(), "123456", "verify-ip");
                fail("Verification must fail");
            } catch (ResponseStatusException failure) {
                assertThat(failure.getStatusCode().value()).isEqualTo(400);
                if (message == null) message = failure.getReason();
                else assertThat(failure.getReason()).isEqualTo(message);
            }
        }
    }

    @Test void requestLimitsApplyToUnknownAccountsAndMatchKnownAccountCooldown() throws Exception {
        request("known@example.com", 200);
        request("absent@example.com", 200);
        assertThat(request("known@example.com", 429)).isEqualTo(request("absent@example.com", 429));
        for (int attempt = 1; attempt < 5; attempt++) {
            now.addAndGet(30_000);
            auth.requestCode("absent@example.com", "login", null, "different-ip-" + attempt);
        }
        now.addAndGet(30_000);
        assertThatThrownBy(() -> auth.requestCode("ABSENT@example.com", "login", null, "fresh-ip"))
            .isInstanceOf(ResponseStatusException.class).satisfies(failure ->
                assertThat(((ResponseStatusException) failure).getStatusCode().value()).isEqualTo(429));
        for (int attempt = 0; attempt < 20; attempt++) {
            auth.requestCode("unknown" + attempt + "@example.com", "login", null, "shared-ip");
        }
        assertThatThrownBy(() -> auth.requestCode("another@example.com", "login", null, "shared-ip"))
            .isInstanceOf(ResponseStatusException.class).satisfies(failure ->
                assertThat(((ResponseStatusException) failure).getStatusCode().value()).isEqualTo(429));
        delivered();
        verify(mail, never()).send(eq("absent@example.com"), anyString(), anyLong());
    }

    @Test void fullQueueRejectsBothAccountsWithoutRunningSmtpOnRequestThread() throws Exception {
        var entered = new CountDownLatch(4);
        var release = new CountDownLatch(1);
        try {
            for (int i = 0; i < 4; i++) executor.execute(() -> {
                entered.countDown();
                // Allow slow runs to fill the queue and assert rejection before
                // workers can drain it. The finally block releases normal runs.
                try { release.await(60, TimeUnit.SECONDS); }
                catch (InterruptedException interrupted) { Thread.currentThread().interrupt(); }
            });
            assertThat(entered.await(5, TimeUnit.SECONDS)).isTrue();
            for (int i = 0; i < 128; i++) executor.execute(() -> {});
            assertThat(request("known@example.com", 503)).isEqualTo(request("absent@example.com", 503));
            verifyNoInteractions(mail);
            assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM email_challenges WHERE code_hash IS NOT NULL", Integer.class)).isZero();
        } finally { release.countDown(); }
    }
}
