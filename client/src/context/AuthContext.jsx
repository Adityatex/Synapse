import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { isAuthenticated, getAuthSession, getUserFromToken } from '../utils/auth';
import * as authService from '../services/authService';
import { AuthContext } from './authContextInstance';

// Read any existing session synchronously so the first render already knows
// who the user is (no setState-in-effect, no logged-out flash).
function readInitialUser() {
  try {
    if (isAuthenticated()) {
      const session = getAuthSession();
      return session?.user || getUserFromToken();
    }
  } catch (err) {
    console.error('Auth initialization error:', err);
  }
  return null;
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(readInitialUser);
  const loading = false;
  const navigate = useNavigate();

  const completeSignup = useCallback(
    async (email, otp) => {
      const data = await authService.verifySignupOtp(email, otp);
      setUser(data.user);
      navigate('/dashboard');
      return data;
    },
    [navigate]
  );

  const completeLogin = useCallback(
    async (email, otp) => {
      const data = await authService.verifyLoginOtp(email, otp);
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
    completeSignup,
    completeLogin,
    logout,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
