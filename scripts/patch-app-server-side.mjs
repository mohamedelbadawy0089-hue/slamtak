// Patch app server side
import { createClient } from '@supabase/supabase-js';

async function patchAppServerSide() {
  const client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  // Patch server side
}

patchAppServerSide();