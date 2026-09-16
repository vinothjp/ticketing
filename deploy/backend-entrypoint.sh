#!/bin/sh
set -e

echo "╔══════════════════════════════════════╗"
echo "║  KT Ticketing — Starting up...       ║"
echo "╚══════════════════════════════════════╝"

# ── Sync schema ──────────────────────────────────────────────
echo "→ Syncing database schema..."
npx prisma db push 2>&1

# ── Apply manual migrations (all idempotent) ─────────────────
# Strip Prisma's ?schema=public suffix — psql doesn't understand it
PSQL_URL="${DATABASE_URL%%\?*}"

echo "→ Applying manual migrations..."
for f in /app/prisma/migrations/manual/*.sql; do
  [ -f "$f" ] || continue
  echo "  • $(basename "$f")"
  psql "$PSQL_URL" -f "$f" -v ON_ERROR_STOP=0 2>&1 | grep -v "^$" || true
done

# ── Seed (idempotent find-or-create) ─────────────────────────
if [ "$RUN_SEED" = "true" ]; then
  echo "→ Running seed..."
  node /app/dist/seed.js 2>&1
fi

echo "→ Starting application..."
exec node dist/src/main.js
