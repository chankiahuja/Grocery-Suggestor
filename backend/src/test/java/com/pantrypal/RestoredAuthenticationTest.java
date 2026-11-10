package com.pantrypal;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.Cookie;
import java.time.Duration;
import java.time.Clock;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicLong;
import javax.sql.DataSource;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.core.io.ClassPathResource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.init.ScriptUtils;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.context.ContextConfiguration;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import static org.assertj.core.api.Assertions.assertThat;
import static org.awaitility.Awaitility.await;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest(properties = {
    "spring.datasource.url=${RESTORE_AUTH_DB_URL:jdbc:h2:mem:restore_auth;MODE=PostgreSQL;DB_CLOSE_DELAY=-1;DATABASE_TO_LOWER=TRUE}",
    "spring.datasource.username=${RESTORE_AUTH_DB_USER:sa}",
    "spring.datasource.password=${RESTORE_AUTH_DB_PASSWORD:}",
    "pantrypal.auth.otp-secret=disposable-restore-regression-secret-145",
    "pantrypal.auth.cookie-secure=false"
})
@AutoConfigureMockMvc
@ContextConfiguration(initializers = RestoreAuthDatabaseGuard.class)
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class RestoredAuthenticationTest {
    @Autowired MockMvc mvc;
    @Autowired ObjectMapper json;
    @Autowired JdbcTemplate jdbc;
    @Autowired DataSource dataSource;
    @Autowired PlatformTransactionManager transactions;
    @Autowired @Qualifier("loginMailExecutor") ThreadPoolTaskExecutor loginMailExecutor;
    @MockitoBean OtpMailSender mail;
    @MockitoBean Clock clock;
    final AtomicLong now = new AtomicLong(System.currentTimeMillis());
    final Map<String,String> codes = new ConcurrentHashMap<>();
    static final List<String> AUTH_TABLES = List.of("spring_session", "spring_session_attributes", "email_challenges");

    class Browser {
        Cookie cookie;
        String csrf;
        JsonNode read(MvcResult result) throws Exception {
            Cookie next = result.getResponse().getCookie("PANTRYPAL_SESSION");
            if (next != null) cookie = next;
            var body = json.readTree(result.getResponse().getContentAsString());
            if (body.has("csrfToken")) csrf = body.get("csrfToken").asText();
            return body;
        }
        JsonNode session() throws Exception {
            var request = get("/api/auth/session");
            if (cookie != null) request.cookie(cookie);
            return read(mvc.perform(request).andExpect(status().isOk()).andReturn());
        }
        JsonNode post(String path, Object body, int expected) throws Exception {
            var request = org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post(path)
                .contentType("application/json").header("X-CSRF-TOKEN", csrf).content(json.writeValueAsString(body));
            if (cookie != null) request.cookie(cookie);
            return read(mvc.perform(request).andExpect(status().is(expected)).andReturn());
        }
        JsonNode requestCode(String email) throws Exception {
            return post("/api/auth/code", Map.of("email", email, "intent", "signup", "name", "Restore Test"), 200);
        }
        JsonNode verify(String email, JsonNode challenge, String code, int expected) throws Exception {
            return post("/api/auth/verify", Map.of("email", email, "challengeId", challenge.get("challengeId").asText(), "code", code), expected);
        }
    }

    private Map<String,List<Map<String,Object>>> snapshot() {
        var snapshot = new LinkedHashMap<String,List<Map<String,Object>>>();
        AUTH_TABLES.forEach(table -> snapshot.put(table, jdbc.queryForList("SELECT * FROM " + table)));
        return snapshot;
    }
    private void restore(Map<String,List<Map<String,Object>>> snapshot) {
        // Test-only restore of authentication tables; account/pantry rows remain unchanged.
        new TransactionTemplate(transactions).executeWithoutResult(status -> {
            jdbc.update("DELETE FROM spring_session");
            jdbc.update("DELETE FROM email_challenges");
            for (String table : AUTH_TABLES) for (var row : snapshot.get(table)) {
                jdbc.update("INSERT INTO " + table + " (" + String.join(",", row.keySet()) + ") VALUES ("
                    + String.join(",", Collections.nCopies(row.size(), "?")) + ")", row.values().toArray());
            }
        });
    }
    private void invalidateRestoredAuthentication() throws Exception {
        try (var connection = dataSource.getConnection()) {
            ScriptUtils.executeSqlScript(connection, new ClassPathResource("db/operations/invalidate_restored_auth.sql"));
        }
    }

    @Test void restoreCleanupRejectsRevokedCookiesAndConsumedCodesAndAllowsFreshSignIn() throws Exception {
        when(clock.millis()).thenAnswer(call -> now.get());
        doAnswer(call -> { codes.put(call.getArgument(0), call.getArgument(1)); return null; })
            .when(mail).send(anyString(), anyString(), anyLong());

        // Account A has a session that will be logged out after the snapshot.
        var owner = new Browser(); owner.session();
        var ownerChallenge = owner.requestCode("restore-session@example.test");
        long ownerId = owner.verify("restore-session@example.test", ownerChallenge, codes.get("restore-session@example.test"), 200)
            .get("account").get("id").asLong();
        Cookie revokedCookie = owner.cookie;
        // Account B's pending signup code will be consumed after the snapshot.
        var pending = new Browser(); pending.session();
        var pendingChallenge = pending.requestCode("restore-code@example.test");
        String consumedCode = codes.get("restore-code@example.test");
        var snapshot = snapshot();
        assertThat(snapshot.get("spring_session_attributes")).isNotEmpty();
        assertThat(snapshot.get("email_challenges")).anyMatch(row -> Boolean.FALSE.equals(row.get("used")));

        owner.post("/api/auth/logout", Map.of(), 200);
        pending.verify("restore-code@example.test", pendingChallenge, consumedCode, 200);
        mvc.perform(get("/api/inventory").cookie(revokedCookie)).andExpect(status().isUnauthorized());
        var probe = new Browser(); probe.session();
        probe.verify("restore-code@example.test", pendingChallenge, consumedCode, 400);

        // Control: the snapshot really resurrects both credentials while unexpired.
        restore(snapshot);
        mvc.perform(get("/api/inventory").cookie(revokedCookie)).andExpect(status().isOk());
        probe = new Browser(); probe.session();
        probe.verify("restore-code@example.test", pendingChallenge, consumedCode, 200);

        // Reapply the same snapshot, then execute the exact operator cleanup script.
        restore(snapshot);
        invalidateRestoredAuthentication();
        invalidateRestoredAuthentication(); // Safe to repeat while the target stays offline.
        for (String table : AUTH_TABLES)
            assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM " + table, Integer.class)).isZero();
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM accounts WHERE id=?", Integer.class, ownerId)).isEqualTo(1);
        mvc.perform(get("/api/inventory").cookie(revokedCookie)).andExpect(status().isUnauthorized());
        probe = new Browser(); probe.session();
        probe.verify("restore-code@example.test", pendingChallenge, consumedCode, 400);

        // Cleanup leaves accounts intact and a newly issued login code usable.
        now.addAndGet(31_000);
        var fresh = new Browser(); fresh.session();
        var freshChallenge = fresh.post("/api/auth/code", Map.of("email", "restore-code@example.test", "intent", "login"), 200);
        await().atMost(Duration.ofSeconds(5)).until(() -> loginMailExecutor.getActiveCount() == 0
            && loginMailExecutor.getThreadPoolExecutor().getQueue().isEmpty());
        assertThat(fresh.verify("restore-code@example.test", freshChallenge, codes.get("restore-code@example.test"), 200)
            .get("authenticated").asBoolean()).isTrue();
        mvc.perform(get("/api/inventory").cookie(fresh.cookie)).andExpect(status().isOk());
    }
}
