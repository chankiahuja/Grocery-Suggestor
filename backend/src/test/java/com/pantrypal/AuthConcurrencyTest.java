package com.pantrypal;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.Cookie;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicLong;
import java.time.Clock;
import javax.sql.DataSource;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mail.MailSendException;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.web.server.ResponseStatusException;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;

@SpringBootTest(properties = {
    "spring.datasource.url=${AUTH_BURST_DB_URL:jdbc:h2:mem:auth_burst;MODE=PostgreSQL;DB_CLOSE_DELAY=-1;DATABASE_TO_LOWER=TRUE}",
    "spring.datasource.hikari.maximum-pool-size=2",
    "spring.datasource.hikari.minimum-idle=2",
    "spring.datasource.hikari.connection-timeout=30000"
})
@AutoConfigureMockMvc
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class AuthConcurrencyTest {
    @Autowired AuthService auth;
    @Autowired JdbcTemplate jdbc;
    @Autowired MockMvc mvc;
    @Autowired ObjectMapper json;
    @Autowired DataSource dataSource;
    @MockitoBean OtpMailSender mail;
    @MockitoBean Clock clock;
    final AtomicLong now = new AtomicLong();
    final Map<String, String> codes = new ConcurrentHashMap<>();

    @BeforeEach void setup() {
        jdbc.update("DELETE FROM spring_session");
        jdbc.update("DELETE FROM email_challenges");
        jdbc.update("DELETE FROM auth_rate_limits");
        jdbc.update("DELETE FROM inventory_items");
        jdbc.update("DELETE FROM accounts");
        codes.clear();
        now.set(1_800_000_000_000L);
        when(clock.millis()).thenAnswer(call -> now.get());
        captureMail(null);
    }

    private void captureMail(CountDownLatch deliveries) {
        doAnswer(call -> {
            assertThat(TransactionSynchronizationManager.isActualTransactionActive()).isFalse();
            codes.put(call.getArgument(0), call.getArgument(1));
            if (deliveries != null) {
                deliveries.countDown();
                assertThat(deliveries.await(60, TimeUnit.SECONDS)).isTrue();
            }
            return null;
        }).when(mail).send(anyString(), anyString(), anyLong());
    }

    @Test void authCompletesWithOnlyOneConnectionAvailable() throws Exception {
        // Occupy one of the two pool slots. A nested transaction would time out
        // even with a single request, independently of thread scheduling.
        try (var occupied = dataSource.getConnection()) {
            var challenge = auth.requestCode("single@example.com", "signup", "Single", "single-ip");
            assertThat(auth.verify("single@example.com", challenge.challengeId(), codes.get("single@example.com"), "single-ip").email())
                .isEqualTo("single@example.com");
            assertThatThrownBy(() -> auth.requestCode("single@example.com", "signup", "Single", "single-ip"))
                .isInstanceOf(ResponseStatusException.class).satisfies(error ->
                    assertThat(((ResponseStatusException) error).getStatusCode().value()).isEqualTo(429));
        }
    }

    @Test void hundredIndependentSignupAndLoginFlowsUseTwoConnections() throws Exception {
        var browsers = new ArrayList<Browser>();
        for (int i = 0; i < 100; i++) browsers.add(new Browser(i));
        for (String intent : List.of("signup", "login")) {
            captureMail(new CountDownLatch(100));
            burst(browsers, browser -> {
                browser.session();
                browser.challenge = browser.post("/api/auth/code", Map.of(
                    "email", browser.email, "intent", intent, "name", "Person " + browser.index), 200);
                return 200;
            });
            var results = burst(browsers, browser -> {
                var state = browser.post("/api/auth/verify", Map.of("email", browser.email,
                    "challengeId", browser.challenge.get("challengeId").asText(), "code", codes.get(browser.email)), 200);
                assertThat(state.get("account").get("email").asText()).isEqualTo(browser.email);
                return state.get("account").get("id").asInt();
            });
            assertThat(new HashSet<>(results)).hasSize(100);
            assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM accounts", Integer.class)).isEqualTo(100);
            assertThat(jdbc.queryForObject("SELECT COUNT(DISTINCT principal_name) FROM spring_session WHERE principal_name IS NOT NULL",
                Integer.class)).isEqualTo(100);
            assertThat(browsers.stream().map(browser -> browser.cookie.getValue()).distinct().count()).isEqualTo(100);
            now.addAndGet(30_000);
        }
        burst(browsers, browser -> {
            browser.post("/api/inventory", Map.of("name", browser.email, "category", "Other",
                "quantity", 1, "unit", "each", "minThreshold", 0), 201);
            var response = mvc.perform(get("/api/inventory").cookie(browser.cookie)).andReturn().getResponse();
            assertThat(response.getStatus()).isEqualTo(200);
            var inventory = json.readTree(response.getContentAsString());
            assertThat(inventory.size()).isEqualTo(1);
            assertThat(inventory.get(0).get("name").asText()).isEqualTo(browser.email);
            return 200;
        });
    }

    @Test void concurrentSameIpRequestsReceiveExactlyTwentySuccessesAndEighty429s() throws Exception {
        var browsers = new ArrayList<Browser>();
        for (int i = 0; i < 100; i++) browsers.add(new Browser(i));
        var statuses = burst(browsers, browser -> {
            browser.ip = "198.51.100.1";
            browser.session();
            return browser.postStatus("/api/auth/code", Map.of("email", browser.email, "intent", "signup", "name", "Person"));
        });
        assertThat(Collections.frequency(statuses, 200)).isEqualTo(20);
        assertThat(Collections.frequency(statuses, 429)).isEqualTo(80);
        assertThat(statuses).allMatch(status -> status == 200 || status == 429);
    }

    @Test void concurrentVerificationPreservesSixtyPerIpLimit() throws Exception {
        var browsers = new ArrayList<Browser>();
        for (int i = 0; i < 100; i++) {
            var browser = new Browser(i);
            browser.session();
            browser.challenge = browser.post("/api/auth/code", Map.of("email", browser.email, "intent", "signup", "name", "Person"), 200);
            browsers.add(browser);
        }
        var statuses = burst(browsers, browser -> {
            browser.ip = "198.51.100.1";
            return browser.postStatus("/api/auth/verify", Map.of("email", browser.email,
                "challengeId", browser.challenge.get("challengeId").asText(), "code", codes.get(browser.email)));
        });
        assertThat(Collections.frequency(statuses, 200)).isEqualTo(60);
        assertThat(Collections.frequency(statuses, 429)).isEqualTo(40);
        assertThat(statuses).allMatch(status -> status == 200 || status == 429);
    }

    @ParameterizedTest @CsvSource({"false,false", "false,true", "true,false", "true,true"})
    void delayedDeliveryCannotActivateOrInvalidateANewerChallenge(boolean fail, boolean consumeBeforeCompletion) throws Exception {
        var entered = new CountDownLatch(1);
        var release = new CountDownLatch(1);
        var executor = Executors.newSingleThreadExecutor();
        String email = "delayed@example.com";
        doAnswer(call -> {
            assertThat(TransactionSynchronizationManager.isActualTransactionActive()).isFalse();
            codes.put(email, call.getArgument(1));
            entered.countDown();
            assertThat(release.await(10, TimeUnit.SECONDS)).isTrue();
            if (fail) throw new MailSendException("Delayed failure");
            return null;
        }).when(mail).send(eq(email), anyString(), anyLong());
        try {
            var old = executor.submit(() -> auth.requestCode(email, "signup", "First", "first-ip"));
            assertThat(entered.await(10, TimeUnit.SECONDS)).isTrue();
            String oldId = jdbc.queryForObject("SELECT challenge_id FROM email_challenges WHERE email=?", String.class, email);
            assertThatThrownBy(() -> auth.verify(email, oldId, codes.get(email), "first-ip"))
                .isInstanceOf(ResponseStatusException.class).satisfies(error ->
                    assertThat(((ResponseStatusException) error).getStatusCode().value()).isEqualTo(400));
            now.addAndGet(30_000);
            captureMail(null);
            var newer = auth.requestCode(email, "signup", "Second", "second-ip");
            String newerCode = codes.get(email);
            // Exercise both a still-usable resend and a consumed one.
            if (consumeBeforeCompletion) {
                assertThat(auth.verify(email, newer.challengeId(), newerCode, "second-ip").name()).isEqualTo("Second");
            }
            release.countDown();
            if (fail) assertThatThrownBy(() -> old.get(10, TimeUnit.SECONDS))
                .hasCauseInstanceOf(ResponseStatusException.class);
            else old.get(10, TimeUnit.SECONDS);
            if (!consumeBeforeCompletion) {
                assertThat(auth.verify(email, newer.challengeId(), newerCode, "second-ip").name()).isEqualTo("Second");
            }
            assertThat(jdbc.queryForObject("SELECT used FROM email_challenges WHERE email=?", Boolean.class, email)).isTrue();
            assertThat(jdbc.queryForObject("SELECT code_hash FROM email_challenges WHERE email=?", String.class, email)).isNull();
            assertThatThrownBy(() -> auth.verify(email, newer.challengeId(), newerCode, "second-ip"))
                .isInstanceOf(ResponseStatusException.class);
        } finally {
            release.countDown();
            executor.shutdownNow();
            assertThat(executor.awaitTermination(10, TimeUnit.SECONDS)).isTrue();
        }
    }

    private <T> List<T> burst(List<Browser> browsers, BrowserCall<T> call) throws Exception {
        var executor = Executors.newFixedThreadPool(100);
        var start = new CountDownLatch(1);
        try {
            var futures = new ArrayList<Future<T>>();
            for (var browser : browsers) futures.add(executor.submit(() -> { start.await(); return call.run(browser); }));
            start.countDown();
            var results = new ArrayList<T>();
            for (var future : futures) results.add(future.get(75, TimeUnit.SECONDS));
            return results;
        } finally {
            start.countDown();
            executor.shutdownNow();
            assertThat(executor.awaitTermination(10, TimeUnit.SECONDS)).isTrue();
        }
    }
    private interface BrowserCall<T> { T run(Browser browser) throws Exception; }
    private class Browser {
        final int index;
        final String email;
        String ip;
        Cookie cookie;
        String csrf;
        JsonNode challenge;
        Browser(int index) { this.index = index; email = "burst" + index + "@example.com"; ip = "192.0.2." + (index + 1); }
        void session() throws Exception {
            var request = get("/api/auth/session");
            if (cookie != null) request.cookie(cookie);
            var response = mvc.perform(request).andReturn().getResponse();
            assertThat(response.getStatus()).isEqualTo(200);
            read(response);
        }
        JsonNode post(String path, Object body, int expected) throws Exception {
            var response = perform(path, body);
            assertThat(response.getStatus()).as(path + " " + email).isEqualTo(expected);
            return read(response);
        }
        int postStatus(String path, Object body) throws Exception { return perform(path, body).getStatus(); }
        private org.springframework.mock.web.MockHttpServletResponse perform(String path, Object body) throws Exception {
            return mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post(path).cookie(cookie).header("X-CSRF-TOKEN", csrf)
                .with(request -> { request.setRemoteAddr(ip); return request; })
                .contentType("application/json").content(json.writeValueAsString(body))).andReturn().getResponse();
        }
        private JsonNode read(org.springframework.mock.web.MockHttpServletResponse response) throws Exception {
            var next = response.getCookie("PANTRYPAL_SESSION");
            if (next != null) cookie = next;
            var body = json.readTree(response.getContentAsString());
            if (body.has("csrfToken")) csrf = body.get("csrfToken").asText();
            return body;
        }
    }
}
