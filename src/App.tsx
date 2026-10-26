import React, { useEffect, useState } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { Register } from './pages/Register';
import { Login } from './pages/Login';
import { SuperAdmin } from './pages/SuperAdmin';
import { Manager } from './pages/Manager';
import { Employee } from './pages/Employee';

// Supabase client - initialized from config
declare const supabase: any;

interface AuthUser {
  id: string;
  email: string | null;
  role: string;
}

const App: React.FC = () => {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const checkAuth = async () => {
      try {
        const { data: authData } = await supabase.auth.getUser();
        const user = authData.user;

        if (user) {
          setUser({
            id: user.id,
            email: user.email,
            role: 'employee',
          });
        } else {
          setUser(null);
        }
      } catch (err) {
        console.error('Auth check error:', err);
        setUser(null);
      }
      setLoading(false);
    };

    checkAuth();

    const { data: authSubscription } = supabase.auth.onAuthStateChange(
      (event: string, session: { user: any }) => {
        if (session?.user) {
          setUser({
            id: session.user.id,
            email: session.user.email,
            role: 'employee',
          });
        } else {
          setUser(null);
        }
      }
    );

    return () => {
      authSubscription?.subscription?.unsubscribe();
    };
  }, []);

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center">Loading...</div>;
  }

  return (
    <Router>
      <div className="min-h-screen">
        {user ? (
          <Routes>
            <Route
              path="/super-admin"
              element={user.role === 'super-admin' ? <SuperAdmin /> : <Login />}
            />
            <Route
              path="/manager"
              element={user.role === 'manager' ? <Manager /> : <Login />}
            />
            <Route
              path="/employee"
              element={user.role === 'employee' ? <Employee /> : <Login />}
            />
            <Route path="/" element={user ? <SuperAdmin /> : <Login />} />
            <Route path="/register" element={<Register />} />
          </Routes>
        ) : (
          <Login />
        )}
      </div>
    </Router>
  );
};

export default App;