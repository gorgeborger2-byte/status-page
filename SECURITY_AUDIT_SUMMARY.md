# Security Audit Summary

Audit artifact source: `runtime-logs/full-pen-report.json`

## Run Metadata

- `startedAt`: `2026-04-05T17:23:36.250Z`
- `finishedAt`: `2026-04-05T17:23:39.979Z`
- `total`: `52`
- `pass`: `true`

## Coverage Buckets (All Passing)

- **Direct file/path exposure**
  - blocked sensitive files and internals (`/backend-db.json`, `/server.js`, `/.git`, `/node_modules`, `/scripts`, `.env`, runtime logs)
- **Unauthenticated access control**
  - unauthenticated access rejected for protected APIs (`401`)
- **Register/login/approval business flow**
  - registration validation, pending login block, admin approval, post-approval login
- **Role/permission matrix**
  - owner + coder admin access confirmed
  - support blocked from admin endpoints and user mutation paths
- **Admin-only enforcement**
  - admin-only actions validated on users/roles/commands/content/manual items
- **Session and account state logic**
  - ban invalidates active session
  - logout path verified
  - seeded-owner delete protection enforced
- **Password paths**
  - wrong current password rejected
  - password update accepted with correct current password
  - old password rejected after change
  - new password accepted
- **Nickname cooldown + race case**
  - first nickname set accepted
  - immediate parallel nickname changes rejected (`400`, `400`)
- **Command payload and CRUD checks**
  - admin add/remove command
  - non-admin read command list
  - payload round-trip tested
- **CSRF origin tampering**
  - cross-origin unsafe auth request blocked (`403`)
- **Rate-limit behavior**
  - high-volume login attempts hit rate limit (`429`), including username-rotation pressure
- **Status endpoint and sync metadata**
  - `/api/status` returns items and sync metadata fields
- **Security headers**
  - `X-Content-Type-Options: nosniff`
  - `X-Frame-Options: DENY`

## Repro Command

The full penetration-style matrix was executed through a local scripted run against an isolated temporary DB and writes results to:

- `runtime-logs/full-pen-report.json`

## Residual Risk Notes

- This is a strong practical hardening and abuse-path validation pass, not a formal external pentest by a third-party security firm.
- Browser/client-side anti-inspect protections are deterrents only and should not be treated as core security controls.
- Keep runtime state files (`backend-db.json`, `data/status.json`) out of git history and backups with broad access.
