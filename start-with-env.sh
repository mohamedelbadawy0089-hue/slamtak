#!/bin/bash
# Start development server with .env.local loaded

# Load environment variables from .env.local
if [ -f .env.local ]; then
  export $(grep -v '^#' .env.local | xargs)
fi

echo "Loaded environment:"
echo "  SUPABASE_URL: $SUPABASE_URL"
echo "  SUPABASE_SERVICE_ROLE_KEY: ${SUPABASE_SERVICE_ROLE_KEY:0:20}..."
echo ""

# Start the server
npm run dev