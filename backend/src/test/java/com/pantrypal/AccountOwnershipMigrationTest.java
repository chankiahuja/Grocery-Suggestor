package com.pantrypal;

import java.util.UUID;
import org.flywaydb.core.Flyway;
import org.flywaydb.core.api.MigrationVersion;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import static org.assertj.core.api.Assertions.assertThat;

class AccountOwnershipMigrationTest {
    private String databaseUrl() {
        return "jdbc:h2:mem:ownership_" + UUID.randomUUID().toString().replace("-", "")
            + ";MODE=PostgreSQL;DB_CLOSE_DELAY=-1;DATABASE_TO_LOWER=TRUE";
    }

    private Flyway flyway(String url, MigrationVersion target) {
        var configuration = Flyway.configure().dataSource(url, "sa", "");
        if (target != null) configuration.target(target);
        return configuration.load();
    }

    private JdbcTemplate jdbc(String url) {
        return new JdbcTemplate(new DriverManagerDataSource(url, "sa", ""));
    }

    private void insertLegacyRows(JdbcTemplate jdbc) {
        jdbc.update("""
            INSERT INTO inventory_items (id, name, category, quantity, unit, min_threshold)
            VALUES (101, 'Legacy rice', 'Grains', 2, 'kg', 1)
            """);
        jdbc.update("INSERT INTO shopping_lists (id, name) VALUES (201, 'Legacy list')");
        jdbc.update("""
            INSERT INTO shopping_list_items
                (id, shopping_list_id, inventory_item_id, name, category, quantity, unit)
            VALUES (301, 201, 101, 'Legacy rice', 'Grains', 1, 'kg')
            """);
    }

    @Test
    void migrationAssignsExistingLegacyRowsToLowestIdAccount() {
        String url = databaseUrl();
        flyway(url, MigrationVersion.fromVersion("5")).migrate();
        JdbcTemplate jdbc = jdbc(url);
        insertLegacyRows(jdbc);
        jdbc.update("INSERT INTO accounts (id, email) VALUES (20, 'later@example.com')");
        jdbc.update("INSERT INTO accounts (id, email) VALUES (10, 'first@example.com')");

        flyway(url, null).migrate();

        assertThat(jdbc.queryForObject("SELECT account_id FROM inventory_items WHERE id=101", Long.class)).isEqualTo(10L);
        assertThat(jdbc.queryForObject("SELECT account_id FROM shopping_lists WHERE id=201", Long.class)).isEqualTo(10L);
        assertThat(jdbc.queryForObject("SELECT account_id FROM shopping_list_items WHERE id=301", Long.class)).isEqualTo(10L);
    }

    @Test
    void migrationWithoutAccountsQuarantinesRowsUntilOperatorClaimsThem() {
        String url = databaseUrl();
        flyway(url, MigrationVersion.fromVersion("5")).migrate();
        JdbcTemplate jdbc = jdbc(url);
        insertLegacyRows(jdbc);

        flyway(url, null).migrate();

        assertThat(jdbc.queryForObject("SELECT account_id FROM inventory_items WHERE id=101", Long.class)).isNull();
        assertThat(jdbc.queryForObject("SELECT account_id FROM shopping_lists WHERE id=201", Long.class)).isNull();
        assertThat(jdbc.queryForObject("SELECT account_id FROM shopping_list_items WHERE id=301", Long.class)).isNull();

        jdbc.update("INSERT INTO accounts (id, email) VALUES (7, 'operator-approved@example.com')");
        assertThat(jdbc.queryForObject("SELECT account_id FROM inventory_items WHERE id=101", Long.class)).isNull();
        assertThat(jdbc.queryForObject("SELECT account_id FROM shopping_lists WHERE id=201", Long.class)).isNull();
        assertThat(jdbc.queryForObject("SELECT account_id FROM shopping_list_items WHERE id=301", Long.class)).isNull();

        jdbc.update("UPDATE inventory_items SET account_id=7 WHERE account_id IS NULL");
        jdbc.update("UPDATE shopping_lists SET account_id=7 WHERE account_id IS NULL");
        jdbc.update("UPDATE shopping_list_items SET account_id=7 WHERE account_id IS NULL");

        assertThat(jdbc.queryForObject("SELECT account_id FROM inventory_items WHERE id=101", Long.class)).isEqualTo(7L);
        assertThat(jdbc.queryForObject("SELECT account_id FROM shopping_lists WHERE id=201", Long.class)).isEqualTo(7L);
        assertThat(jdbc.queryForObject("SELECT account_id FROM shopping_list_items WHERE id=301", Long.class)).isEqualTo(7L);
    }
}
