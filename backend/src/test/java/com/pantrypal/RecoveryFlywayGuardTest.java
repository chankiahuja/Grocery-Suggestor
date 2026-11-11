package com.pantrypal;

import java.util.concurrent.atomic.AtomicBoolean;
import javax.sql.DataSource;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.boot.autoconfigure.AutoConfigurations;
import org.springframework.boot.autoconfigure.jdbc.DataSourceAutoConfiguration;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import static org.assertj.core.api.Assertions.assertThat;

class RecoveryFlywayGuardTest {
    private static final AtomicBoolean datasourceInitialized = new AtomicBoolean();
    private final ApplicationContextRunner runner = new ApplicationContextRunner()
        .withConfiguration(AutoConfigurations.of(DataSourceAutoConfiguration.class))
        .withInitializer(new RecoveryFlywayGuard())
        .withUserConfiguration(DatabaseProbe.class);

    @BeforeEach void reset() { datasourceInitialized.set(false); }

    @Test void enabledFlywayOverrideFailsBeforeContextRefresh() {
        runner.withPropertyValues("spring.flyway.enabled=true")
            .run(context -> {
                assertThat(context).hasFailed();
                assertThat(context.getStartupFailure())
                    .isInstanceOf(IllegalStateException.class)
                    .hasMessageContaining("spring.flyway.enabled=false")
                    .hasMessageContaining("before database initialization");
                assertThat(datasourceInitialized).isFalse();
            });
    }

    @Test void disabledFlywaySettingAllowsContextInitialization() {
        runner.withPropertyValues("spring.flyway.enabled=false")
            .run(context -> {
                assertThat(context).hasNotFailed();
                assertThat(datasourceInitialized).isTrue();
            });
    }

    @TestConfiguration(proxyBeanMethods = false)
    @Import(DataSourceProbe.class)
    static class DatabaseProbe {}

    static class DataSourceProbe {
        @Bean DataSource dataSource() {
            datasourceInitialized.set(true);
            return new org.springframework.jdbc.datasource.DriverManagerDataSource("jdbc:h2:mem:recovery_guard");
        }
    }
}
