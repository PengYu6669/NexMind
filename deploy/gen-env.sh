#!/usr/bin/env bash
# Bootstrap a production .env from .env.example.
# Auto-generates strong secrets; leaves AI/TOS/SerpAPI/domain for manual fill.
set -euo pipefail

REPO="${1:-$HOME/nexmind}"
cd "$REPO"

[ -f .env ] || cp .env.example .env

JWT="$(openssl rand -hex 48)"
PGP="$(openssl rand -hex 24)"
CRON="$(openssl rand -hex 32)"

set_kv() {
  local key="$1" val="$2"
  if grep -q "^${key}=" .env; then
    sed -i "s|^${key}=.*|${key}=\"${val}\"|" .env
  else
    echo "${key}=\"${val}\"" >> .env
  fi
}

set_kv AUTH_JWT_SECRET     "$JWT"
set_kv POSTGRES_USER       "nexmind"
set_kv POSTGRES_PASSWORD   "$PGP"
set_kv POSTGRES_DB         "nexmind"
set_kv INTERNAL_CRON_TOKEN "$CRON"
set_kv APP_DOMAIN          "PLACEHOLDER_DOMAIN"

echo "ENV_WRITTEN"
grep -E '^(AUTH_JWT_SECRET|POSTGRES_USER|POSTGRES_PASSWORD|POSTGRES_DB|INTERNAL_CRON_TOKEN|APP_DOMAIN)=' .env \
  | sed -E 's/=.*/=<set>/'
