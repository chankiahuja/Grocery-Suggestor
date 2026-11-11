package com.pantrypal;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import org.springframework.dao.EmptyResultDataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;

/** Offline, one-shot reconciliation of account deletions after a database snapshot. */
final class RecoveryReconciliation {
    static final String HEADER = "account_id\tdeleted_at\tbackup_id";

    record DeletionRecord(long accountId, Instant deletedAt, String backupId) {}
    record Outcome(long accountId, String status) {}

    private RecoveryReconciliation() {}

    static List<DeletionRecord> read(Path file) throws IOException {
        var lines = Files.readAllLines(file, StandardCharsets.UTF_8);
        if (lines.isEmpty() || !HEADER.equals(stripBom(lines.get(0))))
            throw new IllegalArgumentException("Deletion record file must start with: " + HEADER);
        var records = new ArrayList<DeletionRecord>();
        for (int lineNumber = 1; lineNumber < lines.size(); lineNumber++) {
            String line = lines.get(lineNumber).trim();
            if (line.isEmpty()) continue;
            String[] fields = line.split("\\t", -1);
            if (fields.length != 3)
                throw new IllegalArgumentException("Line " + (lineNumber + 1) + " must contain three tab-separated fields");
            long accountId;
            Instant deletedAt;
            try {
                accountId = Long.parseLong(fields[0].trim());
                deletedAt = Instant.parse(fields[1].trim());
            } catch (NumberFormatException | DateTimeParseException ex) {
                throw new IllegalArgumentException("Line " + (lineNumber + 1) + " has an invalid account ID or timestamp", ex);
            }
            String backupId = fields[2].trim();
            if (accountId <= 0 || backupId.isBlank())
                throw new IllegalArgumentException("Line " + (lineNumber + 1) + " has an invalid account ID or backup ID");
            records.add(new DeletionRecord(accountId, deletedAt, backupId));
        }
        return List.copyOf(records);
    }

    static void validate(List<DeletionRecord> records, Instant snapshotAt, String backupId) {
        if (records.isEmpty()) throw new IllegalArgumentException("Deletion record file contains no records");
        if (snapshotAt == null || backupId == null || backupId.isBlank())
            throw new IllegalArgumentException("Snapshot time and backup ID are required");
        Set<Long> seen = new HashSet<>();
        for (DeletionRecord record : records) {
            if (!backupId.equals(record.backupId()))
                throw new IllegalArgumentException("Deletion record references a different backup ID");
            if (!record.deletedAt().isAfter(snapshotAt))
                throw new IllegalArgumentException("Deletion record is not after the selected snapshot");
            if (!seen.add(record.accountId()))
                throw new IllegalArgumentException("Deletion record contains a duplicate account ID");
        }
    }

    static List<Outcome> reconcile(
            List<DeletionRecord> records, JdbcTemplate jdbc, AccountDeletionService deletion) {
        var outcomes = new ArrayList<Outcome>();
        for (DeletionRecord record : records) {
            boolean present;
            try {
                jdbc.queryForObject("SELECT id FROM accounts WHERE id=?", Long.class, record.accountId());
                present = true;
            } catch (EmptyResultDataAccessException absent) {
                present = false;
            }
            if (!present) {
                outcomes.add(new Outcome(record.accountId(), "already_absent"));
                continue;
            }
            deletion.delete(record.accountId());
            outcomes.add(new Outcome(record.accountId(), "deleted"));
        }
        return List.copyOf(outcomes);
    }

    private static String stripBom(String value) {
        return value.startsWith("\uFEFF") ? value.substring(1) : value;
    }
}
