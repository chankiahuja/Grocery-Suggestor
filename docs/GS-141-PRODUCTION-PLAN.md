# GS-141 production preparation plan

Status: preparation only. This document and [`render.production.yaml`](../render.production.yaml) do not provision resources, sync Render, enter secrets, or change DNS.

## Decisions and boundaries

- Production hostname: `mypantrypal.in`.
- Production gets its own Render Blueprint, web service, and PostgreSQL database.
- Production web and database resources are planned for Render's `singapore` region; staging remains in Oregon.
- The existing staging Blueprint and resources remain unchanged.
- Staging continues to use `GS-134` and production will use `main`.
- `autoDeployTrigger: off` disables service auto-deploys; separately, Blueprint Auto Sync must be set to **No** after provisioning and remain disabled.
- Do not provision until the release has been updated and reviewed on `main`.

The production Blueprint is intentionally separate from [`render.yaml`](../render.yaml). Create a new Render Blueprint using [`render.production.yaml`](../render.production.yaml); do not change or sync the staging Blueprint to create production.

## Current pilot plans and cost estimate

The following estimate uses Render's current plan IDs and pricing checked on 2026-11-11. Confirm the dashboard preview and current pricing immediately before provisioning.

| Resource | Proposed name | Region | Plan ID | Expected cost |
| --- | --- | --- | --- | ---: |
| Docker web service | `pantrypal-production` | Singapore | `0.5c-512mb` | about $7/month |
| Render Postgres | `pantrypal-production-db` | Singapore | `0.1c-256mb`, 1 GB disk | about $6/month |
| Render Postgres storage | `pantrypal-production-db` | Singapore | required 1 GB allocation | about $0.30/month |
| Hobby workspace | existing workspace | n/a | `Hobby` | $0/month |
| **Minimum pilot estimate** |  |  |  | **about $13.30/month** |

The web plan is the current 0.5 CPU/512 MB paid pilot size. The database plan is the current 0.1 CPU/256 MB size with `diskSizeGB: 1`, explicitly selecting the 1 GB storage allowance instead of the 15 GB default allocation for this plan. The minimum estimate is about $13.30/month: $7 web compute, $6 database compute, and $0.30 for the required 1 GB database storage. Additional Postgres storage, bandwidth beyond the workspace allowance, build minutes beyond the allowance, and extra custom domains can add usage charges. Compute is billed while the resources are active and is prorated by the second; the billing trigger is provisioning or activating these paid resources, not this file, branch, or documentation.

Render's legacy labels may show the web plan as Starter and the database plan as Basic-256mb. The Blueprint uses the current IDs: `0.5c-512mb` and `0.1c-256mb`.

References: [Render pricing](https://render.com/pricing), [compute plans](https://render.com/docs/compute-plans), and [Blueprint YAML reference](https://render.com/docs/blueprint-spec).

## Backup expectations

The planned paid Hobby PostgreSQL database has a three-day point-in-time recovery (PITR) window. PITR cannot restore the approximately latest 10 minutes of changes, so it is not a substitute for a current logical export or a tested restore procedure. Retain logical exports for seven days and record the export timestamp and verification result.

The actual production backup configuration, export schedule, retention implementation, and restore validation remain under [#136](https://github.com/chankiahuja/pantry-pal/issues/136). Do not treat this preparation Blueprint or its cost estimate as evidence that production backups or restores have been configured or tested.

## Database storage capacity control

The production database intentionally starts at `diskSizeGB: 1` with `storageAutoscalingEnabled: false`. This keeps the paid pilot's initial allocation and billing predictable; enabling autoscaling would permanently grow the disk when usage reaches roughly 90%, with a 1 GB disk growing to 5 GB and adding storage charges. Storage can grow but cannot be reduced in place.

Before provisioning, assign an operator and record the initial database storage reading. During the first 30 days, the operator must check the production database's **Metrics/Storage** graph once every day and record the reading. After 30 days, continue daily checks while the measured seven-day growth is at least 1% of the allocation per week; otherwise, a weekly check is sufficient. Resume daily checks after any release, import, restore, or other operation expected to increase storage materially.

Calculate the forecast to 80% from the recorded readings: `(80% of allocated storage - current usage) / average daily growth`. If the forecast is 14 days or less, treat it as an urgent capacity alert and increase storage before the forecast date. Render email or Slack notifications may be configured as supplemental signals where the dashboard exposes them, but the runbook must not treat Render's documented persistent-disk notification as a tested Postgres-storage alert. Record the check schedule, readings, growth calculation, and any notification test in the production readiness evidence.

Treat the following thresholds as operational alerts:

- At **70%** usage, review growth, remove unnecessary data or indexes where safe, and schedule a manual disk increase before the next growth review.
- At **80%** usage, treat the alert as urgent: stop nonessential writes, confirm the backup is current, and increase the database disk in Render to the next supported size (normally 5 GB). Record the new allocation and expected charge before approving the change.
- Never wait for the 90% autoscaling threshold or the hard limit. A database that exceeds its allocation can become unhealthy and be suspended, causing application connection failures.

If the database is suspended, pause writes first, resume it in Render, increase storage immediately, and then validate database health, application connectivity, migrations, authentication, and a minimal pantry flow. Record the incident and update the growth estimate. This is an operator-controlled capacity plan; it is not proof that the 1 GB allocation is sufficient and it does not authorize provisioning or a paid storage increase from this preparation branch.

## Blueprint Auto Sync control

`autoDeployTrigger: off` controls automatic deploys for the web service. It does not control Render Blueprint Auto Sync. Render Blueprint Auto Sync is a separate dashboard setting and is enabled by default for a new Blueprint.

After the initial production Blueprint is deployed, immediately open its **Settings** page and set **Auto Sync** to **No**. Verify the setting after provisioning and before every production change. Keep it disabled for the life of the pilot. Review the complete sync preview, confirm that it contains only the intended production changes, and use **Manual Sync** for each approved synchronization. A push to `main` must not be allowed to apply Blueprint changes without that review.

This control is intentionally operational rather than encoded in `render.production.yaml`: Render manages Blueprint Auto Sync in the Blueprint dashboard, while the YAML `autoDeployTrigger: off` field controls service deploy behavior. See [Render Blueprint Auto Sync guidance](https://render.com/docs/infrastructure-as-code#disabling-automatic-sync).

## Protected environment-variable checklist

No secret values belong in this repository, issue comments, Blueprint previews, or build logs. The Blueprint marks secret inputs with `sync: false`; enter them only in Render during the reviewed creation flow or through the approved secret manager.

| Variable | Source/check | Blueprint treatment |
| --- | --- | --- |
| `AUTH_OTP_SECRET` | Render-generated or approved secret-manager value; at least 32 bytes | `sync: false` |
| `MAIL_USERNAME` | Brevo SMTP username/API credential chosen for production | `sync: false` |
| `MAIL_PASSWORD` | Brevo SMTP password/API credential | `sync: false` |
| `MAIL_FROM` | Verified sender identity for `mypantrypal.in` | `sync: false` |
| `PANTRYPAL_SUPPORT_EMAIL` | Approved support mailbox, currently planned as `support@mypantrypal.in` | `sync: false` |
| `DB_PASSWORD` | Render-managed password from the production database | `fromDatabase` |
| `SPRING_PROFILES_ACTIVE` | Must be `production` | fixed value |
| `AUTH_COOKIE_SECURE` | Must be `true` behind Render TLS | fixed value |
| `PANTRYPAL_SMTP_REQUIRED` | Must be `true` for production | fixed value |
| `MAIL_HOST` | Brevo SMTP endpoint `smtp-relay.brevo.com` | fixed value |
| `MAIL_PORT` | Brevo submission port `587` | fixed value |
| `MAIL_SMTP_AUTH` / `MAIL_STARTTLS` | Required for authenticated Brevo delivery | fixed `true` values |

Before provisioning, confirm the sender, support mailbox, Brevo account, database connection references, and `AUTH_OTP_SECRET` policy. Do not use staging credentials or a local `.env` value for production.

## BigRock DNS and Render TLS

Do not make these changes during preparation. Apply them only after the production service is provisioned, its Render hostname is known, and the cutover review is approved.

1. In Render, add `mypantrypal.in` to the **Custom Domains** section of `pantrypal-production`. Record the generated `onrender.com` hostname and the verification state.
2. Before removing or changing anything, export or transcribe the current BigRock web DNS records into the cutover checklist. For every affected record, capture the exact name/host, record type, value/target, and TTL. Include the current apex, `www`, redirect, `A`, `CNAME`, and `AAAA` records as applicable. Preserve this snapshot with the rollback evidence; do not rely on DNS history or memory.

   | Name/host | Type | Current value/target | TTL | Change made |
   | --- | --- | --- | --- | --- |
   | `@` |  |  |  |  |
   | `www` |  |  |  |  |

3. In BigRock DNS management, preserve all existing Titan and Brevo records. Do not change nameservers.
4. Remove only conflicting web-host records for the selected hostname, and remove `AAAA` records for the domain while configuring Render; Render currently uses IPv4.
5. For the apex `@`, use the Render-recommended root-domain record. If BigRock supports `ANAME`/`ALIAS` or CNAME flattening, point it to the production `onrender.com` hostname. Otherwise use Render's documented load-balancer `A` record `216.24.57.1`.
6. For `www`, add a `CNAME` to the production `onrender.com` hostname if `www` is retained. Confirm the desired redirect direction before applying it; adding an apex domain in Render normally creates the corresponding `www` redirect.
7. Return to Render and click **Verify** after DNS propagation. Render automatically issues and renews the TLS certificate. Confirm `https://mypantrypal.in` works, HTTP redirects to HTTPS, and `https://mypantrypal.in/api/healthz` returns the expected health response.

Preserve the existing Titan MX records and all Brevo SPF/DKIM/DMARC authentication records. The web-domain cutover must not change mail routing or email authentication.

References: [Render custom domains](https://render.com/docs/custom-domains) and [Render DNS guidance](https://render.com/docs/configure-other-dns).

## Provisioning and validation sequence

1. Update `main` to the reviewed release that production is meant to run. Verify the release commit, migrations, security settings, SMTP configuration, health endpoint, and rollback artifact before provisioning.
2. In Render, choose the production repository, branch `main`, and Blueprint file [`render.production.yaml`](../render.production.yaml). Confirm the names are new, both production resources use Singapore, the production database has `diskSizeGB: 1`, `storageAutoscalingEnabled: false`, and `ipAllowList: []`, the plans are the intended paid pilot sizes, `autoDeployTrigger` is `off`, and the staging Blueprint remains untouched.
3. Review Render's complete Blueprint preview and cost confirmation. Stop if the preview proposes changing `pantrypal-staging`, using `GS-134` for production, creating an unexpected resource, or charging a different amount from the approved estimate.
4. Obtain explicit approval for the preview and the minimum estimated cost of about $13.30/month plus excess usage.
5. Click **Deploy Blueprint**. This action starts paid resource provisioning. Do not treat the file, branch, or preview review as provisioning approval.
6. Immediately after deployment starts, open the production Blueprint **Settings** page and set **Auto Sync** to **No**. Verify the setting after provisioning. Enter the protected secret values through Render; never commit them.
7. Validate the deployment on its Render hostname before DNS cutover: `/api/healthz`, HTTPS redirect, secure cookies, email OTP delivery through Brevo, support-mail delivery, database migrations, and a minimal authenticated pantry flow.
8. Apply the approved BigRock DNS changes and Render domain verification. Re-run the health, authentication, and support-mail checks on `mypantrypal.in`.
9. Keep staging at its existing URL and `GS-134`; do not repoint staging or use it as the production hostname.

## Cutover and rollback

### Cutover

- Freeze the production release commit on `main` and record it.
- Confirm the production service is healthy on its Render hostname and the database backup/restore plan is available.
- Save the pre-cutover BigRock DNS snapshot, including each affected record's name, type, value/target, and TTL, with the cutover evidence before changing DNS.
- Put the approved DNS records in BigRock, verify Render TLS, and test the apex and `www` behavior.
- Run the smoke checks again on `mypantrypal.in` and monitor logs, health checks, login delivery, and support delivery.
- Leave Blueprint Auto Sync set to **No** and the staging service and URL unchanged for comparison and fallback.

### Rollback

- If the application release is faulty, use the Render service's reviewed prior deploy/rollback artifact, then re-run health and authentication checks.
- If the domain cutover is faulty, restore the previously recorded BigRock web records only; do not alter Titan MX or Brevo authentication records.
- If the database is faulty, stop writes, preserve the incident evidence, and follow the approved backup/restore and reconciliation procedure in [GS-136](GS-136-BACKUP-RESTORE.md). Do not point production at the staging database.
- Keep staging available while production is repaired. Do not delete or repurpose production resources during an incident without a separate review.

No paid provisioning, Blueprint sync, secret entry, deploy, or DNS change is authorized by this preparation branch alone.
