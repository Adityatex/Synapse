import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { isAuthenticated, getAuthSession, getUserFromToken } from '../utils/auth';
import * as authService from '../services/authService';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  // Check for existing auth on mount
  useEffect(() => {
    try {
      if (isAuthenticated()) {
        const session = getAuthSession();
        const userData = session?.user || getUserFromToken();
        setUser(userData);
      }
    } catch (err) {
      console.error('Auth initialization error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  const signup = useCallback(
    async (name, email, password) => {
      const data = await authService.signup(name, email, password);
      setUser(data.user);
      navigate('/dashboard');
      return data;
    },
    [navigate]
  );

  const login = useCallback(
    async (email, password) => {
      const data = await authService.login(email, password);
      setUser(data.user);
      navigate('/dashboard');
      return data;
    },
    [navigate]
  );

  const logout = useCallback(() => {
    authService.logout();
    setUser(null);
    navigate('/login');
  }, [navigate]);

  const value = {
    user,
    setUser,
    loading,
    isAuthenticated: !!user,
    signup,
    login,
    logout,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

export default AuthContext;
