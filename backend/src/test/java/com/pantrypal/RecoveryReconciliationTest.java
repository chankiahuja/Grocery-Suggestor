package com.pantrypal;

import java.nio.file.Files;
import java.time.Instant;
import java.util.List;
import org.flywaydb.core.api.MigrationInfo;
import org.flywaydb.core.api.MigrationState;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;
import org.springframework.dao.EmptyResultDataAccessException;

class RecoveryReconciliationTest {
    private static final Instant SNAPSHOT = Instant.parse("2026-11-10T12:00:00Z");

    @Test void readsAndValidatesScopedPostSnapshotRecords() throws Exception {
        var file = Files.createTempFile("recovery-deletions", ".tsv");
        Files.writeString(file, RecoveryReconciliation.HEADER + "\n42\t2026-11-10T12:01:00Z\tbackup-1\n");
        var records = RecoveryReconciliation.read(file);
        RecoveryReconciliation.validate(records, SNAPSHOT, "backup-1");
        assertThat(records).containsExactly(new RecoveryReconciliation.DeletionRecord(
            42, Instant.parse("2026-11-10T12:01:00Z"), "backup-1"));
        Files.deleteIfExists(file);
    }

    @Test void rejectsRowsWithAnExtraTrailingTab() throws Exception {
        var file = Files.createTempFile("recovery-deletions", ".tsv");
        Files.writeString(file, RecoveryReconciliation.HEADER + "\n42\t2026-11-10T12:01:00Z\tbackup-1\t\n");
        assertThatThrownBy(() -> RecoveryReconciliation.read(file))
            .isInstanceOf(IllegalArgumentException.class).hasMessageContaining("three tab-separated fields");
        Files.deleteIfExists(file);
    }

    @Test void rejectsFutureFlywayMigrationsBeforeReconciliation() {
        var future = mock(MigrationInfo.class);
        when(future.getState()).thenReturn(MigrationState.FUTURE_SUCCESS);
        when(future.getVersion()).thenReturn(null);

        assertThatThrownBy(() -> RecoveryReconciliation.rejectFutureMigrations(new MigrationInfo[] {future}))
            .isInstanceOf(IllegalStateException.class)
            .hasMessageContaining("future Flyway migration");
    }

    @Test void rejectsDuplicateOrOutOfScopeRecordsBeforeMutation() {
        var record = new RecoveryReconciliation.DeletionRecord(42, SNAPSHOT.plusSeconds(1), "backup-1");
        assertThatThrownBy(() -> RecoveryReconciliation.validate(List.of(record, record), SNAPSHOT, "backup-1"))
            .isInstanceOf(IllegalArgumentException.class).hasMessageContaining("duplicate");
        assertThatThrownBy(() -> RecoveryReconciliation.validate(List.of(record), SNAPSHOT, "backup-2"))
            .isInstanceOf(IllegalArgumentException.class).hasMessageContaining("different backup");
        assertThatThrownBy(() -> RecoveryReconciliation.validate(
            List.of(new RecoveryReconciliation.DeletionRecord(42, SNAPSHOT, "backup-1")), SNAPSHOT, "backup-1"))
            .isInstanceOf(IllegalArgumentException.class).hasMessageContaining("not after");
    }

    @Test void acceptsHeaderOnlyFileOnlyWithExplicitZeroDeletionConfirmation() {
        assertThatThrownBy(() -> RecoveryReconciliation.validate(List.of(), SNAPSHOT, "backup-1"))
            .isInstanceOf(IllegalArgumentException.class).hasMessageContaining("zero-deletion confirmation");
        RecoveryReconciliation.validate(List.of(), SNAPSHOT, "backup-1", true);
    }

    @Test void rejectsZeroDeletionConfirmationWhenRecordsExist() {
        var record = new RecoveryReconciliation.DeletionRecord(42, SNAPSHOT.plusSeconds(1), "backup-1");
        assertThatThrownBy(() -> RecoveryReconciliation.validate(List.of(record), SNAPSHOT, "backup-1", true))
            .isInstanceOf(IllegalArgumentException.class).hasMessageContaining("only for a header-only");
    }

    @Test void deletesPresentAccountAndSkipsAbsentAccount() {
        var jdbc = mock(JdbcTemplate.class);
        var deletion = mock(AccountDeletionService.class);
        var present = new RecoveryReconciliation.DeletionRecord(42, SNAPSHOT.plusSeconds(1), "backup-1");
        var absent = new RecoveryReconciliation.DeletionRecord(43, SNAPSHOT.plusSeconds(2), "backup-1");
        when(jdbc.queryForObject(anyString(), eq(Long.class), anyLong()))
            .thenReturn(42L).thenThrow(new EmptyResultDataAccessException(1));

        var outcomes = RecoveryReconciliation.reconcile(List.of(present, absent), jdbc, deletion);

        assertThat(outcomes).extracting(RecoveryReconciliation.Outcome::status)
            .containsExactly("deleted", "already_absent");
        verify(deletion).delete(42);
        verify(deletion, never()).delete(43);
    }
}
