#!/usr/bin/env bash
set -euo pipefail

# Deploys backend/ + arcium-mpc/'s client (the pieces the hosted backend
# actually needs) to Railway, via the "pyle-backend" service.
#
# Why this script exists instead of a plain `railway up` from the repo
# root: Railway's builder (Railpack) auto-detects the project language by
# scanning the upload for recognizable files, and the repo root has
# Cargo.toml (the Anchor workspace) -- it detects Rust, tries to find a
# compiled binary to run, and fails immediately, never reading
# railway.json's overrides (confirmed directly: identical railway.json
# content present on both a failing and a succeeding deploy -- the only
# variable that changed was removing Cargo.toml from what gets uploaded).
# So this stages a clean, Rust-free copy containing only what the backend
# needs, with its own package.json whose build/start scripts Railpack's
# plain Node convention detection picks up correctly.
#
# Secrets (TREASURY_SECRET_KEY, WALLET_A/B/C_SECRET_KEY) are NOT set here --
# set them once via the Railway dashboard or `railway variable set --stdin`,
# they persist across redeploys.
#
# Usage: ./scripts/deploy-backend.sh [railway-service-id]

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVICE="${1:-}"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

echo "Staging a Rust-free deploy copy in $STAGE ..."
mkdir -p "$STAGE/target/idl" "$STAGE/arcium-mpc/target/idl" "$STAGE/arcium-mpc/build"

rsync -a --exclude node_modules --exclude dist "$ROOT/backend/" "$STAGE/backend/"
cp -r "$ROOT/arcium-mpc/client" "$STAGE/arcium-mpc/client"
cp "$ROOT/arcium-mpc/package.json" "$ROOT/arcium-mpc/package-lock.json" "$STAGE/arcium-mpc/"
cp "$ROOT/arcium-mpc/target/idl/"*.json "$STAGE/arcium-mpc/target/idl/"
cp "$ROOT/arcium-mpc/build/"*.arcis "$STAGE/arcium-mpc/build/"
cp "$ROOT/demo-mint.json" "$ROOT/demo-dbc-pool.json" "$STAGE/"
cp "$ROOT/target/idl/"*.json "$STAGE/target/idl/"

cat > "$STAGE/package.json" <<'EOF'
{
  "name": "pyle-backend-deploy",
  "private": true,
  "scripts": {
    "build": "cd backend && npm install && npm run build && cd ../arcium-mpc && npm install",
    "start": "cd backend && npm start"
  }
}
EOF

echo "Deploying to Railway..."
cd "$STAGE"
if [ -n "$SERVICE" ]; then
  npx @railway/cli up --detach --json --service "$SERVICE"
else
  npx @railway/cli up --detach --json
fi
