import { CloudOff, Loader2, LogIn } from 'lucide-react';

/**
 * What the person should know about their connection to the room (P2-12); `state` comes from
 * connectionBannerState. It shows nothing while everything is fine.
 */
const plural = (count) => (count === 1 ? '1 change' : `${count} changes`);

export default function ConnectionBanner({ state, unsynced = 0, refusal = '', onSignIn, onReload }) {
  if (!state) return null;

  const signedOut = state === 'signed-out';
  const stopped = signedOut || state === 'refused';
  const message = {
    'signed-out': 'Your session expired, so this room is read-only now. Sign in again to keep editing.',
    refused: `${refusal || 'The server turned this connection away.'} This room is read-only now; reload to open it again.`,
    offline: 'You are offline. Reconnecting; what you type is kept here and will sync when the connection is back.',
    'offline-unsynced': `You are offline. ${plural(unsynced)} kept here, and will sync when the connection is back.`,
  }[state];

  return (
    <div
      role="status"
      aria-live="polite"
      data-connection-state={state}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '6px 14px',
        fontSize: '12px',
        background: stopped ? 'rgba(239, 68, 68, 0.12)' : 'rgba(245, 158, 11, 0.12)',
        borderBottom: `1px solid ${stopped ? 'rgba(239, 68, 68, 0.35)' : 'rgba(245, 158, 11, 0.35)'}`,
        color: stopped ? 'var(--danger-fg, #b91c1c)' : 'var(--warn-fg)',
      }}
    >
      {stopped ? <LogIn size={14} aria-hidden="true" /> : state === 'offline' ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <CloudOff size={14} aria-hidden="true" />}
      <span style={{ flex: 1 }}>{message}</span>
      {stopped && (
        <button
          type="button"
          onClick={signedOut ? onSignIn : onReload}
          style={{
            border: '1px solid currentColor',
            borderRadius: '6px',
            padding: '2px 10px',
            fontSize: '12px',
            fontWeight: 600,
            background: 'transparent',
            color: 'inherit',
            cursor: 'pointer',
          }}
        >
          {signedOut ? 'Sign in' : 'Reload'}
        </button>
      )}
    </div>
  );
}
