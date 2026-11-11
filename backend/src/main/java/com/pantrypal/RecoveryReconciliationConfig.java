package com.pantrypal;

import java.nio.file.Path;
import java.time.Instant;
import java.util.List;
import org.flywaydb.core.Flyway;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.boot.SpringApplication;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Profile;
import org.springframework.core.env.Environment;
import org.springframework.jdbc.core.JdbcTemplate;

/** Beans for the explicitly selected, offline recovery reconciliation profile. */
@Configuration(proxyBeanMethods = false)
@Profile("recovery")
class RecoveryReconciliationConfig {
    @Bean
    ApplicationRunner recoveryReconciliationRunner(
            ApplicationArguments arguments,
            ConfigurableApplicationContext context,
            Environment environment,
            javax.sql.DataSource dataSource,
            JdbcTemplate jdbc,
            AccountDeletionService deletion) {
        return ignored -> {
            if (!isTrue(arguments, "recovery.reconcile"))
                throw new IllegalArgumentException("Recovery profile requires --recovery.reconcile=true");
            if (!isTrue(arguments, "recovery.confirm-isolated"))
                throw new IllegalArgumentException("Pass --recovery.confirm-isolated=true for an isolated restored target");

            Path file = Path.of(required(arguments, "recovery.deletions-file"));
            Instant snapshotAt = Instant.parse(required(arguments, "recovery.snapshot-at"));
            String backupId = required(arguments, "recovery.backup-id");
            boolean confirmZeroDeletions = isTrue(arguments, "recovery.confirm-zero-deletions");
            if (Boolean.parseBoolean(environment.getProperty("spring.flyway.enabled", "true")))
                throw new IllegalArgumentException("Recovery reconciliation requires spring.flyway.enabled=false");

            Flyway flyway = Flyway.configure().dataSource(dataSource).load();
            flyway.validate();
            if (flyway.info().pending().length != 0)
                throw new IllegalStateException("Restored database has pending migrations; stop and resolve before reconciliation");

            var records = RecoveryReconciliation.read(file);
            RecoveryReconciliation.validate(records, snapshotAt, backupId, confirmZeroDeletions);
            var outcomes = RecoveryReconciliation.reconcile(records, jdbc, deletion);
            long deleted = outcomes.stream().filter(outcome -> "deleted".equals(outcome.status())).count();
            long absent = outcomes.size() - deleted;
            System.out.printf("Recovery reconciliation passed: backup=%s, records=%d, deleted=%d, already_absent=%d%n",
                backupId, outcomes.size(), deleted, absent);
            SpringApplication.exit(context, () -> 0);
        };
    }

    private static String required(ApplicationArguments arguments, String name) {
        List<String> values = arguments.getOptionValues(name);
        if (values == null || values.size() != 1 || values.get(0).isBlank())
            throw new IllegalArgumentException("Exactly one non-empty --" + name + " value is required");
        return values.get(0);
    }

    private static boolean isTrue(ApplicationArguments arguments, String name) {
        List<String> values = arguments.getOptionValues(name);
        return values != null && values.size() == 1 && "true".equalsIgnoreCase(values.get(0));
    }
}
