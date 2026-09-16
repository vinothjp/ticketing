#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

DIST_DIR="$SCRIPT_DIR/ticketing-deploy"

echo "╔══════════════════════════════════════════╗"
echo "║  Building KT Ticketing production images ║"
echo "╚══════════════════════════════════════════╝"
echo ""

# ── Build backend image ──────────────────────────────────────
echo "▸ Building kt-ticketing-api..."
docker build \
  -f backend/Dockerfile.prod \
  -t kt-ticketing-api:latest \
  . 2>&1 | tail -5
echo "  ✓ kt-ticketing-api built"
echo ""

# ── Build frontend + caddy image ────────────────────────────
echo "▸ Building kt-ticketing-web..."
docker build \
  -f deploy/Dockerfile.web \
  -t kt-ticketing-web:latest \
  . 2>&1 | tail -5
echo "  ✓ kt-ticketing-web built"
echo ""

# ── Build OTP service image ─────────────────────────────────
echo "▸ Building kt-ticketing-otp..."
docker build \
  -t kt-ticketing-otp:latest \
  otp-service/ 2>&1 | tail -5
echo "  ✓ kt-ticketing-otp built"
echo ""

# ── Package for transport ───────────────────────────────────
echo "▸ Packaging deploy bundle → $DIST_DIR/"
rm -rf "$DIST_DIR"
mkdir -p "$DIST_DIR/images"

echo "  Saving kt-ticketing-api.tar..."
docker save kt-ticketing-api:latest | gzip > "$DIST_DIR/images/kt-ticketing-api.tar.gz"

echo "  Saving kt-ticketing-web.tar..."
docker save kt-ticketing-web:latest | gzip > "$DIST_DIR/images/kt-ticketing-web.tar.gz"

echo "  Saving kt-ticketing-otp.tar..."
docker save kt-ticketing-otp:latest | gzip > "$DIST_DIR/images/kt-ticketing-otp.tar.gz"

# Compose + env template + scripts
cp docker-compose.prod.yml "$DIST_DIR/docker-compose.yml"
cp .env.production.example "$DIST_DIR/.env.example"

# Copy scripts from the tracked versions in ticketing-deploy/
cp ticketing-deploy/portainer-compose.yml "$DIST_DIR/portainer-compose.yml"
cp ticketing-deploy/setup.sh "$DIST_DIR/setup.sh"
cp ticketing-deploy/update.sh "$DIST_DIR/update.sh"
chmod +x "$DIST_DIR/setup.sh" "$DIST_DIR/update.sh"

# ── Size report ─────────────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════╗"
echo "║  Deploy bundle ready                     ║"
echo "╚══════════════════════════════════════════╝"
echo ""
du -sh "$DIST_DIR/images/"*.tar.gz
echo ""
du -sh "$DIST_DIR"
echo ""
echo "Copy $DIST_DIR/ to the server, run ./setup.sh"
