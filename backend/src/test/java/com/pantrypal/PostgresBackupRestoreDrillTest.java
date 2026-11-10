package com.pantrypal;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.sql.DriverManager;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import javax.sql.DataSource;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;
import org.springframework.context.annotation.Bean;
import org.springframework.core.io.ClassPathResource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.jdbc.datasource.init.ScriptUtils;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.annotation.EnableTransactionManagement;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** Full logical export/restore of synthetic data, never an operator-selected restore target. */
@EnabledIfEnvironmentVariable(named = "PANTRYPAL_POSTGRES_BACKUP_DRILL", matches = "true")
class PostgresBackupRestoreDrillTest {
    private final String port = System.getenv().getOrDefault("BACKUP_DRILL_PORT", "5432");
    private final Clock clock = Clock.fixed(Instant.now(), ZoneOffset.UTC);
    private String user;
    private String password;
    private Path output;
    private final Map<String, Long> timings = new LinkedHashMap<>();

    @TestConfiguration(proxyBeanMethods = false)
    @EnableTransactionManagement
    static class Transactions {
        @Bean PlatformTransactionManager transactionManager(DataSource dataSource) {
            return new DataSourceTransactionManager(dataSource);
        }
    }

    record Fixture(long owner, long other, long deleted, long lowStock, long purchasedStock,
                   long list, List<Map<String, Object>> inventory, Map<String, Object> shopping,
                   List<Map<String, Object>> alerts) {}

    @Test void exportsAndRestoresAWholeDatabaseWithoutResurrectingDeletedData() throws Exception {
        // No arbitrary host, source or target URL. This opt-in can only create databases on loopback.
        if (!port.matches("[0-9]{1,5}") || Integer.parseInt(port) < 1 || Integer.parseInt(port) > 65535)
            throw new IllegalArgumentException("BACKUP_DRILL_PORT must be a local PostgreSQL port");
        user = required("BACKUP_DRILL_USER");
        password = required("BACKUP_DRILL_PASSWORD");
        Path bin = Path.of(required("BACKUP_DRILL_PG_BIN"));
        String suffix = UUID.randomUUID().toString().replace("-", "");
        String source = "pp_backup_source_" + suffix;
        String target = "pp_backup_restored_" + suffix;
        output = Path.of("target", "backup-drill", suffix);
        Files.createDirectories(output);
        Path archive = output.resolve("synthetic.dump").toAbsolutePath();
        var created = new ArrayList<String>();
        long totalStart = System.nanoTime();
        try {
            createDatabase(source); created.add(source);
            createDatabase(target); created.add(target);
            var sourceData = dataSource(source);
            var targetData = dataSource(target);
            Flyway.configure().dataSource(sourceData).load().migrate();
            Fixture fixture;
            try (var context = services(sourceData)) { fixture = seed(context); }
            Map<String, String> snapshot = fingerprints(new JdbcTemplate(sourceData));

            long started = System.nanoTime();
            command(bin, "pg_dump", source, "--format=custom", "--no-owner", "--no-acl", "--file=" + archive);
            timings.put("export_ms", elapsed(started));
            assertThat(Files.size(archive)).isPositive();
            command(bin, "pg_restore", null, "--list", archive.toString());

            // An external deletion record is simulated by fixture.deleted, outside the archive.
            // Deliberately change the source after the backup to test the recovery point.
            try (var context = services(sourceData)) {
                context.getBean(AccountDeletionService.class).delete(fixture.deleted);
                context.getBean(PantryService.class).adjustInventory(fixture.owner, fixture.lowStock,
                    "after-backup", Map.of("operation", "restock", "amount", 7));
            }
            var restored = new JdbcTemplate(targetData);
            assertThat(restored.queryForObject("SELECT COUNT(*) FROM pg_tables WHERE schemaname='public'", Integer.class)).isZero();
            started = System.nanoTime();
            command(bin, "pg_restore", target, "--exit-on-error", "--single-transaction", "--no-owner", "--no-acl", archive.toString());
            timings.put("restore_ms", elapsed(started));

            started = System.nanoTime();
            assertThat(fingerprints(restored)).isEqualTo(snapshot);
            var flyway = Flyway.configure().dataSource(targetData).load();
            flyway.validate();
            assertThat(flyway.info().pending()).isEmpty();
            assertThat(count(restored, "spring_session")).isPositive();
            assertThat(count(restored, "spring_session_attributes")).isPositive();
            assertThat(count(restored, "email_challenges")).isPositive();
            assertThat(restored.queryForObject("SELECT COUNT(*) FROM accounts WHERE id=?", Integer.class, fixture.deleted)).isEqualTo(1);

            // No HTTP server, schedulers or mail workers run against the restored database.
            try (var context = services(targetData)) {
                context.getBean(AccountDeletionService.class).delete(fixture.deleted);
                for (int repeat = 0; repeat < 2; repeat++) {
                    try (var connection = targetData.getConnection()) {
                        ScriptUtils.executeSqlScript(connection, new ClassPathResource("db/operations/invalidate_restored_auth.sql"));
                    }
                }
                for (String table : List.of("spring_session", "spring_session_attributes", "email_challenges"))
                    assertThat(count(restored, table)).isZero();
                assertThat(restored.queryForObject("SELECT COUNT(*) FROM accounts WHERE id=?", Integer.class, fixture.deleted)).isZero();
                for (String table : List.of("inventory_items", "shopping_lists", "shopping_list_items"))
                    assertThat(restored.queryForObject("SELECT COUNT(*) FROM " + table + " WHERE account_id=?", Integer.class, fixture.deleted)).isZero();
                assertThat(count(restored, "accounts")).isEqualTo(2);
                var service = context.getBean(PantryService.class);
                assertThat(service.inventory(Long.valueOf(fixture.owner))).isEqualTo(fixture.inventory);
                assertThat(service.list(fixture.owner, fixture.list)).isEqualTo(fixture.shopping);
                assertThat(service.suggestions(fixture.owner)).isEqualTo(fixture.alerts);
                assertThat(service.suggestions(fixture.owner)).extracting(row -> row.get("urgency"))
                    .contains("critical", "low", "expiring_soon", "expired");
                assertThat(service.inventory(Long.valueOf(fixture.other))).hasSize(1);
                assertThat(service.lists(fixture.other)).isEmpty();
                assertThatThrownBy(() -> service.list(fixture.other, fixture.list))
                    .isInstanceOf(org.springframework.web.server.ResponseStatusException.class);
                // Preserve the restocked marker: completing this restored purchase must not add stock twice.
                assertThat(service.purchase(fixture.owner, fixture.list)).containsEntry("updatedInventoryItems", 0);
                assertThat(PantryService.number(service.inventory(fixture.owner, fixture.purchasedStock), "quantity")).isEqualTo(5);
                assertThat(count(restored, "inventory_adjustments")).isEqualTo(1);
                long maxId = restored.queryForObject("SELECT MAX(id) FROM inventory_items", Long.class);
                assertThat(PantryService.id(service.saveInventory(fixture.owner, null, item("After restore", 1, 1)))).isGreaterThan(maxId);
            }
            timings.put("validation_and_cleanup_ms", elapsed(started));
            timings.put("total_drill_ms", elapsed(totalStart));
            timings.put("archive_bytes", Files.size(archive));
            String report = "Synthetic local full-database restore drill PASSED\n"
                + "Source and target: newly created loopback databases; no production data\n"
                + "Tables verified before recovery cleanup: " + snapshot.size() + "\n"
                + "Archive SHA-256: " + digest(Files.readAllBytes(archive)) + "\n"
                + timings + "\n"
                + "Limits: service-layer validation; no HTTP/email/provider recovery or production RPO/RTO proof\n";
            Files.writeString(output.resolve("result.txt"), report);
            System.out.println(report);
        } finally {
            // Only databases successfully created by this invocation can enter the cleanup list.
            java.sql.SQLException cleanupFailure = null;
            for (String database : created) {
                try { databaseStatement("DROP DATABASE " + database); }
                catch (java.sql.SQLException failure) { cleanupFailure = failure; }
            }
            if (cleanupFailure != null) throw cleanupFailure;
        }
    }

    private Fixture seed(AnnotationConfigApplicationContext context) {
        var repository = context.getBean(PantryRepository.class);
        var jdbc = context.getBean(JdbcTemplate.class);
        var service = context.getBean(PantryService.class);
        long owner = account(repository, jdbc, "owner");
        long other = account(repository, jdbc, "other");
        long deleted = account(repository, jdbc, "deleted-after-backup");
        service.saveInventory(owner, null, item("Empty stock", 0, 1));
        long low = PantryService.id(service.saveInventory(owner, null, item("Low stock", 2, 3)));
        service.adjustInventory(owner, low, "before-backup", Map.of("operation", "consume", "amount", 1));
        for (int days : List.of(-1, 2)) {
            var body = new LinkedHashMap<String, Object>(item("Expiry " + days, 4, 1));
            body.put("expiresAt", LocalDate.now(clock).plusDays(days).toString());
            service.saveInventory(owner, null, body);
        }
        long purchased = PantryService.id(service.saveInventory(owner, null, item("Purchased stock", 3, 1)));
        long list = PantryService.id(service.createList(owner, Map.of("name", "Recovery shopping")));
        var linked = new LinkedHashMap<String, Object>(item("Purchased stock", 2, 1));
        linked.put("inventoryItemId", purchased);
        long bought = PantryService.id(service.addItem(owner, list, linked));
        service.updateItem(owner, list, bought, Map.of("purchased", true));
        service.addItem(owner, list, item("Pending manual item", 1, 1));
        service.purchase(owner, list);
        service.saveInventory(other, null, item("Other account stock", 8, 1));
        service.saveInventory(deleted, null, item("Deleted account stock", 2, 1));
        long deletedList = PantryService.id(service.createList(deleted, Map.of("name", "Deleted account list")));
        service.addItem(deleted, deletedList, item("Deleted account list item", 1, 1));
        String primary = UUID.randomUUID().toString();
        jdbc.update("INSERT INTO spring_session (primary_id,session_id,creation_time,last_access_time,max_inactive_interval,expiry_time,principal_name) VALUES (?,?,0,0,600,?,?)",
            primary, UUID.randomUUID().toString(), clock.millis() + 600_000, Long.toString(owner));
        jdbc.update("INSERT INTO spring_session_attributes VALUES (?,?,?)", primary, "synthetic-drill-marker", new byte[] {1, 2, 3});
        jdbc.update("INSERT INTO email_challenges (email,challenge_id,code_hash,expires_at,used,intent) VALUES (?,?,?,?,FALSE,'login')",
            "owner@example.test", UUID.randomUUID().toString(), "0".repeat(64), clock.millis() + 300_000);
        return new Fixture(owner, other, deleted, low, purchased, list,
            service.inventory(Long.valueOf(owner)), service.list(owner, list), service.suggestions(owner));
    }

    private long account(PantryRepository repository, JdbcTemplate jdbc, String name) {
        long id = repository.insert("accounts", Map.of("email", name + "@example.test", "display_name", name));
        jdbc.update("UPDATE accounts SET session_principal=? WHERE id=?", Long.toString(id), id);
        return id;
    }

    private Map<String, Object> item(String name, double quantity, double threshold) {
        return Map.of("name", name, "category", "Pantry", "quantity", quantity, "unit", "each", "minThreshold", threshold);
    }

    private AnnotationConfigApplicationContext services(DataSource dataSource) {
        var context = new AnnotationConfigApplicationContext();
        context.register(Transactions.class);
        context.registerBean(DataSource.class, () -> dataSource);
        context.registerBean(JdbcTemplate.class, () -> new JdbcTemplate(dataSource));
        context.registerBean(Clock.class, () -> clock);
        context.register(PantryRepository.class, PantryService.class, AccountDeletionService.class);
        context.refresh();
        return context;
    }

    private Map<String, String> fingerprints(JdbcTemplate jdbc) throws Exception {
        var result = new LinkedHashMap<String, String>();
        for (String table : jdbc.queryForList("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename", String.class)) {
            // Names come from a freshly migrated synthetic database, not user input.
            var rows = jdbc.queryForList("SELECT row_to_json(t)::text FROM public.\"" + table + "\" t", String.class)
                .stream().sorted().toList();
            result.put(table, rows.size() + ":" + digest(String.join("\n", rows).getBytes(StandardCharsets.UTF_8)));
        }
        return result;
    }

    private int count(JdbcTemplate jdbc, String table) {
        return jdbc.queryForObject("SELECT COUNT(*) FROM " + table, Integer.class);
    }

    private DriverManagerDataSource dataSource(String database) {
        // Construct directly; ambient Spring/Hikari/Flyway URLs cannot redirect this drill.
        return new DriverManagerDataSource("jdbc:postgresql://127.0.0.1:" + port + "/" + database, user, password);
    }

    private void createDatabase(String database) throws Exception {
        databaseStatement("CREATE DATABASE " + database + " TEMPLATE template0");
    }

    private void databaseStatement(String sql) throws java.sql.SQLException {
        try (var connection = DriverManager.getConnection("jdbc:postgresql://127.0.0.1:" + port + "/pantrypal_auth_test", user, password);
             var statement = connection.createStatement()) { statement.execute(sql); }
    }

    private void command(Path bin, String tool, String database, String... arguments) throws Exception {
        String extension = System.getProperty("os.name").startsWith("Windows") ? ".exe" : "";
        var args = new ArrayList<String>();
        args.add(bin.resolve(tool + extension).toAbsolutePath().toString());
        if (database != null) args.addAll(List.of("--host=127.0.0.1", "--port=" + port,
            "--username=" + user, "--dbname=" + database, "--no-password"));
        args.addAll(List.of(arguments));
        var builder = new ProcessBuilder(args).redirectErrorStream(true);
        builder.environment().keySet().removeIf(key -> key.toUpperCase(java.util.Locale.ROOT).startsWith("PG"));
        builder.environment().put("PGPASSWORD", password);
        builder.environment().put("PGCONNECT_TIMEOUT", "5");
        builder.redirectOutput(output.resolve(tool + (database == null ? "-list" : "") + ".log").toFile());
        var process = builder.start();
        if (!process.waitFor(120, TimeUnit.SECONDS)) {
            process.destroyForcibly().waitFor();
            throw new IllegalStateException(tool + " timed out; inspect the ignored drill log");
        }
        if (process.exitValue() != 0) throw new IllegalStateException(tool + " failed; inspect the ignored drill log");
    }

    private static String required(String name) {
        String value = System.getenv(name);
        if (value == null || value.isBlank()) throw new IllegalStateException(name + " is required for the local backup drill");
        return value;
    }

    private static String digest(byte[] bytes) throws Exception {
        return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
    }

    private static long elapsed(long start) { return Duration.ofNanos(System.nanoTime() - start).toMillis(); }
}
