#!/bin/sh
set -e

if [ "${SKIP_MIGRATIONS:-false}" != "true" ]; then
  echo "Running database migrations..."
  cd /app/apps/api
  npx prisma migrate deploy
fi

echo "Starting API server..."
exec node /app/apps/api/dist/src/index.js
