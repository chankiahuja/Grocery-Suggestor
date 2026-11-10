package com.pantrypal;

import java.time.Clock;
import java.util.Map;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api/account")
public class AccountController {
    static final String VERIFIED_AT = "pantrypal.verifiedAt";
    static final long RECENT_AUTH_MS = 5 * 60_000;
    private final AccountDeletionService deletion;
    private final Clock clock;
    public AccountController(AccountDeletionService deletion, Clock clock) { this.deletion = deletion; this.clock = clock; }
    private boolean recent(HttpServletRequest request) {
        var session = request.getSession(false);
        Object timestamp = session == null ? null : session.getAttribute(VERIFIED_AT);
        return timestamp instanceof Long at && clock.millis() >= at && clock.millis() - at < RECENT_AUTH_MS;
    }
    @GetMapping("/deletion-status")
    public Map<String,Boolean> status(HttpServletRequest request) { return Map.of("recentAuthentication", recent(request)); }

    @DeleteMapping
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(HttpServletRequest request, Authentication authentication) {
        if (!recent(request)) throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Verify a fresh email code before deleting your account");
        deletion.delete(Long.parseLong(authentication.getName()));
        // Only reached after the service transaction commits. Never invalidate on rollback.
        var session = request.getSession(false);
        if (session != null) session.invalidate();
        SecurityContextHolder.clearContext();
    }
}
