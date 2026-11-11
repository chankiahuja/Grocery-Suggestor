package com.pantrypal;

import org.springframework.context.ApplicationContextInitializer;
import org.springframework.context.ConfigurableApplicationContext;

/** Blocks recovery startup before any datasource or Flyway bean can initialize. */
final class RecoveryFlywayGuard implements ApplicationContextInitializer<ConfigurableApplicationContext> {
    @Override
    public void initialize(ConfigurableApplicationContext context) {
        if (Boolean.parseBoolean(context.getEnvironment().getProperty("spring.flyway.enabled", "false"))) {
            throw new IllegalStateException(
                "Recovery reconciliation requires spring.flyway.enabled=false; startup blocked before database initialization.");
        }
    }
}
