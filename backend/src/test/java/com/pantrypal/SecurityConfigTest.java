package com.pantrypal;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.web.SecurityFilterChain;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;

class SecurityConfigTest {
    @Test void nonWebContextKeepsSharedBeansButDoesNotCreateServletFilterChain() {
        new ApplicationContextRunner()
            .withUserConfiguration(SecurityConfig.class)
            .withBean(JdbcTemplate.class, () -> mock(JdbcTemplate.class))
            .run(context -> {
                assertThat(context).hasNotFailed();
                assertThat(context).hasBean("authClock");
                assertThat(context).hasBean("noPasswordLogin");
                assertThat(context).hasBean("securityContexts");
                assertThat(context).hasBean("csrfTokens");
                assertThat(context).hasBean("sessionCookies");
                assertThat(context).doesNotHaveBean(SecurityFilterChain.class);
            });
    }
}
