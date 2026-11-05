package com.pantrypal;

import java.sql.DriverManager;
import java.util.UUID;
import org.flywaydb.core.Flyway;
import org.flywaydb.core.api.MigrationVersion;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import static org.assertj.core.api.Assertions.assertThat;

@EnabledIfEnvironmentVariable(named = "PANTRYPAL_POSTGRES_SMOKE", matches = "true")
class PostgresAccountOwnershipSmokeTest {
    @Test
    void ownershipMigrationPreservesOperatorOnlyClaimPolicy() throws Exception {
        String url = required("DB_URL");
        String username = required("DB_USER");
        String password = required("DB_PASSWORD");
        if (!url.startsWith("jdbc:postgresql:")) {
            throw new IllegalArgumentException("DB_URL must use the PostgreSQL JDBC driver");
        }

        String schema = "pp_smoke_" + UUID.randomUUID().toString().replace("-", "");
        try {
            try (var connection = DriverManager.getConnection(url, username, password);
                 var statement = connection.createStatement()) {
                if (!connection.getMetaData().getDatabaseProductName().contains("PostgreSQL")) {
                    throw new IllegalStateException("Smoke test requires a PostgreSQL database");
                }
                statement.execute("CREATE SCHEMA " + schema);
            }

            verifyMigrationWithAccounts(url, username, password, schema);
            verifyMigrationWithoutAccounts(url, username, password, schema);
        } finally {
            try (var connection = DriverManager.getConnection(url, username, password);
                 var statement = connection.createStatement()) {
                statement.execute("DROP SCHEMA IF EXISTS " + schema + " CASCADE");
            }
        }
    }

    private void verifyMigrationWithAccounts(String url, String username, String password, String schema) {
        String scenarioSchema = schema + "_with_accounts";
        createSchema(url, username, password, scenarioSchema);
        try {
            flyway(url, username, password, scenarioSchema, MigrationVersion.fromVersion("5")).migrate();
            JdbcTemplate jdbc = jdbc(url, username, password);
            insertLegacyRows(jdbc, scenarioSchema);
            jdbc.update("INSERT INTO " + scenarioSchema + ".accounts (id, email) VALUES (20, 'later@example.com')");
            jdbc.update("INSERT INTO " + scenarioSchema + ".accounts (id, email) VALUES (10, 'first@example.com')");

            flyway(url, username, password, scenarioSchema, null).migrate();

            assertThat(accountId(jdbc, scenarioSchema, "inventory_items", 101)).isEqualTo(10L);
            assertThat(accountId(jdbc, scenarioSchema, "shopping_lists", 201)).isEqualTo(10L);
            assertThat(accountId(jdbc, scenarioSchema, "shopping_list_items", 301)).isEqualTo(10L);
        } finally {
            dropSchema(url, username, password, scenarioSchema);
        }
    }

    private void verifyMigrationWithoutAccounts(String url, String username, String password, String schema) {
        String scenarioSchema = schema + "_without_accounts";
        createSchema(url, username, password, scenarioSchema);
        try {
            flyway(url, username, password, scenarioSchema, MigrationVersion.fromVersion("5")).migrate();
            JdbcTemplate jdbc = jdbc(url, username, password);
            insertLegacyRows(jdbc, scenarioSchema);

            flyway(url, username, password, scenarioSchema, null).migrate();

            assertUnowned(jdbc, scenarioSchema);
            jdbc.update("INSERT INTO " + scenarioSchema + ".accounts (id, email) VALUES (7, 'new@example.com')");
            assertUnowned(jdbc, scenarioSchema);

            jdbc.update("UPDATE " + scenarioSchema + ".inventory_items SET account_id=7 WHERE account_id IS NULL");
            jdbc.update("UPDATE " + scenarioSchema + ".shopping_lists SET account_id=7 WHERE account_id IS NULL");
            jdbc.update("UPDATE " + scenarioSchema + ".shopping_list_items SET account_id=7 WHERE account_id IS NULL");

            assertThat(accountId(jdbc, scenarioSchema, "inventory_items", 101)).isEqualTo(7L);
            assertThat(accountId(jdbc, scenarioSchema, "shopping_lists", 201)).isEqualTo(7L);
            assertThat(accountId(jdbc, scenarioSchema, "shopping_list_items", 301)).isEqualTo(7L);
        } finally {
            dropSchema(url, username, password, scenarioSchema);
        }
    }

    private Flyway flyway(String url, String username, String password, String schema, MigrationVersion target) {
        var configuration = Flyway.configure()
            .dataSource(url, username, password)
            .schemas(schema)
            .defaultSchema(schema);
        if (target != null) configuration.target(target);
        return configuration.load();
    }

    private JdbcTemplate jdbc(String url, String username, String password) {
        return new JdbcTemplate(new DriverManagerDataSource(url, username, password));
    }

    private void createSchema(String url, String username, String password, String schema) {
        executeSchemaStatement(url, username, password, "CREATE SCHEMA " + schema);
    }

    private void dropSchema(String url, String username, String password, String schema) {
        executeSchemaStatement(url, username, password, "DROP SCHEMA IF EXISTS " + schema + " CASCADE");
    }

    private void executeSchemaStatement(String url, String username, String password, String sql) {
        try (var connection = DriverManager.getConnection(url, username, password);
             var statement = connection.createStatement()) {
            statement.execute(sql);
        } catch (Exception error) {
            throw new IllegalStateException("Could not manage isolated PostgreSQL smoke-test schema", error);
        }
    }

    private void insertLegacyRows(JdbcTemplate jdbc, String schema) {
        jdbc.update("INSERT INTO " + schema
            + ".inventory_items (id, name, category, quantity, unit, min_threshold)"
            + " VALUES (101, 'Legacy rice', 'Grains', 2, 'kg', 1)");
        jdbc.update("INSERT INTO " + schema + ".shopping_lists (id, name) VALUES (201, 'Legacy list')");
        jdbc.update("INSERT INTO " + schema
            + ".shopping_list_items (id, shopping_list_id, inventory_item_id, name, category, quantity, unit)"
            + " VALUES (301, 201, 101, 'Legacy rice', 'Grains', 1, 'kg')");
    }

    private Long accountId(JdbcTemplate jdbc, String schema, String table, long id) {
        return jdbc.queryForObject("SELECT account_id FROM " + schema + "." + table + " WHERE id=?",
            Long.class, id);
    }

    private void assertUnowned(JdbcTemplate jdbc, String schema) {
        assertThat(accountId(jdbc, schema, "inventory_items", 101)).isNull();
        assertThat(accountId(jdbc, schema, "shopping_lists", 201)).isNull();
        assertThat(accountId(jdbc, schema, "shopping_list_items", 301)).isNull();
    }

    private String required(String name) {
        String value = System.getenv(name);
        if (value == null || value.isBlank()) {
            throw new IllegalStateException(name + " is required for the PostgreSQL smoke test");
        }
        return value;
    }
}
