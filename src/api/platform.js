import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });

export default async function handler(req, res) {
  try {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'unauthorized' });
    const { data: userData, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !userData?.user) return res.status(401).json({ error: 'unauthorized' });
    const { data: profile } = await supabase.from('profiles').select('is_platform_admin').eq('id', userData.user.id).maybeSingle();
    if (!profile?.is_platform_admin) return res.status(403).json({ error: 'forbidden' });
    if (req.url.includes('/overview') || req.method === 'GET') {
      const [users, warehouses, userWarehouses] = await Promise.all([
        supabase.from('auth.users').select('id,email,created_at').limit(100),
        supabase.from('warehouses').select('*').limit(100),
        supabase.from('user_warehouses').select('*, user:users(email), role:roles(name), warehouse:warehouses(name)').limit(200)
      ]);
      return res.status(200).json({ users: users.data, warehouses: warehouses.data, user_warehouses: userWarehouses.data });
    }
    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
