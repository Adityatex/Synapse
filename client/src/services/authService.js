import {
  setAuthSession,
  removeToken,
  getToken,
  getUserFromToken,
} from '../utils/auth';
import { API_BASE } from '../config/apiConfig';
const AUTH_API_BASE = `${API_BASE}/auth`;

/**
 * Request a signup OTP
 */
export async function requestSignupOtp(name, email, password) {
  const res = await fetch(`${AUTH_API_BASE}/signup/request-otp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, email, password }),
  });

  const data = await res.json();

  if (!res.ok) {
    throw new Error(data.error || 'Unable to send signup OTP. Please try again.');
  }

  return data;
}

/**
 * Verify signup OTP and create the user account
 */
export async function verifySignupOtp(email, otp) {
  const res = await fetch(`${AUTH_API_BASE}/signup/verify-otp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, otp }),
  });

  const data = await res.json();

  if (!res.ok) {
    throw new Error(data.error || 'Signup verification failed. Please try again.');
  }

  setAuthSession({ token: data.token, user: data.user });
  return data;
}

/**
 * Request a login OTP after validating email and password
 */
export async function requestLoginOtp(email, password) {
  const res = await fetch(`${AUTH_API_BASE}/login/request-otp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });

  const data = await res.json();

  if (!res.ok) {
    throw new Error(data.error || 'Unable to send login OTP. Please try again.');
  }

  return data;
}

/**
 * Verify login OTP and create the session
 */
export async function verifyLoginOtp(email, otp) {
  const res = await fetch(`${AUTH_API_BASE}/login/verify-otp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, otp }),
  });

  const data = await res.json();

  if (!res.ok) {
    throw new Error(data.error || 'Login verification failed. Please try again.');
  }

  setAuthSession({ token: data.token, user: data.user });
  return data;
}

/**
 * Log out the current user
 */
export function logout() {
  removeToken();
}

/**
 * Get the current auth token
 */
export { getToken };

/**
 * Get current user info from token
 */
export function getCurrentUser() {
  return getUserFromToken();
}

/**
 * Fetch the current user profile from the server
 * @returns {Promise<{user: object}>}
 */
export async function fetchProfile() {
  const token = getToken();
  if (!token) throw new Error('Not authenticated');

  const res = await fetch(`${AUTH_API_BASE}/me`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });

  const data = await res.json();

  if (!res.ok) {
    throw new Error(data.error || 'Failed to fetch profile.');
  }

  return data;
}
