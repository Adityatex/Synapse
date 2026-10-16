// Remember where a logged-out user was headed (e.g. an invite link) so login
// or signup can send them back there instead of the dashboard.
const KEY = 'synapse_return_to';

export function rememberReturnTo(path) {
  try {
    if (isSafePath(path)) window.sessionStorage.setItem(KEY, path);
  } catch {
    // storage unavailable: fall back to the dashboard
  }
}

export function consumeReturnTo(fallback = '/dashboard') {
  try {
    const path = window.sessionStorage.getItem(KEY);
    window.sessionStorage.removeItem(KEY);
    return isSafePath(path) ? path : fallback;
  } catch {
    return fallback;
  }
}

// Same-app paths only (no protocol-relative //host open redirects).
function isSafePath(path) {
  return typeof path === 'string' && path.startsWith('/') && !path.startsWith('//');
}
