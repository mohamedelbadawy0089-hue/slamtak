declare namespace Supabase {
  interface Client {
    auth: {
      getUser(): Promise<{ data: { user: any } | null }>;
      signInWithPassword(data: { email: string; password: string }): Promise<any>;
      signUp(data: { email: string; password: string }): Promise<any>;
      signOut(): Promise<any>;
    };
    from(tableName: string): any;
  }
}