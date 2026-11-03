package com.pantrypal;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.authentication.AnonymousAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.authority.AuthorityUtils;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.web.authentication.logout.SecurityContextLogoutHandler;
import org.springframework.security.web.context.HttpSessionSecurityContextRepository;
import org.springframework.security.web.csrf.CsrfToken;
import org.springframework.security.web.csrf.HttpSessionCsrfTokenRepository;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/auth")
public class AuthController {
    public record CodeRequest(String email, String intent, String name) {}
    public record Verification(String email, String challengeId, String code) {}
    public record SessionState(boolean authenticated, AuthService.Account account, String csrfToken) {}
    private final AuthService auth;
    private final HttpSessionSecurityContextRepository contexts;
    private final HttpSessionCsrfTokenRepository csrf;
    public AuthController(AuthService auth, HttpSessionSecurityContextRepository contexts, HttpSessionCsrfTokenRepository csrf) {
        this.auth = auth; this.contexts = contexts; this.csrf = csrf;
    }
    @GetMapping("/session")
    public SessionState session(HttpServletRequest request, Authentication authentication) {
        CsrfToken token = (CsrfToken) request.getAttribute(CsrfToken.class.getName());
        AuthService.Account account = authentication == null || authentication instanceof AnonymousAuthenticationToken
            ? null : auth.account(Long.parseLong(authentication.getName()));
        return new SessionState(account != null, account, token.getToken());
    }
    @PostMapping("/code")
    public AuthService.Challenge requestCode(@RequestBody CodeRequest body, HttpServletRequest request) {
        if (body == null) throw new org.springframework.web.server.ResponseStatusException(org.springframework.http.HttpStatus.BAD_REQUEST, "Enter an email address");
        // Do not trust unconfigured forwarded headers as rate-limit identities.
        return auth.requestCode(body.email(), body.intent(), body.name(), request.getRemoteAddr());
    }
    @PostMapping("/verify")
    public SessionState verify(@RequestBody Verification body, HttpServletRequest request, HttpServletResponse response) {
        if (body == null) throw new org.springframework.web.server.ResponseStatusException(org.springframework.http.HttpStatus.BAD_REQUEST, "Enter a verification code");
        var account = auth.verify(body.email(), body.challengeId(), body.code(), request.getRemoteAddr());
        if (request.getSession(false) != null) request.changeSessionId();
        var authentication = UsernamePasswordAuthenticationToken.authenticated(Long.toString(account.id()), null,
            AuthorityUtils.createAuthorityList("ROLE_USER"));
        var context = SecurityContextHolder.createEmptyContext();
        context.setAuthentication(authentication);
        SecurityContextHolder.setContext(context);
        contexts.saveContext(context, request, response);
        var token = csrf.generateToken(request);
        csrf.saveToken(token, request, response);
        return new SessionState(true, account, token.getToken());
    }
    @PostMapping("/logout")
    public SessionState logout(HttpServletRequest request, HttpServletResponse response, Authentication authentication) {
        new SecurityContextLogoutHandler().logout(request, response, authentication);
        var token = csrf.generateToken(request);
        csrf.saveToken(token, request, response);
        return new SessionState(false, null, token.getToken());
    }
}
