const express = require('express');
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

// عميل إداري مستقل (service role): لا يُستخدم للدخول أبداً، فتبقى طلباته دائماً
// بمفتاح الخادم — لأن العميل العادي يتحوّل تلقائياً إلى رمز المستخدم بعد
// signUp/signIn فترفض سياسات RLS قراءة profiles (permission denied لجداول auth).
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

// Register new user
router.post('/register', async (req, res) => {
  try {
    const { email, password, name } = req.body;

    if (!email || !password || !name) {
      return res.status(400).json({ error: 'Email, password, and name are required' });
    }

    // Create user in Supabase Auth
    const { data: authData, error: authError } = await supabase.auth.signUp({
      email,
      password,
    });

    if (authError) {
      return res.status(400).json({ error: authError.message });
    }

    if (!authData.user) {
      return res.status(400).json({ error: 'Failed to create user' });
    }

    // Update user profile with name and role (live schema: full_name — mirrors worker.js upsertProfile)
    const { error: profileError } = await adminSupabase
      .from('profiles')
      .upsert(
        {
          id: authData.user.id,
          full_name: name,
          role: 'viewer', // default role
        },
        { onConflict: ['id'] }
      );

    if (profileError) {
      // If profiles table doesn't exist yet, that's OK for now
      console.warn('Profiles table may not exist yet:', profileError.message);
    }

    // Return success (without password)
    return res.status(201).json({
      id: authData.user.id,
      email: authData.user.email,
      name: name,
      role: 'viewer',
    });
  } catch (error) {
    console.error('Registration error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Login user
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (authError) {
      return res.status(400).json({ error: authError.message });
    }

    if (!authData.user) {
      return res.status(400).json({ error: 'Login failed' });
    }

    // Update user profile with role (عبر عميل الإدارة — رمز المستخدم يرفضه RLS)
    const { error: profileError } = await adminSupabase
      .from('profiles')
      .upsert({
        id: authData.user.id,
        role: 'viewer',
      }, { onConflict: ['id'] });

    if (profileError) {
      console.warn('Profile upsert error:', profileError.message);
    }

    return res.json({
      id: authData.user.id,
      email: authData.user.email,
      role: 'viewer',
    });
  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Get current user role
router.get('/me', async (req, res) => {
  try {
    const { data: authData } = await supabase.auth.getUser();
    const user = authData.user;

    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Fetch user role from profiles table عبر عميل الإدارة (قراءة خادمة لا تتأثر بجلسة المتصفح).
    // غياب صف الملف = مستخدم جديد لم يُنشأ له ملف بعد → الافتراضي viewer
    // (نفس سلوك worker.js getRole) وليس خطأ خادم.
    const { data: profile, error: profileError } = await adminSupabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .maybeSingle();

    if (profileError) {
      return res.status(500).json({ error: 'Failed to fetch user role' });
    }

    return res.json({
      id: user.id,
      email: user.email,
      role: profile?.role || 'viewer',
    });
  } catch (error) {
    console.error('Auth me error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
