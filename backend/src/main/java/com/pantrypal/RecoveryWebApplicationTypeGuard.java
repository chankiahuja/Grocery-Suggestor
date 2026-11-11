package com.pantrypal;

import org.springframework.context.ApplicationContextInitializer;
import org.springframework.context.ConfigurableApplicationContext;

/** Prevents recovery from being changed back to a web application before refresh. */
final class RecoveryWebApplicationTypeGuard
    implements ApplicationContextInitializer<ConfigurableApplicationContext> {
    @Override
    public void initialize(ConfigurableApplicationContext context) {
        String webApplicationType = context.getEnvironment().getProperty("spring.main.web-application-type");
        if (webApplicationType != null && !webApplicationType.isBlank()
            && !"none".equalsIgnoreCase(webApplicationType.trim())) {
            throw new IllegalStateException(
                "Recovery reconciliation requires spring.main.web-application-type=none"
                    + "; startup blocked before context refresh.");
        }
    }
}
