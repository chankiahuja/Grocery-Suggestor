package com.pantrypal;

import org.springframework.context.ApplicationEventPublisher;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

/** Active-store erasure. No email, pantry snapshot or analytics tombstone is retained. */
@Service
public class AccountDeletionService {
    public record AccountDeleted(long accountId) {}
    private final JdbcTemplate jdbc;
    private final ApplicationEventPublisher events;
    public AccountDeletionService(JdbcTemplate jdbc, ApplicationEventPublisher events) {
        this.jdbc = jdbc; this.events = events;
    }

    @Transactional
    public void delete(long accountId) {
        var accounts = jdbc.queryForList("SELECT email FROM accounts WHERE id=?", accountId);
        if (accounts.isEmpty()) throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Sign in to continue");
        String email = accounts.get(0).get("email").toString();
        // Match verification's lock order: challenge first, account second.
        jdbc.queryForList("SELECT email FROM email_challenges WHERE email=? FOR UPDATE", email);
        if (jdbc.queryForList("SELECT id FROM accounts WHERE id=? FOR UPDATE", accountId).isEmpty()) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Sign in to continue");
        }
        jdbc.update("DELETE FROM shopping_list_items WHERE account_id=?", accountId);
        jdbc.update("DELETE FROM shopping_lists WHERE account_id=?", accountId);
        // Adjustment/Undo history cascades from inventory_items.
        jdbc.update("DELETE FROM inventory_items WHERE account_id=?", accountId);
        jdbc.update("DELETE FROM spring_session WHERE principal_name=?", Long.toString(accountId));
        jdbc.update("DELETE FROM email_challenges WHERE email=?", email);
        jdbc.update("DELETE FROM auth_rate_limits WHERE bucket_key IN (?,?)",
            "request-email:" + AuthRateLimiter.digest(email), "verify-email:" + AuthRateLimiter.digest(email));
        jdbc.update("DELETE FROM accounts WHERE id=?", accountId);
        events.publishEvent(new AccountDeleted(accountId));
    }
}
