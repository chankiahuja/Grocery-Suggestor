package com.pantrypal;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Base64;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.HttpHeaders;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * Temporary outer Basic-auth gate for production validation.
 *
 * The gate is intentionally independent of PantryPal's session authentication: operator
 * credentials only unlock validation access, while normal account authentication and
 * authorization still apply to application flows behind the gate.
 */
final class PreLaunchAccessGateFilter extends OncePerRequestFilter {
    private static final String HEALTH_PATH = "/api/healthz";
    private static final String CHALLENGE = "Basic realm=\"PantryPal pre-launch validation\", charset=\"UTF-8\"";
    private final byte[] username;
    private final byte[] password;

    PreLaunchAccessGateFilter(String username, String password) {
        this.username = username.getBytes(StandardCharsets.UTF_8);
        this.password = password.getBytes(StandardCharsets.UTF_8);
    }

    /** Allows health probes, or forwards requests only after constant-time credential checks. */
    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        if (HEALTH_PATH.equals(requestPath(request)) || hasValidCredentials(request)) {
            chain.doFilter(request, response);
            return;
        }
        response.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
        response.setHeader(HttpHeaders.WWW_AUTHENTICATE, CHALLENGE);
        response.setHeader(HttpHeaders.CACHE_CONTROL, "no-store");
    }

    /** Resolves the path without a servlet context prefix for the health exception. */
    private static String requestPath(HttpServletRequest request) {
        String contextPath = request.getContextPath();
        String requestUri = request.getRequestURI();
        return requestUri.startsWith(contextPath) ? requestUri.substring(contextPath.length()) : requestUri;
    }

    /** Parses the Basic header without exposing credentials or accepting malformed values. */
    private boolean hasValidCredentials(HttpServletRequest request) {
        String header = request.getHeader(HttpHeaders.AUTHORIZATION);
        if (header == null || header.length() <= 6 || !header.regionMatches(true, 0, "Basic ", 0, 6)) {
            return false;
        }
        try {
            byte[] decoded = Base64.getDecoder().decode(header.substring(6));
            int separator = -1;
            for (int i = 0; i < decoded.length; i++) {
                if (decoded[i] == ':') {
                    separator = i;
                    break;
                }
            }
            if (separator < 1 || separator == decoded.length - 1) {
                return false;
            }
            byte[] suppliedUsername = java.util.Arrays.copyOfRange(decoded, 0, separator);
            byte[] suppliedPassword = java.util.Arrays.copyOfRange(decoded, separator + 1, decoded.length);
            return MessageDigest.isEqual(username, suppliedUsername)
                    && MessageDigest.isEqual(password, suppliedPassword);
        } catch (IllegalArgumentException invalidBase64) {
            return false;
        }
    }
}
