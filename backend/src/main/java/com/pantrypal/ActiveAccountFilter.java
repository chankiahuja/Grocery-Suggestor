package com.pantrypal;

import java.io.IOException;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.authentication.AnonymousAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.filter.OncePerRequestFilter;

/** Reject stale session saves from requests that were in flight during deletion. */
final class ActiveAccountFilter extends OncePerRequestFilter {
    private final JdbcTemplate jdbc;
    ActiveAccountFilter(JdbcTemplate jdbc) { this.jdbc = jdbc; }
    @Override protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
        throws ServletException, IOException {
        var authentication = SecurityContextHolder.getContext().getAuthentication();
        if (request.getRequestURI().startsWith("/api/") && authentication != null
            && !(authentication instanceof AnonymousAuthenticationToken)
            && jdbc.queryForObject("SELECT COUNT(*) FROM accounts WHERE id=?", Integer.class, Long.parseLong(authentication.getName())) == 0) {
            var session = request.getSession(false);
            if (session != null) session.invalidate();
            SecurityContextHolder.clearContext();
            response.setStatus(401); response.setContentType("application/json");
            response.getWriter().write("{\"error\":\"Sign in to continue\"}");
            return;
        }
        chain.doFilter(request, response);
    }
}
