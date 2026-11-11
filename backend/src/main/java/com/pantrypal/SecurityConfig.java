package com.pantrypal;

import java.time.Clock;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.context.HttpSessionSecurityContextRepository;
import org.springframework.security.web.csrf.CsrfTokenRequestAttributeHandler;
import org.springframework.security.web.csrf.HttpSessionCsrfTokenRepository;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.core.userdetails.UsernameNotFoundException;
import org.springframework.session.web.http.DefaultCookieSerializer;

@Configuration
public class SecurityConfig {
    @Bean Clock authClock() { return Clock.systemUTC(); }
    @Bean UserDetailsService noPasswordLogin() {
        return username -> { throw new UsernameNotFoundException("Password login is unavailable"); };
    }
    @Bean HttpSessionSecurityContextRepository securityContexts() { return new HttpSessionSecurityContextRepository(); }
    @Bean HttpSessionCsrfTokenRepository csrfTokens() { return new HttpSessionCsrfTokenRepository(); }
    @Bean DefaultCookieSerializer sessionCookies(@Value("${pantrypal.auth.cookie-secure:true}") boolean secure) {
        var cookies = new DefaultCookieSerializer();
        cookies.setCookieName("PANTRYPAL_SESSION");
        cookies.setCookiePath("/");
        cookies.setUseHttpOnlyCookie(true);
        cookies.setUseSecureCookie(secure);
        cookies.setSameSite("Lax");
        cookies.setCookieMaxAge(7 * 24 * 60 * 60);
        return cookies;
    }
    @Bean
    @ConditionalOnWebApplication(type = ConditionalOnWebApplication.Type.SERVLET)
    SecurityFilterChain security(HttpSecurity http, HttpSessionSecurityContextRepository contexts,
        HttpSessionCsrfTokenRepository csrf, org.springframework.jdbc.core.JdbcTemplate jdbc) throws Exception {
        http.addFilterBefore(new ActiveAccountFilter(jdbc), org.springframework.security.web.access.intercept.AuthorizationFilter.class);
        http.authorizeHttpRequests(auth -> auth
            .requestMatchers("/api/auth/**", "/api/feedback/**", "/api/healthz").permitAll()
            .requestMatchers("/api/**").authenticated()
            .anyRequest().permitAll());
        http.securityContext(context -> context.securityContextRepository(contexts));
        // The SPA obtains a token in JSON, never a session credential in JS storage.
        http.csrf(config -> config.csrfTokenRepository(csrf).csrfTokenRequestHandler(new CsrfTokenRequestAttributeHandler()));
        http.requestCache(cache -> cache.disable());
        http.formLogin(login -> login.disable()).httpBasic(basic -> basic.disable()).logout(logout -> logout.disable());
        http.exceptionHandling(errors -> errors
            .authenticationEntryPoint((req, res, error) -> {
                res.setStatus(401); res.setContentType("application/json");
                res.getWriter().write("{\"error\":\"Sign in to continue\"}");
            })
            .accessDeniedHandler((req, res, error) -> {
                res.setStatus(403); res.setContentType("application/json");
                res.getWriter().write("{\"error\":\"Request could not be verified. Reload and try again.\"}");
            }));
        return http.build();
    }
}
