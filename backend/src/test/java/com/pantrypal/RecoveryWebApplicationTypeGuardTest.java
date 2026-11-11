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

class RecoveryWebApplicationTypeGuardTest {
    private static final AtomicBoolean datasourceInitialized = new AtomicBoolean();
    private final ApplicationContextRunner runner = new ApplicationContextRunner()
        .withConfiguration(AutoConfigurations.of(DataSourceAutoConfiguration.class))
        .withInitializer(new RecoveryWebApplicationTypeGuard())
        .withUserConfiguration(DatabaseProbe.class);

    @BeforeEach void reset() { datasourceInitialized.set(false); }

    @Test void conflictingWebApplicationTypeFailsBeforeContextRefresh() {
        runner.withPropertyValues("spring.main.web-application-type=servlet")
            .run(context -> {
                assertThat(context).hasFailed();
                assertThat(context.getStartupFailure())
                    .isInstanceOf(IllegalStateException.class)
                    .hasMessageContaining("spring.main.web-application-type=none")
                    .hasMessageContaining("before context refresh");
                assertThat(datasourceInitialized).isFalse();
            });
    }

    @Test void noneOrAbsentWebApplicationTypeIsAllowed() {
        runner.withPropertyValues("spring.main.web-application-type=none")
            .run(context -> {
                assertThat(context).hasNotFailed();
                assertThat(datasourceInitialized).isTrue();
            });

        runner.run(context -> {
            assertThat(context).hasNotFailed();
            assertThat(datasourceInitialized).isTrue();
        });
    }

    @TestConfiguration(proxyBeanMethods = false)
    static class DatabaseProbe {
        @Bean DataSource dataSource() {
            datasourceInitialized.set(true);
            return new org.springframework.jdbc.datasource.DriverManagerDataSource("jdbc:h2:mem:recovery_web_type_guard");
        }
    }
}
