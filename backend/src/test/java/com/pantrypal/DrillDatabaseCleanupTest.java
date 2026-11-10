package com.pantrypal;

import java.io.IOException;
import java.sql.SQLException;
import java.util.ArrayList;
import org.junit.jupiter.api.Test;
import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertSame;

class DrillDatabaseCleanupTest {
    @Test void assertionRemainsPrimaryAndBothCleanupFailuresAreRetained() {
        var primary = new AssertionError("restore comparison failed");
        var first = new SQLException("source drop failed");
        var second = new SQLException("target drop failed");
        var attempted = new ArrayList<String>();
        var thrown = assertThrows(AssertionError.class, () -> {
            try (var cleanup = new DrillDatabaseCleanup(database -> {
                attempted.add(database);
                throw database.equals("source") ? first : second;
            })) {
                cleanup.created("source"); cleanup.created("target");
                throw primary;
            }
        });
        assertSame(primary, thrown);
        assertThat(thrown.getSuppressed()).containsExactly(first);
        assertThat(first.getSuppressed()).containsExactly(second);
        assertThat(attempted).containsExactly("source", "target");
    }

    @Test void checkedToolFailureRemainsPrimaryWhenCleanupFails() {
        var primary = new IOException("pg_dump failed");
        var dropFailure = new SQLException("drop failed");
        var thrown = assertThrows(IOException.class, () -> {
            try (var cleanup = new DrillDatabaseCleanup(database -> { throw dropFailure; })) {
                cleanup.created("source");
                throw primary;
            }
        });
        assertSame(primary, thrown);
        assertThat(thrown.getSuppressed()).containsExactly(dropFailure);
    }

    @Test void cleanupAloneFailsAnOtherwiseSuccessfulDrillAndAttemptsEveryDatabase() {
        var first = new SQLException("source drop failed");
        var second = new SQLException("target drop failed");
        var attempted = new ArrayList<String>();
        var thrown = assertThrows(SQLException.class, () -> {
            try (var cleanup = new DrillDatabaseCleanup(database -> {
                attempted.add(database);
                throw database.equals("source") ? first : second;
            })) {
                cleanup.created("source"); cleanup.created("target");
            }
        });
        assertSame(first, thrown);
        assertThat(thrown.getSuppressed()).containsExactly(second);
        assertThat(attempted).containsExactly("source", "target");
    }

    @Test void successfulCleanupDoesNotReplaceAPrimaryFailure() {
        var primary = new IllegalStateException("pg_restore failed");
        var attempted = new ArrayList<String>();
        var thrown = assertThrows(IllegalStateException.class, () -> {
            try (var cleanup = new DrillDatabaseCleanup(attempted::add)) {
                cleanup.created("source");
                throw primary;
            }
        });
        assertSame(primary, thrown);
        assertThat(thrown.getSuppressed()).isEmpty();
        assertThat(attempted).containsExactly("source");
    }

    @Test void successfulCleanupOnlyTouchesRegisteredDatabases() throws Exception {
        var attempted = new ArrayList<String>();
        try (var cleanup = new DrillDatabaseCleanup(attempted::add)) {
            cleanup.created("source");
            // A target whose creation failed would not be registered.
        }
        assertThat(attempted).containsExactly("source");
        try (var cleanup = new DrillDatabaseCleanup(attempted::add)) { /* Nothing was created. */ }
        assertThat(attempted).containsExactly("source");
    }
}
