#!/bin/sh
set -e

echo "╔══════════════════════════════════════╗"
echo "║  KT Ticketing — Starting up...       ║"
echo "╚══════════════════════════════════════╝"

# Strip Prisma's ?schema=public suffix — psql doesn't understand it
PSQL_URL="${DATABASE_URL%%\?*}"

# All manual files are idempotent. They run BEFORE db push too: some back-fill only
# when they are the ones adding the column (template_requires_approval.sql), and
# db push adding it first makes them skip the seed silently. The pass after db push
# catches files that depend on tables/columns only db push creates.
apply_manual() {
  echo "→ Applying manual migrations ($1)..."
  for f in /app/prisma/migrations/manual/*.sql; do
    [ -f "$f" ] || continue
    echo "  • $(basename "$f")"
    psql "$PSQL_URL" -f "$f" -v ON_ERROR_STOP=0 2>&1 | grep -v "^$" || true
  done
}

apply_manual "before schema sync"

# ── Sync schema ──────────────────────────────────────────────
# No --accept-data-loss on purpose: a destructive change stops the container
# instead of deleting data. Roll back the image and fix the schema.
echo "→ Syncing database schema..."
npx prisma db push 2>&1

apply_manual "after schema sync"

# ── Seed (idempotent find-or-create) ─────────────────────────
if [ "$RUN_SEED" = "true" ]; then
  echo "→ Running seed..."
  node /app/dist/seed.js 2>&1
fi

echo "→ Starting application..."
exec node dist/src/main.js
