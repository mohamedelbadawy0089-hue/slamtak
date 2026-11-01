#!/bin/bash
set -e

# Load environment variables
export $(cat .env.local | xargs)

# Start the development server
node start.js