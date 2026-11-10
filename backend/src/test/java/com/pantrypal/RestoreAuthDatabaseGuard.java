package com.pantrypal;

import org.springframework.context.ApplicationContextInitializer;
import org.springframework.context.ConfigurableApplicationContext;

/** Runs before context refresh, datasource creation and Flyway initialization. */
public final class RestoreAuthDatabaseGuard implements ApplicationContextInitializer<ConfigurableApplicationContext> {
    static final String OPT_IN = "RESTORE_AUTH_ALLOW_EXTERNAL_DATABASE";

    @Override public void initialize(ConfigurableApplicationContext context) {
        var environment = context.getEnvironment();
        // Inspect the resolved effective property, including overrides of the test's placeholder.
        String url = environment.getRequiredProperty("spring.datasource.url");
        if (url.startsWith("jdbc:h2:mem:")) return;
        if ("true".equalsIgnoreCase(environment.getProperty(OPT_IN))) return;
        // Never include the URL: JDBC URLs may contain credentials.
        throw new IllegalStateException("Restore authentication tests require " + OPT_IN
            + "=true for any target other than in-memory H2. Select an isolated disposable database/schema first."
            + " Startup blocked before database initialization.");
    }
}
