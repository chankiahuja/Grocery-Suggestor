# PostgreSQL backup and recovery readiness

Tracks [issue #136](https://github.com/chankiahuja/pantry-pal/issues/136). A local synthetic drill is separate from production backup coverage. Do not close the issue until an actual production backup has been restored and validated in an isolated environment.

## Current coverage and release requirements

The checked-in [Render Blueprint](../render.yaml) selects Free PostgreSQL. It does not configure automated backups. Render's [Free-instance documentation](https://render.com/docs/free) says Free PostgreSQL has no managed backups and expires after 30 days. The live database plan and recovery settings still need operator verification.

Recommended production arrangement: paid Render PostgreSQL with its managed point-in-time recovery (PITR). Render documents a recovery window of three days for Hobby workspaces or seven days for Pro and higher, and disallows recovery to the most recent ten minutes. On-demand logical exports have a separate seven-day retention. Verify the actual account's settings and current [recovery documentation](https://render.com/docs/postgresql-backups) before relying on these windows. This recommendation has not changed a plan, created a subscription, configured a backup schedule, or enabled production coverage.

Proposed pilot recovery targets, awaiting owner acceptance and a production-scale rehearsal:

| Decision | Proposed policy | Verification still required |
|---|---|---|
| Recovery point objective (RPO) | At most 15 minutes of committed data lost for a covered incident | Confirm PITR is available at the required recovery point; monitor recovery availability |
| Recovery time objective (RTO) | Restore validated service within two hours of declaring recovery | Include provisioning, operator response, deletion reconciliation, authentication cleanup, validation and cutover |
| Backup retention | Use the verified paid-plan PITR window; record exact oldest/newest recovery points | Retention must cover the expected incident detection delay; choose additional storage if insufficient |
| Optional independent exports | If required, encrypted daily exports with a seven-day lifecycle in a separately controlled private store | Name the store, automation owner, alert destination, encryption/key access, lifecycle and deletion policy before enabling |
| Restore authority | Named primary recovery operator and a named backup operator; no public access | Record actual people/roles and verify least-privilege access to database, backups and recovery credentials |

PITR is the proposed automated production mechanism. Daily exports alone would not meet a 15-minute RPO. A successful tiny local drill does not establish either production target. Record the chosen configuration, backup location/provider, restoration permissions, monitoring and retention evidence before admitting pilot users.

## Repeatable local full-database drill

[PostgresBackupRestoreDrillTest](../backend/src/test/java/com/pantrypal/PostgresBackupRestoreDrillTest.java) is opt-in and creates two unique databases on `127.0.0.1`: `pp_backup_source_<uuid>` and `pp_backup_restored_<uuid>`. It never accepts an existing source or restore target. The local role needs `CREATEDB` and access to the disposable `pantrypal_auth_test` administration database. Use a local test role, never production credentials or a tunnel to a remote database.

The drill constructs its own datasource and does not initialize a Spring Boot application. Ambient `spring.datasource.*`, Hikari and Flyway connection overrides cannot redirect it. It starts only a service-layer context with Spring transactions: no HTTP server, schedulers, SSE subscribers or mail workers. PostgreSQL command-line connection settings are explicit and inherited `PG*` variables are removed from child processes. Credentials are passed in process environment, not command-line arguments.

Requirements: PostgreSQL server/client tools compatible with each other (PostgreSQL 17 for the current local setup), Java 17+ and the Maven wrapper. The recommended PowerShell runner provisions a separate temporary cluster with a generated disposable credential and an automatically selected loopback port, then stops it after the test. It does not change privileges or data in an installed PostgreSQL service. From the repository root:

```powershell
.\scripts\backup-restore-drill.ps1 -PostgresBin 'C:/Program Files/PostgreSQL/17/bin'
```

Cluster files/logs are retained under ignored `backend/target/backup-cluster/<uuid>/` for inspection, with the temporary password file removed. Before invoking any PostgreSQL tool, the runner snapshots and clears all inherited `PG*` process variables (including `PGSSLMODE`, service, host, certificate and authentication settings). It supplies only the disposable connection values needed by the drill, then restores the inherited PostgreSQL and drill variables in `finally`, including after setup or cleanup failure. New PostgreSQL variables introduced during the drill are removed. No persistent environment or installed database settings are changed.

The runner selects `mvnw.cmd` on Windows and invokes `mvnw` through `sh` on other hosts; PostgreSQL tools use the corresponding executable suffix. Run `.\scripts\test-backup-drill-support.ps1` from the repository root for dependency-free checks of both wrapper selections and environment restoration after success/failure. Full runner execution has been verified on Windows only; non-Windows command selection is tested, but an actual non-Windows rehearsal is still unverified. Verify the isolated cluster is stopped before removing its files. This runner uses `initdb` and must run as an ordinary local OS user permitted to start PostgreSQL.

If the drill fails and cluster shutdown also fails, the runner rethrows the original drill error and emits the shutdown error as a non-terminating warning, even with `WarningPreference=Stop`. Shutdown failure alone still fails an otherwise successful runner. Password-file cleanup is a separate cleanup step and is attempted even if the shutdown step throws; the enclosing environment scope restores variables in either case. A shutdown warning means the isolated cluster may still be running: inspect its exact data directory and `pg_ctl` status before manual disposal.

Alternatively, use an already isolated local cluster and a test role with `CREATEDB`. From `backend`, set disposable credentials in the shell, not in tracked files:

```powershell
$env:PANTRYPAL_POSTGRES_BACKUP_DRILL = 'true'
$env:BACKUP_DRILL_USER = '<local test role with CREATEDB>'
$env:BACKUP_DRILL_PASSWORD = '<disposable local password>'
$env:BACKUP_DRILL_PG_BIN = 'C:/Program Files/PostgreSQL/17/bin'
# Optional: BACKUP_DRILL_PORT defaults to 5432; host is always loopback.
try {
    .\mvnw.cmd '-Dtest=PostgresBackupRestoreDrillTest' test
    if ($LASTEXITCODE -ne 0) { throw 'Backup drill failed; inspect its test report and logs' }
} finally {
    Remove-Item Env:PANTRYPAL_POSTGRES_BACKUP_DRILL
    Remove-Item Env:BACKUP_DRILL_USER
    Remove-Item Env:BACKUP_DRILL_PASSWORD
    Remove-Item Env:BACKUP_DRILL_PG_BIN
}
```

The test is skipped in normal test runs. It performs these operations:

1. Create both disposable databases from `template0`; apply the real Flyway migrations to the source.
2. Seed three synthetic accounts, separate ownership, inventory with four alert conditions, purchase completion and pending list items, adjustment history, and synthetic session/challenge rows.
3. Close the service context to quiesce the fixture, export the full database with `pg_dump --format=custom`, and check the archive's table of contents with `pg_restore --list`.
4. Change source stock and delete an account after the export. Keep that deleted account's identifier outside the archive in the test fixture to simulate the required external reconciliation record.
5. Confirm the restore database has no application tables. Restore with `pg_restore --exit-on-error --single-transaction --no-owner --no-acl`. Compare row counts and sorted-row SHA-256 fingerprints for every public table, including Flyway history, before applying recovery cleanup.
6. Validate Flyway checksums and absence of pending migrations. Reconcile the deleted account using the application deletion service, then execute the exact [restored-auth cleanup SQL](../backend/src/main/resources/db/operations/invalidate_restored_auth.sql) twice. Confirm restored sessions, session attributes and challenges are empty.
7. Check surviving account data and ownership, adjustment history, shopping progress, alerts reconstructed by `PantryService`, purchase completion remaining repeat-safe, and identity sequences accepting a new inventory item.
8. Drop only the databases successfully created by this invocation, including after test failure. Cleanup attempts every registered database. If the drill failed, cleanup errors are retained as suppressed exceptions without replacing the primary failure (including assertions); multiple drop errors are retained together. A cleanup failure alone fails an otherwise successful test. The success report is written only after database cleanup succeeds. An abruptly killed JVM can leave these generated databases behind; verify the run's exact names before manually removing anything.

Ignored output lives under `backend/target/backup-drill/<uuid>/`: a synthetic custom-format dump, tool logs, and `result.txt` with timings, size and archive checksum. These files contain only this test's synthetic fixture. They are not a production backup destination and must not be committed. Production exports must use the approved private storage and retention policy instead.

The archive does not include cluster roles or ownership grants (`pg_dump` is a single-database export). Restore permissions and provisioning are separate production checks. This drill checks services and database data, not browser flows, external mail, old-cookie rejection or a newly issued OTP. The separate [authentication restore regression](GS-137-DATA-DELETION.md#restore-regression-database-safety) covers cookie/code behavior; it is not a substitute for this full export/restore.

## Offline deletion reconciliation command

Before serving any restored database, run the recovery-only reconciliation command while every application instance and mail worker is stopped. This command is intentionally not an HTTP endpoint, normal-startup hook, Flyway migration or Render job. It starts the packaged Spring application with no web server, disables automatic Flyway migration, validates the existing schema, applies the deletion service to accounts still present in the restore, skips accounts already absent from the restore, and exits.

The deletion record must be an access-controlled file retained outside the backup snapshot. Create it as UTF-8 tab-separated text with this exact header and one record per line:

```text
account_id	deleted_at	backup_id
123	2026-11-10T12:01:00Z	prod-2026-11-10T12:00Z
```

Use stable account IDs only; do not put email addresses, session values, OTPs or pantry data in the file. Every record must reference the selected backup ID and have a deletion timestamp strictly after the selected snapshot time. Duplicate account IDs are rejected before any deletion begins. Keep the source file access-controlled until its retention period has ended.

If the authoritative deletion record confirms that no account was deleted after the snapshot, the file may contain only the header. In that case, add `--recovery.confirm-zero-deletions=true` to the command. The flag is accepted only for an otherwise valid header-only file and is an operator attestation based on the independent completeness check; it is not evidence that the file itself is complete. Omitting the flag keeps an empty record file invalid.

Build the normal backend artifact, set `DB_URL`, `DB_USER` and `DB_PASSWORD` to the isolated restored PostgreSQL target, then run from the repository root. The database must already be restored and schema-compatible; the command never runs pending migrations:

```powershell
java -jar backend/target/pantrypal-api-0.1.0.jar `
  --recovery.reconcile=true `
  --recovery.confirm-isolated=true `
  --recovery.deletions-file='C:/secure/recovery/deletions.tsv' `
  --recovery.snapshot-at='2026-11-10T12:00:00Z' `
  --recovery.backup-id='prod-2026-11-10T12:00Z' `
  --spring.profiles.active=postgres `
  --spring.flyway.enabled=false
```

The command validates Flyway against the target without changing it. For each supplied and validated record, `AccountDeletionService.delete` removes the account-owned data transactionally. If the account ID is missing from the restore, the result is `already_absent` and no deletion call is attempted; this is expected for an account created and deleted after the snapshot. A successful run prints counts for `deleted` and `already_absent` and exits. The command validates the supplied file's structure, scope and timestamps; it cannot detect a deletion row omitted from that file. Before running it, the recovery operator must compare the file against the authoritative deletion record and document that completeness check. Any malformed, duplicated, out-of-scope or schema-invalid input, or any deletion failure, must stop recovery; keep traffic disabled and resolve the failure before retrying.

After the independent completeness check and command both succeed, run the [restored-auth cleanup](GS-137-DATA-DELETION.md#restore-procedure--invalidate-authentication-before-serving-traffic), verify the restored sessions, session attributes and email challenges are empty, and retain a sanitized recovery report with the backup ID, snapshot time, completeness-check reference, counts, result and operator/time. Do not reopen traffic until completeness, reconciliation and authentication cleanup all pass.

The local PostgreSQL drill validates the same present-account deletion and absent-account skip behavior with synthetic data. It does not create the production deletion record or prove that a production operator has access to a complete record.

## Production recovery procedure

1. Declare the incident and record the start time, incident owner and acceptable recovery point. Stop all application instances and mail workers; keep user traffic, production writes and outbound mail disabled.
2. Verify backup identity, age, integrity and selected recovery point. Record expected data loss. Render PITR creates a separate recovered database; it does not replace the original database. Preserve the original production database for the approved rollback period. Never overwrite it, use staging as a recovery target, or point production at staging. Match PostgreSQL/client versions and restore required roles/permissions separately.
3. Keep Blueprint Auto Sync disabled throughout recovery. Do not push a recovery change to `main` or perform a Blueprint sync while the target is being validated. If dashboard-only changes are needed to `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER` or `DB_PASSWORD`, treat them as temporary incident controls: the next Blueprint sync can overwrite them.
4. Validate schema/Flyway compatibility using the application version intended for recovery. Resolve migration/version mismatches before admitting traffic. Compare representative account, inventory, adjustment, shopping and alert data using an approved validation fixture; avoid copying real user data into logs or public reports.
5. Run the [offline deletion reconciliation command](#offline-deletion-reconciliation-command) using the approved record outside the restored snapshot, then apply the [account deletion and authentication recovery procedure](GS-137-DATA-DELETION.md#restore-procedure--invalidate-authentication-before-serving-traffic). If the record is missing or incomplete, or either operation fails, do not reopen the restored data.
6. Start fresh application processes against the verified recovered target with outbound mail restricted to the test transport. Verify revoked cookies and used codes fail, fresh sign-in succeeds, ownership holds, shopping state is correct, repeated purchase completion does not restock twice, and inventory-derived alerts agree with the recovery point. Alerts are reconstructed; SSE connections and browser notification markers are not backed up by PostgreSQL.
7. Before reopening production traffic, update `render.production.yaml` through a reviewed recovery commit. Replace every affected `fromDatabase` reference and update the `databases` resource definition so they identify the recovered database. Include the recovered database's complete current configuration in that definition, including its name, database name, user, plan, disk size, storage autoscaling setting, region, IP allowlist, PostgreSQL version and any other active recovery-relevant settings. In the same incident-specific recovery commit, temporarily configure `MAIL_HOST`, `MAIL_PORT`, `MAIL_SMTP_AUTH` and `MAIL_STARTTLS` for the approved test SMTP transport. Render Manual Sync does not update existing variables marked `sync: false`: obtain the approved test values from the protected source and explicitly replace `MAIL_USERNAME`, `MAIL_PASSWORD` and `MAIL_FROM` in Render. Keep those test credentials and sender values protected with `sync: false`; never record secret values in Git, documentation, issues, previews or logs. Use only controlled test accounts and inboxes. Do not change the normal-deployment Brevo values now; the recovered database and test transport are known only during an incident.
8. Review the resulting Blueprint preview. Confirm it will not recreate or reconnect the original database, remove the recovered database, or alter the intended production service unexpectedly, and confirm it will not restore production Brevo delivery. With Auto Sync still disabled, perform only the approved Manual Sync. Inspect the effective mail configuration after the sync and send a canary message to the controlled test inbox. Keep real-user outbound mail blocked throughout recovery and repeat authentication checks only after the canary succeeds. Verify the service still connects to the recovered database after the sync, then repeat health, authentication, reconciliation, backup-evidence and smoke checks.
9. Record provisioning, restore, reconciliation, validation, Blueprint review/sync and total recovery time, missing post-backup writes, cleanup results and any gaps. Compare the measured totals with the accepted RPO/RTO. A production restore drill must stay isolated; actual incident cutover requires the reviewed recovery commit, target adoption and routing change.
10. After recovery approval, restore production Brevo configuration only through a separate reviewed commit and approved Manual Sync, with Auto Sync still disabled. Explicitly restore the protected production values for `MAIL_USERNAME`, `MAIL_PASSWORD` and `MAIL_FROM` from the approved secret source; do not assume Manual Sync restores them. Verify the effective Brevo host, port, authentication and TLS configuration, then verify OTP/sign-in and support-mail delivery using controlled recipients. Keep real-user mail and pilot traffic blocked until these checks pass and the recovery owner approves reopening them. Never record secret values in Git, documentation, issues, previews or logs.
11. Dispose of only temporary recovery environments and exports according to the configured retention/access policy after the approved rollback period. Preserve the original database throughout that period and retain a sanitized recovery report without credentials, session values, OTPs or user pantry data.

The deletion reconciliation record is a production prerequisite, not implemented by the local fixture. Establish an access-controlled record outside database snapshots containing the minimum stable account identifier, deletion time and backup scope needed for reconciliation. Assign an owner, define how completeness is checked, and retain entries until all backups/exports that could contain that account have expired or been disposed of. Specify retention and disposal for that record before collecting it; do not silently retain deleted accounts in the app database or call the in-memory test fixture a durable audit system.

## Completion evidence

Verified locally on 10 November 2026, branch `GS-136`, using PostgreSQL and client tools **17.11**:

| Check | Result |
|---|---|
| `.\scripts\backup-restore-drill.ps1 -PostgresBin 'C:/Program Files/PostgreSQL/17/bin'` | One full-database drill passed |
| Whole-database comparison | All 10 public tables matched row counts and SHA-256 row fingerprints before cleanup |
| Flyway | All seven migrations restored and validated; none pending |
| Application data | Account ownership, inventory, adjustment history, purchased/pending shopping items, repeat-safe purchase completion and identity sequence verified |
| Alerts | Critical, low-stock, upcoming-expiry and expired suggestions reconstructed from restored inventory |
| Recovery cleanup | Post-backup account deletion reconciled; sessions/attributes/challenges cleared; SQL safe to repeat |
| Export | 915 ms; custom-format archive 25,947 bytes |
| Restore into empty database | 469 ms |
| Validation and recovery cleanup | 7,214 ms |
| Core drill duration | 43,726 ms, including database creation, migration, seeding and source-after-backup controls; excluding Maven/cluster provisioning and final database disposal |
| Disposal | Both generated databases dropped; separate PostgreSQL cluster stopped; temporary password file removed |

Archive SHA-256: `25736e542cdeed8567465ce5f9bcc4ea70e13cc5a9ab696d689f152757779039`. This identifies only the synthetic rehearsal archive retained in ignored local output.

Additional focused check from `backend`: `.\mvnw.cmd '-Dtest=PostgresBackupRestoreDrillTest,RestoreAuthDatabaseGuardTest,RestoredAuthenticationTest' test` without the drill opt-in: **13 passed, one expected skip**. This verifies the database-creating drill stays disabled in ordinary runs while the Hikari guard and HTTP/session/OTP restore regression still pass on H2. The H2 result does not replace the PostgreSQL full-database result above. PowerShell syntax validation and `git diff --check` also passed. No frontend checks were needed because application/UI behavior did not change.

Cleanup failure follow-up on 10 November 2026: `.\mvnw.cmd '-Dtest=DrillDatabaseCleanupTest' test` passed **five checks** without database access. These verify preservation of an assertion or checked failure, retention of multiple cleanup errors, failure on cleanup alone, and attempts limited to registered databases. The temporary-cluster runner was rerun with the revised try-with-resources cleanup: **one full PostgreSQL 17.11 drill passed**, both generated databases were dropped, and the temporary cluster stopped. All 10 tables matched before recovery cleanup and all seven migrations validated. The drill now writes its success report only after database disposal succeeds. No PMD scan was run; there is no longer an explicit throw from the drill's `finally` block.

Runner follow-up on 10 November 2026: `.\scripts\test-backup-drill-support.ps1` passed Windows/non-Windows Maven command-selection checks and environment restoration after both a successful action and a simulated setup failure. The full temporary-cluster runner also passed on Windows with inherited `PGSSLMODE=require`, an unusable synthetic `PGSERVICE`, a non-local `PGHOSTADDR`, and an additional unlisted `PG*` sentinel. The invocation verified all four original values were restored afterward. PostgreSQL 17.11 restored all 10 tables, validated seven migrations, dropped both generated databases and stopped the cluster. Non-Windows execution remains unverified beyond command selection. The sandbox initially disallowed PowerShell script execution; focused checks passed outside it without changing the machine execution policy.

Cluster shutdown failure follow-up on 10 November 2026: the same PowerShell check script passed all four combinations of simulated Maven success/failure and shutdown success/failure with `WarningPreference=Stop`. It checks that a combined failure preserves the original exception object and emits a cleanup warning, that shutdown-only failure remains fatal, and that password-file removal and environment restoration occur in every combination. No real cluster was deliberately left running to simulate a stop failure. The full temporary-cluster runner then passed one PostgreSQL 17.11 drill with normal shutdown; all 10 tables matched, seven migrations validated, both generated databases were dropped and the cluster stopped. Editor diagnostics and `git diff --check` passed. No Java or frontend behavior changed.

The installed `pantrypal` role initially lacked `CREATEDB`, so the direct test invocation stopped before creating any drill database. No privileges were changed; the successful run used the separate-cluster runner above. An initial harness compilation error from a Java inventory overload was corrected before the successful drill.

The seven-unit stock change made after the export is intentionally absent from recovery: the backup represents its earlier recovery point. The deleted account is initially present in the raw restore and is removed using the separately retained test identifier. No other missing fixture data was found. This demonstrates why post-backup deletion reconciliation is required; it does not implement the production record.

Production automation, actual retention/access settings, accepted recovery targets, a durable deletion reconciliation process and a restore of an actual production backup remain open until verified. No production data was overwritten by the local drill.
