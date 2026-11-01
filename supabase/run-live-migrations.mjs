// Run live migrations
import { createClient } from '@supabase/supabase-js';
import config from './config.js';

async function runLiveMigrations() {
  const client = createClient(config.url, config.serviceRoleKey);
}

runLiveMigrations();