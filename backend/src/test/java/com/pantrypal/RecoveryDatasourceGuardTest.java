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
import static org.assertj.core.api.Assertions.assertThat;

class RecoveryDatasourceGuardTest {
    private static final AtomicBoolean datasourceInitialized = new AtomicBoolean();
    private final ApplicationContextRunner runner = new ApplicationContextRunner()
        .withConfiguration(AutoConfigurations.of(DataSourceAutoConfiguration.class))
        .withInitializer(new RecoveryDatasourceGuard())
        .withUserConfiguration(DatabaseProbe.class);

    @BeforeEach void reset() { datasourceInitialized.set(false); }

    @Test void conflictingHikariUrlFailsBeforeDatasourceInitialization() {
        runner.withPropertyValues(
                "spring.datasource.url=jdbc:postgresql://selected.example/restore",
                "spring.datasource.hikari.jdbc-url=jdbc:postgresql://other.example/restore")
            .run(context -> {
                assertThat(context).hasFailed();
                assertThat(context.getStartupFailure())
                    .isInstanceOf(IllegalStateException.class)
                    .hasMessageContaining("to match")
                    .hasMessageContaining("before database initialization")
                    .hasMessageNotContaining("selected.example")
                    .hasMessageNotContaining("other.example");
                assertThat(datasourceInitialized).isFalse();
            });
    }

    @Test void matchingHikariUrlIsAllowed() {
        String url = "jdbc:postgresql://selected.example/restore";
        runner.withPropertyValues(
                "spring.datasource.url=" + url,
                "spring.datasource.hikari.jdbc-url=" + url)
            .run(context -> {
                assertThat(context).hasNotFailed();
                assertThat(datasourceInitialized).isTrue();
            });
    }

    @TestConfiguration(proxyBeanMethods = false)
    static class DatabaseProbe {
        @Bean DataSource dataSource() {
            datasourceInitialized.set(true);
            return new org.springframework.jdbc.datasource.DriverManagerDataSource("jdbc:h2:mem:recovery_datasource_guard");
        }
    }
}
