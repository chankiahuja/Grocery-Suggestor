# GS-141 production preparation plan

Status: preparation only. This document and [`render.production.yaml`](../render.production.yaml) do not provision resources, sync Render, enter secrets, or change DNS.

## Decisions and boundaries

- Production hostname: `mypantrypal.in`.
- Production gets its own Render Blueprint, web service, and PostgreSQL database.
- The existing staging Blueprint and resources remain unchanged.
- Staging continues to use `GS-134` and production will use `main`.
- The production Blueprint disables auto-deploys so a deploy is a deliberate operator action.
- Do not provision until the release has been updated and reviewed on `main`.

The production Blueprint is intentionally separate from [`render.yaml`](../render.yaml). Create a new Render Blueprint using [`render.production.yaml`](../render.production.yaml); do not change or sync the staging Blueprint to create production.

## Current pilot plans and cost estimate

The following estimate uses Render's current plan IDs and pricing checked on 2026-11-11. Confirm the dashboard preview and current pricing immediately before provisioning.

| Resource | Proposed name | Plan ID | Expected cost |
| --- | --- | --- | ---: |
| Docker web service | `pantrypal-production` | `0.5c-512mb` | about $7/month |
| Render Postgres | `pantrypal-production-db` | `0.1c-256mb` | about $6/month |
| Hobby workspace | existing workspace | `Hobby` | $0/month |
| **Pilot compute subtotal** |  |  | **about $13/month** |

The web plan is the current 0.5 CPU/512 MB paid pilot size. The database plan is the current 0.1 CPU/256 MB size; it includes the initial database storage allowance. Additional Postgres storage, bandwidth beyond the workspace allowance, build minutes beyond the allowance, and extra custom domains can add usage charges. Compute is billed while the resources are active and is prorated by the second; the billing trigger is provisioning or activating these paid resources, not this file, branch, or documentation.

Render's legacy labels may show the web plan as Starter and the database plan as Basic-256mb. The Blueprint uses the current IDs: `0.5c-512mb` and `0.1c-256mb`.

References: [Render pricing](https://render.com/pricing), [compute plans](https://render.com/docs/compute-plans), and [Blueprint YAML reference](https://render.com/docs/blueprint-spec).

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
2. In BigRock DNS management, preserve all existing Titan and Brevo records. Do not change nameservers.
3. Remove only conflicting web-host records for the selected hostname, and remove `AAAA` records for the domain while configuring Render; Render currently uses IPv4.
4. For the apex `@`, use the Render-recommended root-domain record. If BigRock supports `ANAME`/`ALIAS` or CNAME flattening, point it to the production `onrender.com` hostname. Otherwise use Render's documented load-balancer `A` record `216.24.57.1`.
5. For `www`, add a `CNAME` to the production `onrender.com` hostname if `www` is retained. Confirm the desired redirect direction before applying it; adding an apex domain in Render normally creates the corresponding `www` redirect.
6. Return to Render and click **Verify** after DNS propagation. Render automatically issues and renews the TLS certificate. Confirm `https://mypantrypal.in` works, HTTP redirects to HTTPS, and `https://mypantrypal.in/api/healthz` returns the expected health response.

Preserve the existing Titan MX records and all Brevo SPF/DKIM/DMARC authentication records. The web-domain cutover must not change mail routing or email authentication.

References: [Render custom domains](https://render.com/docs/custom-domains) and [Render DNS guidance](https://render.com/docs/configure-other-dns).

## Provisioning and validation sequence

1. Update `main` to the reviewed release that production is meant to run. Verify the release commit, migrations, security settings, SMTP configuration, health endpoint, and rollback artifact before provisioning.
2. Review this document and the full [`render.production.yaml`](../render.production.yaml). Confirm the names are new, the branch is `main`, the plans are the intended paid pilot sizes, `autoDeployTrigger` is `off`, and the staging Blueprint remains untouched.
3. Create a separate Render Blueprint from `render.production.yaml` and inspect the sync preview. Stop if the preview proposes changing `pantrypal-staging`, using `GS-134` for production, or creating an unexpected resource.
4. Review the paid-resource confirmation and estimated monthly cost. Do not approve it until the production plan is explicitly accepted.
5. Provision the separate production resources only after that review. Enter the protected secret values through Render; never commit them.
6. Validate the deployment on its Render hostname before DNS cutover: `/api/healthz`, HTTPS redirect, secure cookies, email OTP delivery through Brevo, support-mail delivery, database migrations, and a minimal authenticated pantry flow.
7. Apply the approved BigRock DNS changes and Render domain verification. Re-run the health, authentication, and support-mail checks on `mypantrypal.in`.
8. Keep staging at its existing URL and `GS-134`; do not repoint staging or use it as the production hostname.

## Cutover and rollback

### Cutover

- Freeze the production release commit on `main` and record it.
- Confirm the production service is healthy on its Render hostname and the database backup/restore plan is available.
- Put the approved DNS records in BigRock, verify Render TLS, and test the apex and `www` behavior.
- Run the smoke checks again on `mypantrypal.in` and monitor logs, health checks, login delivery, and support delivery.
- Leave the staging service and URL unchanged for comparison and fallback.

### Rollback

- If the application release is faulty, use the Render service's reviewed prior deploy/rollback artifact, then re-run health and authentication checks.
- If the domain cutover is faulty, restore the previously recorded BigRock web records only; do not alter Titan MX or Brevo authentication records.
- If the database is faulty, stop writes, preserve the incident evidence, and follow the approved backup/restore and reconciliation procedure in [GS-136](GS-136-BACKUP-RESTORE.md). Do not point production at the staging database.
- Keep staging available while production is repaired. Do not delete or repurpose production resources during an incident without a separate review.

No paid provisioning, Blueprint sync, secret entry, deploy, or DNS change is authorized by this preparation branch alone.
