package com.pantrypal;

import org.springframework.context.ApplicationContextInitializer;
import org.springframework.context.ConfigurableApplicationContext;

/** Prevents recovery from connecting through a conflicting Hikari datasource URL. */
final class RecoveryDatasourceGuard implements ApplicationContextInitializer<ConfigurableApplicationContext> {
    @Override
    public void initialize(ConfigurableApplicationContext context) {
        var environment = context.getEnvironment();
        String selectedUrl = environment.getProperty("spring.datasource.url");
        String hikariUrl = environment.getProperty("spring.datasource.hikari.jdbc-url");
        if (hikariUrl != null && !hikariUrl.isBlank() && selectedUrl != null && !selectedUrl.equals(hikariUrl)) {
            throw new IllegalStateException(
                "Recovery reconciliation requires spring.datasource.hikari.jdbc-url to match spring.datasource.url"
                    + "; startup blocked before database initialization.");
        }
    }
}
