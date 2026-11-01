const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
);

const adminSupabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  }
);

router.post('/register', async (req, res) => {
  try {
    const { email, password, name } = req.body;
    if (!email || !password || !name) {
      return res.status(400).json({ error: 'Email, password, and name are required' });
    }
    const { data: authData, error: authError } = await supabase.auth.signUp({ email, password });
    if (authError) return res.status(400).json({ error: authError.message });
    if (!authData.user) return res.status(400).json({ error: 'Failed to create user' });
    const { error: profileError } = await adminSupabase
      .from('profiles')
      .upsert({ id: authData.user.id, full_name: name, role: 'viewer' }, { onConflict: ['id'] });
    if (profileError) console.warn('Profiles table may not exist yet:', profileError.message);
    return res.status(201).json({ id: authData.user.id, email: authData.user.email, name, role: 'viewer' });
  } catch (error) {
    console.error('Registration error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });
    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({ email, password });
    if (authError) return res.status(400).json({ error: authError.message });
    if (!authData.user) return res.status(400).json({ error: 'Login failed' });
    const { error: profileError } = await adminSupabase
      .from('profiles')
      .upsert({ id: authData.user.id, role: 'viewer' }, { onConflict: ['id'] });
    if (profileError) console.warn('Profile upsert error:', profileError.message);
    return res.json({ id: authData.user.id, email: authData.user.email, role: 'viewer' });
  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/register-store', async (req, res) => {
  try {
    const { email, password, store_name, phone, governorate, admin_password } = req.body;
    if (!email || !password || !store_name) return res.status(400).json({ error: 'Email, password, and store name are required' });
    if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
    if (admin_password && admin_password.length < 6) return res.status(400).json({ error: 'Admin password must be at least 6 characters' });
    const { data: authData, error: authError } = await supabase.auth.signUp({
      email, password,
      options: { data: { full_name: store_name, role: 'manager' } }
    });
    if (authError) return res.status(400).json({ error: authError.message });
    if (!authData.user) return res.status(400).json({ error: 'Failed to create user' });
    let adminHash = null;
    if (admin_password && admin_password.length >= 6) {
      adminHash = crypto.createHash('sha256').update(admin_password).digest('base64')
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    }
    const { data: wsData, error: wsError } = await adminSupabase.rpc('register_independent_warehouse', {
      p_name: store_name, p_phone: phone || '', p_governorate: governorate || '', p_admin_hash: adminHash || ''
    });
    if (wsError) console.error('register_independent_warehouse error:', wsError.message);
    return res.status(201).json({
      id: authData.user.id, email: authData.user.email, store_name,
      role: 'manager', warehouse_id: wsData?.warehouse_id || null,
      warehouse_code: wsData?.warehouse_code || null, tenant_id: wsData?.tenant_id || null
    });
  } catch (error) {
    console.error('Store registration error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/me', async (req, res) => {
  try {
    const { data: authData } = await supabase.auth.getUser();
    const user = authData.user;
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    const { data: profile, error: profileError } = await adminSupabase
      .from('profiles').select('role').eq('id', user.id).maybeSingle();
    if (profileError) return res.status(500).json({ error: 'Failed to fetch user role' });
    return res.json({ id: user.id, email: user.email, role: profile?.role || 'viewer' });
  } catch (error) {
    console.error('Auth me error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
