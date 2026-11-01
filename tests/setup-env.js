// Setup environment for tests
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://test.supabase.co';
process.env.SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'test-key';

module.exports = {
  setup: () => {
    console.log('Test env setup complete');
  }
};