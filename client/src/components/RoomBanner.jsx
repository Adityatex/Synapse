import { Copy, Check, AlertCircle } from 'lucide-react';

export default function RoomBanner({
  roomId,
  connectionState,
  lastError,
  copied,
  onCopy,
  activityFeed = [],
}) {
  const isConnected = connectionState === 'connected';

  return (
    <div
      className="px-6 py-3"
      style={{
        background: 'var(--bg-secondary)',
        borderBottom: '1px solid var(--border-primary)',
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="text-xs uppercase tracking-[0.24em]" style={{ color: 'var(--text-muted)' }}>
            Shared Coding Room
          </div>
          <div className="mt-1 flex items-center gap-3">
            <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
              Room {roomId}
            </span>
            <span
              className="text-xs"
              style={{ color: isConnected ? 'var(--accent-green)' : 'var(--accent-orange)' }}
            >
              {isConnected ? 'Real-time sync active' : 'Reconnecting to collaboration server'}
            </span>
          </div>
          {lastError ? (
            <div className="mt-1 flex items-center gap-2 text-xs" style={{ color: 'var(--accent-red)' }}>
              <AlertCircle size={12} />
              <span>{lastError}</span>
            </div>
          ) : null}
        </div>

        <button
          onClick={onCopy}
          className="flex items-center gap-2 rounded-xl px-4 py-2 text-sm transition-all duration-200"
          style={{
            background: 'var(--bg-tertiary)',
            border: '1px solid var(--border-primary)',
            color: 'var(--text-primary)',
          }}
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}
          <span>{copied ? 'Invite copied' : 'Copy invite link'}</span>
        </button>
      </div>

      {activityFeed.length ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {activityFeed.map((event) => (
            <div
              key={event.id}
              className="rounded-full px-3 py-1 text-xs"
              style={{
                background: 'var(--bg-tertiary)',
                border: '1px solid var(--border-primary)',
                color: 'var(--text-secondary)',
              }}
            >
              {event.message}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
