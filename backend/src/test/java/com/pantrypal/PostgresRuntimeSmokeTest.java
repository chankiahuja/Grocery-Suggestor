package com.pantrypal;

import java.sql.DriverManager;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.stream.IntStream;
import javax.sql.DataSource;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import com.zaxxer.hikari.HikariDataSource;
import org.springframework.boot.WebApplicationType;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.jdbc.core.JdbcTemplate;
import static org.assertj.core.api.Assertions.assertThat;

@EnabledIfEnvironmentVariable(named = "PANTRYPAL_POSTGRES_RUNTIME_SMOKE", matches = "true")
class PostgresRuntimeSmokeTest {
    private static final int CONCURRENT_WRITES = 30;

    @Test
    void postgresProfileMigratesPersistsAndIsolatesDataAcrossRestart() throws Exception {
        String url = required("DB_URL");
        String username = required("DB_USER");
        String password = required("DB_PASSWORD");
        if (!url.startsWith("jdbc:postgresql:")) {
            throw new IllegalArgumentException("DB_URL must use the PostgreSQL JDBC driver");
        }

        String schema = "pp_runtime_" + UUID.randomUUID().toString().replace("-", "");
        createSchema(url, username, password, schema);
        try {
            long[] ids = seedAndVerifyFirstStart(url, username, password, schema);
            verifyRestart(url, username, password, schema, ids);
        } finally {
            executeSchemaStatement(url, username, password, "DROP SCHEMA IF EXISTS " + schema + " CASCADE");
        }
    }

    private long[] seedAndVerifyFirstStart(String url, String username, String password, String schema) throws Exception {
        try (var context = start(url, username, password, schema)) {
            verifyRuntime(context, schema);
            var service = context.getBean(PantryService.class);
            var repository = context.getBean(PantryRepository.class);
            var jdbc = context.getBean(JdbcTemplate.class);

            long ownerId = repository.insert("accounts", Map.of(
                "email", "postgres-smoke-" + schema + "@example.test",
                "display_name", "PostgreSQL Smoke"));
            long otherOwnerId = repository.insert("accounts", Map.of(
                "email", "postgres-other-" + schema + "@example.test",
                "display_name", "Other Account"));

            long alertItemId = PantryService.id(service.saveInventory(ownerId, null, Map.of(
                "name", "Persistent alert",
                "category", "Pantry",
                "quantity", 0,
                "unit", "each",
                "minThreshold", 1)));
            long concurrentItemId = PantryService.id(service.saveInventory(ownerId, null, Map.of(
                "name", "Concurrent stock",
                "category", "Pantry",
                "quantity", 0,
                "unit", "each",
                "minThreshold", 1)));
            long listId = PantryService.id(service.createList(ownerId, Map.of("name", "Persistent list")));
            service.addItem(ownerId, listId, Map.of(
                "name", "Persistent list item",
                "category", "Pantry",
                "quantity", 2,
                "unit", "each"));

            assertThat(service.inventory(Long.valueOf(otherOwnerId))).isEmpty();
            assertThat(service.lists(otherOwnerId)).isEmpty();
            assertThat(service.suggestions(ownerId))
                .extracting(suggestion -> suggestion.get("name"))
                .contains("Persistent alert");

            var executor = Executors.newFixedThreadPool(CONCURRENT_WRITES);
            try {
                var writes = IntStream.range(0, CONCURRENT_WRITES)
                    .mapToObj(index -> executor.submit(() -> service.adjustInventory(
                        ownerId,
                        concurrentItemId,
                        "postgres-smoke-" + index,
                        Map.of("operation", "restock", "amount", 1))))
                    .toList();
                for (var write : writes) write.get(60, TimeUnit.SECONDS);
            } finally {
                executor.shutdownNow();
                assertThat(executor.awaitTermination(10, TimeUnit.SECONDS)).isTrue();
            }

            assertThat(PantryService.number(service.inventory(ownerId, concurrentItemId), "quantity"))
                .isEqualTo(CONCURRENT_WRITES);
            assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM accounts WHERE id=?", Integer.class, ownerId))
                .isEqualTo(1);
            assertThat(context.getBean(HikariDataSource.class).getMaximumPoolSize()).isEqualTo(2);
            return new long[] {ownerId, otherOwnerId, alertItemId, concurrentItemId, listId};
        }
    }

    private void verifyRestart(String url, String username, String password, String schema, long[] ids) throws Exception {
        try (var context = start(url, username, password, schema)) {
            verifyRuntime(context, schema);
            var service = context.getBean(PantryService.class);
            var jdbc = context.getBean(JdbcTemplate.class);

            assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM accounts WHERE id=?", Integer.class, ids[0]))
                .isEqualTo(1);
            assertThat(PantryService.number(service.inventory(ids[0], ids[2]), "quantity")).isZero();
            assertThat(PantryService.number(service.inventory(ids[0], ids[3]), "quantity"))
                .isEqualTo(CONCURRENT_WRITES);
            assertThat(service.list(ids[0], ids[4]).get("items"))
                .asList()
                .hasSize(1);
            assertThat(service.inventory(Long.valueOf(ids[1]))).isEmpty();
            assertThat(service.lists(ids[1])).isEmpty();
            assertThat(service.suggestions(ids[0]))
                .extracting(suggestion -> suggestion.get("name"))
                .contains("Persistent alert");
        }
    }

    private ConfigurableApplicationContext start(String url, String username, String password, String schema) {
        return new SpringApplicationBuilder(PantryApplication.class)
            .web(WebApplicationType.SERVLET)
            .run(
                "--spring.profiles.active=postgres",
                "--spring.datasource.url=" + schemaUrl(url, schema),
                "--spring.datasource.driver-class-name=org.postgresql.Driver",
                "--spring.datasource.username=" + username,
                "--spring.datasource.password=" + password,
                "--spring.datasource.hikari.maximum-pool-size=2",
                "--spring.datasource.hikari.minimum-idle=1",
                "--spring.datasource.hikari.connection-timeout=30000",
                "--spring.flyway.schemas=" + schema,
                "--spring.flyway.default-schema=" + schema,
                "--spring.mail.host=localhost",
                "--spring.mail.properties.mail.smtp.auth=false",
                "--server.port=0",
                "--pantrypal.expiry-check-ms=3600000");
    }

    private void verifyRuntime(ConfigurableApplicationContext context, String schema) throws Exception {
        assertThat(context.getEnvironment().getActiveProfiles()).containsExactly("postgres");
        try (var connection = context.getBean(DataSource.class).getConnection()) {
            assertThat(connection.getMetaData().getDatabaseProductName()).contains("PostgreSQL");
            assertThat(connection.getSchema()).isEqualTo(schema);
        }

        Flyway flyway = context.getBean(Flyway.class);
        flyway.validate();
        assertThat(flyway.info().current().getVersion().getVersion()).isEqualTo("6");
    }

    private String schemaUrl(String url, String schema) {
        return url + (url.contains("?") ? "&" : "?") + "currentSchema=" + schema;
    }

    private void createSchema(String url, String username, String password, String schema) {
        executeSchemaStatement(url, username, password, "CREATE SCHEMA " + schema);
    }

    private void executeSchemaStatement(String url, String username, String password, String sql) {
        try (var connection = DriverManager.getConnection(url, username, password);
             var statement = connection.createStatement()) {
            statement.execute(sql);
        } catch (Exception error) {
            throw new IllegalStateException("Could not manage isolated PostgreSQL runtime smoke-test schema", error);
        }
    }

    private String required(String name) {
        String value = System.getenv(name);
        if (value == null || value.isBlank()) {
            throw new IllegalStateException(name + " is required for the PostgreSQL runtime smoke test");
        }
        return value;
    }
}
