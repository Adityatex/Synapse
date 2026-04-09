import {
  setAuthSession,
  removeToken,
  getToken,
  getUserFromToken,
} from '../utils/auth';

const API_BASE = 'http://localhost:5000/api/auth';

/**
 * Sign up a new user
 * @param {string} name
 * @param {string} email
 * @param {string} password
 * @returns {Promise<{token: string, user: object}>}
 */
export async function signup(name, email, password) {
  const res = await fetch(`${API_BASE}/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, email, password }),
  });

  const data = await res.json();

  if (!res.ok) {
    throw new Error(data.error || 'Signup failed. Please try again.');
  }

  setAuthSession({ token: data.token, user: data.user });
  return data;
}

/**
 * Log in an existing user
 * @param {string} email
 * @param {string} password
 * @returns {Promise<{token: string, user: object}>}
 */
export async function login(email, password) {
  const res = await fetch(`${API_BASE}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });

  const data = await res.json();

  if (!res.ok) {
    throw new Error(data.error || 'Login failed. Please try again.');
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

  const res = await fetch(`${API_BASE}/me`, {
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
