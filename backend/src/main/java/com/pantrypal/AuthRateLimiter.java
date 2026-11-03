package com.pantrypal;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Clock;
import java.util.HexFormat;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.http.HttpStatus;

/** Separate committed transactions keep limits effective even on rejected requests. */
@Service
public class AuthRateLimiter {
    private final JdbcTemplate jdbc;
    private final Clock clock;
    private final TransactionTemplate tx;
    public AuthRateLimiter(JdbcTemplate jdbc, Clock clock, PlatformTransactionManager manager) {
        this.jdbc = jdbc;
        this.clock = clock;
        tx = new TransactionTemplate(manager);
        tx.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
    }
    static String digest(String value) {
        try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8))); }
        catch (Exception error) { throw new IllegalStateException(error); }
    }
    public void claim(String scope, String identity, int maximum, long cooldownMillis) {
        String key = scope + ":" + digest(identity);
        try { tx.executeWithoutResult(status -> jdbc.update("INSERT INTO auth_rate_limits(bucket_key) VALUES (?)", key)); }
        catch (DuplicateKeyException existing) { /* Another request already created the bucket. */ }
        tx.executeWithoutResult(status -> {
            var row = jdbc.queryForMap("SELECT * FROM auth_rate_limits WHERE bucket_key=? FOR UPDATE", key);
            long now = clock.millis(), start = ((Number) row.get("window_start")).longValue();
            int count = now - start >= 3_600_000 ? 0 : ((Number) row.get("event_count")).intValue();
            long last = ((Number) row.get("last_event")).longValue();
            if (count >= maximum || now - last < cooldownMillis) {
                throw new ResponseStatusException(HttpStatus.TOO_MANY_REQUESTS, "Too many requests. Please wait before trying again.");
            }
            jdbc.update("UPDATE auth_rate_limits SET window_start=?,event_count=?,last_event=? WHERE bucket_key=?",
                count == 0 ? now : start, count + 1, now, key);
        });
    }
    public void ensureChallenge(String email) {
        try { tx.executeWithoutResult(status -> jdbc.update("INSERT INTO email_challenges(email) VALUES (?)", email)); }
        catch (DuplicateKeyException existing) { /* The email already has a challenge slot. */ }
    }
}
