package com.pantrypal;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.Instant;
import java.util.*;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mail.MailException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

@Service
public class AuthService {
    public record Account(long id, String email, String name) {}
    public record Challenge(String challengeId, String expiresAt, String resendAt) {}
    private final JdbcTemplate jdbc;
    private final AuthRateLimiter limits;
    private final OtpMailSender mail;
    private final Clock clock;
    private final SecureRandom random = new SecureRandom();
    private final byte[] secret;
    private final long lifetimeSeconds, cooldownSeconds;
    private final int maxAttempts;
    public AuthService(JdbcTemplate jdbc, AuthRateLimiter limits, OtpMailSender mail, Clock clock,
        @Value("${pantrypal.auth.otp-secret:}") String secret,
        @Value("${pantrypal.auth.otp-lifetime-seconds:300}") long lifetimeSeconds,
        @Value("${pantrypal.auth.resend-cooldown-seconds:30}") long cooldownSeconds,
        @Value("${pantrypal.auth.max-attempts:5}") int maxAttempts) {
        this.jdbc = jdbc; this.limits = limits; this.mail = mail; this.clock = clock;
        this.secret = secret.isBlank() ? random.generateSeed(32) : secret.getBytes(StandardCharsets.UTF_8);
        if (this.secret.length < 32 || lifetimeSeconds <= 0 || cooldownSeconds <= 0 || maxAttempts <= 0) {
            throw new IllegalArgumentException("Auth secret must have at least 32 bytes and limits must be positive");
        }
        this.lifetimeSeconds = lifetimeSeconds; this.cooldownSeconds = cooldownSeconds; this.maxAttempts = maxAttempts;
    }
    static String email(String raw) {
        if (raw == null || raw.length() > 254 || !raw.trim().matches("[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\\.[A-Za-z]{2,}")) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Enter a valid email address");
        }
        return raw.trim().toLowerCase(Locale.ROOT);
    }
    private String hash(String challenge, String code) {
        try {
            var mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(secret, "HmacSHA256"));
            return HexFormat.of().formatHex(mac.doFinal((challenge + ":" + code).getBytes(StandardCharsets.UTF_8)));
        } catch (Exception error) { throw new IllegalStateException(error); }
    }

    @Transactional(noRollbackFor=ResponseStatusException.class)
    public Challenge requestCode(String rawEmail, String intent, String name, String ip) {
        String email = email(rawEmail);
        if (!List.of("login", "signup").contains(intent == null ? "" : intent)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Choose login or signup");
        }
        String displayName = name == null ? null : name.trim();
        if ("signup".equals(intent) && (displayName == null || displayName.isEmpty() || displayName.length() > 100)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Enter a name of at most 100 characters");
        }
        limits.claim("request-ip", ip, 20, 0);
        limits.claim("request-email", email, 5, cooldownSeconds * 1000);
        limits.ensureChallenge(email);
        jdbc.queryForMap("SELECT email FROM email_challenges WHERE email=? FOR UPDATE", email);
        String id = UUID.randomUUID().toString(), code;
        do { code = String.format(Locale.ROOT, "%06d", random.nextInt(1_000_000)); } while (code.equals("123456"));
        long now = clock.millis(), expires = now + lifetimeSeconds * 1000;
        jdbc.update("UPDATE email_challenges SET challenge_id=?,code_hash=?,intent=?,display_name=?,expires_at=?,attempts=0,used=FALSE WHERE email=?",
            id, hash(id, code), intent, "signup".equals(intent) ? displayName : null, expires, email);
        try { mail.send(email, code, lifetimeSeconds); }
        catch (MailException error) {
            jdbc.update("UPDATE email_challenges SET code_hash=NULL,used=TRUE WHERE email=?", email);
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "Email could not be sent. Please try again shortly.");
        }
        return new Challenge(id, Instant.ofEpochMilli(expires).toString(), Instant.ofEpochMilli(now + cooldownSeconds * 1000).toString());
    }

    @Transactional(noRollbackFor=ResponseStatusException.class)
    public Account verify(String rawEmail, String challengeId, String code, String ip) {
        String email = email(rawEmail);
        limits.claim("verify-ip", ip, 60, 0);
        limits.claim("verify-email", email, 20, 0);
        if (challengeId == null || challengeId.length() != 36 || code == null || !code.matches("[0-9]{6}")) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Enter a valid six-digit verification code");
        }
        var rows = jdbc.queryForList("SELECT * FROM email_challenges WHERE email=? FOR UPDATE", email);
        if (rows.isEmpty()) throw invalid();
        var row = rows.get(0);
        if (!challengeId.equals(row.get("challenge_id")) || Boolean.TRUE.equals(row.get("used")) || row.get("code_hash") == null) throw invalid();
        if (clock.millis() >= ((Number) row.get("expires_at")).longValue()) {
            throw new ResponseStatusException(HttpStatus.GONE, "This code has expired. Request another code.");
        }
        int attempts = ((Number) row.get("attempts")).intValue();
        if (attempts >= maxAttempts) throw new ResponseStatusException(HttpStatus.TOO_MANY_REQUESTS, "Too many attempts. Request another code.");
        jdbc.update("UPDATE email_challenges SET attempts=attempts+1 WHERE email=?", email);
        if (!MessageDigest.isEqual(hash(challengeId, code).getBytes(StandardCharsets.US_ASCII), row.get("code_hash").toString().getBytes(StandardCharsets.US_ASCII))) throw invalid();
        var accounts = jdbc.queryForList("SELECT id FROM accounts WHERE email=?", email);
        jdbc.update("UPDATE email_challenges SET used=TRUE,code_hash=NULL WHERE email=?", email);
        if (accounts.isEmpty()) {
            if (!"signup".equals(row.get("intent"))) throw invalid();
            jdbc.update("INSERT INTO accounts(email,display_name) VALUES (?,?)", email, row.get("display_name"));
        }
        return accountByEmail(email);
    }
    private ResponseStatusException invalid() { return new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid or already-used code. Request a new code if needed."); }
    public Account account(long id) {
        var row = jdbc.queryForMap("SELECT * FROM accounts WHERE id=?", id);
        return new Account(id, row.get("email").toString(), (String) row.get("display_name"));
    }
    private Account accountByEmail(String email) {
        return account(jdbc.queryForObject("SELECT id FROM accounts WHERE email=?", Long.class, email));
    }
}
