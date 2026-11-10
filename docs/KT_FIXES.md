# KT fixes on top of main

Branch `kt-fixes/2026-11-06` = `origin/main` @ `0712f98` + the 5 commits below.
This is what runs on tickets.kumaraitech.com from 2026-11-06 (bundle `db60d5e`).
Merge this into main, or the next build from main drops all of it.

| Commit | Written | What it fixes |
|---|---|---|
| `b2baca8` | 2026-09-16 | Client demo pass: renamed to "Ticket Management System", live clock + quick create-ticket button in the header, Copilot widget removed, global search now covers employees / projects / KB articles / menu pages, login is case-insensitive, OTP 2FA for SuperAdmin (new `otp-service`), production deploy setup (Caddyfile, backend entrypoint, `docker-compose.prod.yml`, `Dockerfile.prod`), dev ports moved to 3100 / 5436 / 5175. |
| `735b4d9` | 2026-10-10 | SheetJS `xlsx` 0.18.5 → 0.20.3 (vendored tarball from cdn.sheetjs.com, npm has no fixed version). Closes CVE-2023-30533 (prototype pollution) and CVE-2024-22363 (ReDoS) on uploaded spreadsheets. Tests: `backend/src/lib/spreadsheet.spec.ts`. |
| `5845d7c` | 2026-10-18 | SuperAdmin 2FA fails **closed**: if the OTP service is down or unconfigured, login now returns 503 instead of logging in with no code. `SUPER_ADMIN_OTP=false` is the only bypass (dev compose sets it). verify-otp re-checks the user is still active and still SuperAdmin. Tests: `backend/src/auth/auth.service.spec.ts`. |
| `2141566` | 2026-11-06 | Prod compose passes `FRONTEND_URL`. Password-reset and gallery links in emails were pointing at `localhost:5173`. |
| `db60d5e` | 2026-11-06 | Backend entrypoint runs the idempotent manual SQL files before **and** after `prisma db push`. Running them only after left the Change template with `requiresApproval=false` on upgraded databases. |

## Known, not fixed here

- `tickets.service.spec.ts`: 6 reopen / acknowledgement tests already fail on clean `Release_1.0.0` (sign-off cleared on reopen, customer-employee reopen, staff internal reopen, reopen reason ×3).
- `deploy.sh` runs `rm -rf "$DIST_DIR"` and then copies `setup.sh` / `update.sh` out of `ticketing-deploy/`, the folder it just deleted. Don't run it as-is.
- `90cd9cd` ("fixed bugs in emails", `feature_next_changes`, 2026-11-06) is not in main and not in this branch.
