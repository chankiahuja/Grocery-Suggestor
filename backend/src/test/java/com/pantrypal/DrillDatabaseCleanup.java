package com.pantrypal;

import java.sql.SQLException;
import java.util.ArrayList;
import java.util.List;

/** Try-with-resources preserves the drill's primary exception, including AssertionError. */
final class DrillDatabaseCleanup implements AutoCloseable {
    @FunctionalInterface
    interface DropDatabase { void drop(String database) throws SQLException; }

    private final DropDatabase drop;
    private final List<String> created = new ArrayList<>();

    DrillDatabaseCleanup(DropDatabase drop) { this.drop = drop; }

    void created(String database) { created.add(database); }

    @Override public void close() throws SQLException {
        SQLException firstFailure = null;
        for (String database : created) {
            try { drop.drop(database); }
            catch (SQLException failure) {
                if (firstFailure == null) firstFailure = failure;
                else firstFailure.addSuppressed(failure);
            }
        }
        if (firstFailure != null) throw firstFailure;
    }
}
