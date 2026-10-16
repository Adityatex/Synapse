#!/usr/bin/env bash
# Copy the runtime secrets from server/.env into a Fly app without printing them.
#   bash scripts/fly-secrets.sh <app-name>
set -euo pipefail
APP="${1:?usage: bash scripts/fly-secrets.sh <app-name>}"
cd "$(dirname "$0")/.."
KEYS='MONGODB_URI|JWT_SECRET|GMAIL_USER|GMAIL_APP_PASSWORD|EMAIL_FROM|OTP_EXPIRY_MINUTES|OTP_MAX_ATTEMPTS|OTP_DELIVERY_MODE|BREVO_API_KEY|BREVO_SENDER_EMAIL|BREVO_SENDER_NAME|RESEND_API_KEY|RESEND_FROM|JUDGE0_API_HOST|JUDGE0_API_KEY|GROQ_API_KEY|GROQ_MODEL|SENTRY_DSN|DNS_SERVERS'
grep -E "^(${KEYS})=" server/.env | tr -d '\r' | grep -vE '^[A-Z0-9_]+=$' | fly secrets import -a "$APP" --stage
echo "Staged secrets for $APP (applied on the next fly deploy):"
fly secrets list -a "$APP"
