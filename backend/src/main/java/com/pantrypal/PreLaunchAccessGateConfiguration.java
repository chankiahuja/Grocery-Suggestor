package com.pantrypal;

import java.nio.charset.StandardCharsets;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/** Creates the temporary outer gate used while production is being validated. */
@Configuration(proxyBeanMethods = false)
@ConditionalOnWebApplication(type = ConditionalOnWebApplication.Type.SERVLET)
class PreLaunchAccessGateConfiguration {
    @Bean
    @ConditionalOnProperty(prefix = "pantrypal.prelaunch-gate", name = "enabled", havingValue = "true")
    PreLaunchAccessGateFilter preLaunchAccessGateFilter(
            @Value("${pantrypal.prelaunch-gate.username:}") String username,
            @Value("${pantrypal.prelaunch-gate.password:}") String password) {
        validate(username, password);
        return new PreLaunchAccessGateFilter(username, password);
    }

    @Bean
    @ConditionalOnProperty(prefix = "pantrypal.prelaunch-gate", name = "enabled", havingValue = "true")
    FilterRegistrationBean<PreLaunchAccessGateFilter> disableContainerRegistration(
            PreLaunchAccessGateFilter filter) {
        var registration = new FilterRegistrationBean<>(filter);
        registration.setEnabled(false);
        return registration;
    }

    static void validate(String username, String password) {
        if (username == null || username.isBlank()) {
            throw new IllegalStateException("Pre-launch access gate requires an operator username.");
        }
        if (username.indexOf(':') >= 0) {
            throw new IllegalStateException("Pre-launch access gate username must not contain ':'.");
        }
        if (password == null || password.length() < 20) {
            throw new IllegalStateException("Pre-launch access gate requires a password of at least 20 characters.");
        }
        if (password.getBytes(StandardCharsets.UTF_8).length < 20) {
            throw new IllegalStateException("Pre-launch access gate password must contain at least 20 bytes.");
        }
    }
}
