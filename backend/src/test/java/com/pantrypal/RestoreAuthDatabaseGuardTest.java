package com.pantrypal;

import java.util.concurrent.atomic.AtomicBoolean;
import com.zaxxer.hikari.HikariDataSource;
import org.springframework.beans.factory.config.BeanPostProcessor;
import org.springframework.boot.autoconfigure.AutoConfigurations;
import org.springframework.boot.autoconfigure.jdbc.DataSourceAutoConfiguration;
import javax.sql.DataSource;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;

class RestoreAuthDatabaseGuardTest {
    // Use Boot's real Hikari binding, without the mocked datasource configuration below.
    private ApplicationContextRunner hikariRunner(AtomicBoolean datasourceInitialized) {
        return new ApplicationContextRunner()
            .withConfiguration(AutoConfigurations.of(DataSourceAutoConfiguration.class))
            .withInitializer(new RestoreAuthDatabaseGuard())
            .withInitializer(context -> context.getBeanFactory().addBeanPostProcessor(new BeanPostProcessor() {
                @Override public Object postProcessBeforeInitialization(Object bean, String name) {
                    if (bean instanceof DataSource) datasourceInitialized.set(true);
                    return bean;
                }
            }));
    }

    @ParameterizedTest
    @ValueSource(strings = {"false", "true"})
    void hikariCannotRedirectTheSelectedTargetEvenWithOptIn(String optIn) {
        var initialized = new AtomicBoolean();
        hikariRunner(initialized).withPropertyValues(
                "spring.datasource.url=jdbc:h2:mem:restore_guard_selected",
                "spring.datasource.hikari.jdbc-url=jdbc:postgresql://must-not-connect.invalid/shared?password=do-not-log-me",
                "spring.datasource.hikari.driver-class-name=org.postgresql.Driver",
                RestoreAuthDatabaseGuard.OPT_IN + "=" + optIn)
            .run(context -> {
                assertThat(context).hasFailed();
                assertThat(context.getStartupFailure()).isInstanceOf(IllegalStateException.class)
                    .hasMessageContaining("conflicting Hikari override")
                    .hasMessageNotContaining("must-not-connect.invalid")
                    .hasMessageNotContaining("do-not-log-me");
                assertThat(initialized).isFalse();
            });
    }

    @Test void optedInPostgresSchemaCannotBeReplacedByAnotherHikariSchema() {
        var initialized = new AtomicBoolean();
        hikariRunner(initialized).withPropertyValues(
                "spring.datasource.url=jdbc:postgresql://must-not-connect.invalid/test?currentSchema=isolated",
                "spring.datasource.hikari.jdbc-url=jdbc:postgresql://must-not-connect.invalid/test?currentSchema=shared",
                "spring.datasource.driver-class-name=org.postgresql.Driver",
                RestoreAuthDatabaseGuard.OPT_IN + "=true")
            .run(context -> {
                assertThat(context).hasFailed();
                assertThat(context.getStartupFailure()).hasMessageContaining("conflicting Hikari override");
                assertThat(initialized).isFalse();
            });
    }

    @Test void realHikariUsesTheSelectedInMemoryUrl() {
        var initialized = new AtomicBoolean();
        String url = "jdbc:h2:mem:restore_guard_hikari";
        hikariRunner(initialized).withPropertyValues("spring.datasource.url=" + url,
                "spring.datasource.hikari.jdbc-url=" + url, "spring.datasource.driver-class-name=org.h2.Driver")
            .run(context -> {
                assertThat(context).hasNotFailed();
                assertThat(initialized).isTrue();
                assertThat(context.getBean(HikariDataSource.class).getJdbcUrl()).isEqualTo(url);
            });
    }

    @Test void realHikariPreservesAnExplicitlySelectedPostgresSchemaWithoutConnecting() {
        var initialized = new AtomicBoolean();
        String url = "jdbc:postgresql://must-not-connect.invalid/test?currentSchema=isolated";
        hikariRunner(initialized).withPropertyValues("spring.datasource.url=" + url,
                "spring.datasource.hikari.jdbc-url=" + url, "spring.datasource.driver-class-name=org.postgresql.Driver",
                RestoreAuthDatabaseGuard.OPT_IN + "=true")
            .run(context -> {
                assertThat(context).hasNotFailed();
                assertThat(initialized).isTrue();
                assertThat(context.getBean(HikariDataSource.class).getJdbcUrl()).isEqualTo(url);
            });
    }

    static final AtomicBoolean datasourceCreated = new AtomicBoolean();
    static final AtomicBoolean migrationsInitialized = new AtomicBoolean();
    private final ApplicationContextRunner runner = new ApplicationContextRunner()
        .withInitializer(new RestoreAuthDatabaseGuard())
        .withUserConfiguration(DatabaseProbes.class);

    @BeforeEach void reset() { datasourceCreated.set(false); migrationsInitialized.set(false); }

    @TestConfiguration(proxyBeanMethods = false)
    static class DatabaseProbes {
        @Bean DataSource dataSource() { datasourceCreated.set(true); return mock(DataSource.class); }
        @Bean Flyway flyway() { migrationsInitialized.set(true); return mock(Flyway.class); }
    }

    @Test void defaultInMemoryPlaceholderStartsNormally() {
        runner.withPropertyValues("spring.datasource.url=${RESTORE_AUTH_DB_URL:jdbc:h2:mem:restore_auth;MODE=PostgreSQL}",
                "RESTORE_AUTH_DB_URL=jdbc:h2:mem:restore_auth;MODE=PostgreSQL")
            .run(context -> {
                assertThat(context).hasNotFailed();
                assertThat(datasourceCreated).isTrue();
                assertThat(migrationsInitialized).isTrue();
            });
    }

    @Test void externalOverrideIsRejectedBeforeAnyDatabaseBeanAndDoesNotRevealCredentials() {
        runner.withPropertyValues("spring.datasource.url=${RESTORE_AUTH_DB_URL}",
                "RESTORE_AUTH_DB_URL=jdbc:postgresql://must-not-connect.invalid/shared?password=do-not-log-me",
                RestoreAuthDatabaseGuard.OPT_IN + "=false")
            .run(context -> {
                assertThat(context).hasFailed();
                assertThat(context.getStartupFailure()).isInstanceOf(IllegalStateException.class)
                    .hasMessageContaining(RestoreAuthDatabaseGuard.OPT_IN)
                    .hasMessageNotContaining("do-not-log-me")
                    .hasMessageNotContaining("must-not-connect.invalid");
                assertThat(datasourceCreated).isFalse();
                assertThat(migrationsInitialized).isFalse();
            });
    }

    @Test void effectiveDatasourceOverrideCannotBypassGuardWithAnInMemoryEnvironmentUrl() {
        runner.withPropertyValues("RESTORE_AUTH_DB_URL=jdbc:h2:mem:innocent",
                "spring.datasource.url=jdbc:postgresql://must-not-connect.invalid/shared",
                RestoreAuthDatabaseGuard.OPT_IN + "=false")
            .run(context -> {
                assertThat(context).hasFailed();
                assertThat(datasourceCreated).isFalse();
                assertThat(migrationsInitialized).isFalse();
            });
    }

    @ParameterizedTest
    @ValueSource(strings = {"jdbc:h2:file:./shared", "jdbc:h2:tcp://must-not-connect.invalid/shared", "jdbc:postgresql://must-not-connect.invalid/shared"})
    void externalAndPersistentTargetsRequireOptIn(String url) {
        runner.withPropertyValues("spring.datasource.url=" + url, RestoreAuthDatabaseGuard.OPT_IN + "=")
            .run(context -> {
                assertThat(context).hasFailed();
                assertThat(datasourceCreated).isFalse();
                assertThat(migrationsInitialized).isFalse();
            });
    }

    @Test void explicitOptInPreservesTheTemporarySchemaWorkflowWithoutConnectingInThisUnitTest() {
        runner.withPropertyValues("spring.datasource.url=jdbc:postgresql://localhost/pantrypal_auth_test?currentSchema=pp_restore_guard_test",
                RestoreAuthDatabaseGuard.OPT_IN + "=true")
            .run(context -> {
                assertThat(context).hasNotFailed();
                assertThat(datasourceCreated).isTrue();
                assertThat(migrationsInitialized).isTrue();
            });
    }
}
