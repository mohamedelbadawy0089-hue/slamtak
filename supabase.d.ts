declare module '@supabase/supabase-js' {
  interface SupabaseClient {
    auth: {
      getUser(): Promise<{ data: { user: any } }>;
      onAuthStateChange(
        callback: (event: string, session: { user: any }) => void
      ): { data: { subscription: { unsubscribe: () => void } } };
    };
    from(table: string): { select: (columns: string, options?: any) => any; single: () => any; insert: (data: any) => any };
  }
}

declare global {
  namespace NodeJS {
    interface ProcessEnv {
      SUPABASE_URL: string;
      SUPABASE_SERVICE_ROLE_KEY: string;
    }
  }
}