package com.pantrypal;

import java.nio.file.Path;
import java.sql.DriverManager;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import static org.assertj.core.api.Assertions.assertThat;

class FileDatabaseTest {
    @TempDir Path directory;

    @Test void migrationAndPantryDataSurviveReopening() throws Exception {
        String url = "jdbc:h2:file:" + directory.resolve("pantry").toString().replace('\\', '/')
            + ";MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_ON_EXIT=FALSE";
        var flyway = Flyway.configure().dataSource(url, "sa", "").load();
        assertThat(flyway.migrate().migrationsExecuted).isEqualTo(1);
        try (var connection = DriverManager.getConnection(url, "sa", "");
             var statement = connection.createStatement()) {
            statement.executeUpdate("INSERT INTO inventory_items (name, category, quantity, unit, min_threshold) VALUES ('Persistence check', 'Other', 3, 'pieces', 1)");
        }
        assertThat(Flyway.configure().dataSource(url, "sa", "").load().migrate().migrationsExecuted).isZero();
        try (var connection = DriverManager.getConnection(url, "sa", "");
             var statement = connection.createStatement();
             var rows = statement.executeQuery("SELECT quantity FROM inventory_items WHERE name = 'Persistence check'")) {
            assertThat(rows.next()).isTrue();
            assertThat(rows.getDouble(1)).isEqualTo(3);
        }
    }
}
