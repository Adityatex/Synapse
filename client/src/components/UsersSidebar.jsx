import { Users, Wifi, WifiOff, Crown } from 'lucide-react';

function formatName(user) {
  return user.username || user.name || 'Anonymous';
}

export default function UsersSidebar({
  roomId,
  participants,
  currentUser,
  connectionState,
}) {
  const isConnected = connectionState === 'connected';

  return (
    <aside
      className="hidden lg:flex lg:flex-col"
      style={{
        width: '280px',
        background: 'var(--bg-secondary)',
        borderLeft: '1px solid var(--border-primary)',
      }}
    >
      <div
        className="px-5 py-4"
        style={{ borderBottom: '1px solid var(--border-primary)' }}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Users size={16} style={{ color: 'var(--accent-blue)' }} />
            <span
              className="text-xs font-semibold uppercase tracking-wider"
              style={{ color: 'var(--text-secondary)' }}
            >
              Collaborators
            </span>
          </div>
          <div
            className="flex items-center gap-1 text-xs"
            style={{ color: isConnected ? 'var(--accent-green)' : 'var(--accent-orange)' }}
          >
            {isConnected ? <Wifi size={12} /> : <WifiOff size={12} />}
            <span>{isConnected ? 'Live' : 'Reconnecting'}</span>
          </div>
        </div>
        <div className="mt-3 text-xs" style={{ color: 'var(--text-muted)' }}>
          Room ID <span style={{ color: 'var(--text-primary)' }}>{roomId}</span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-3">
        {participants.map((participant) => {
          const isCurrentUser = participant.userId === currentUser?.userId;

          return (
            <div
              key={participant.socketId}
              className="flex items-center gap-3 rounded-xl px-3 py-3"
              style={{
                background: isCurrentUser ? 'var(--bg-tertiary)' : 'transparent',
                border: `1px solid ${isCurrentUser ? 'var(--border-primary)' : 'transparent'}`,
              }}
            >
              <div
                className="flex h-10 w-10 items-center justify-center rounded-full text-sm font-semibold"
                style={{
                  background: isCurrentUser
                    ? 'linear-gradient(135deg, var(--accent-blue), #06b6d4)'
                    : 'var(--bg-hover)',
                  color: isCurrentUser ? '#fff' : 'var(--text-primary)',
                }}
              >
                {formatName(participant)[0]?.toUpperCase() || 'U'}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span
                    className="inline-block h-2.5 w-2.5 rounded-full"
                    style={{ background: participant.cursorColor || 'var(--accent-green)' }}
                  />
                  <span className="truncate text-sm" style={{ color: 'var(--text-primary)' }}>
                    {formatName(participant)}
                  </span>
                  {isCurrentUser ? (
                    <span className="text-[11px]" style={{ color: 'var(--accent-blue)' }}>
                      You
                    </span>
                  ) : null}
                </div>
                <div className="mt-1 text-[11px]" style={{ color: 'var(--text-muted)' }}>
                  Active now
                </div>
              </div>
              {participant.userId === currentUser?.userId ? (
                <Crown size={14} style={{ color: 'var(--accent-orange)' }} />
              ) : null}
            </div>
          );
        })}

        {!participants.length ? (
          <div className="rounded-xl px-4 py-5 text-sm" style={{ color: 'var(--text-muted)' }}>
            No collaborators connected yet.
          </div>
        ) : null}
      </div>
    </aside>
  );
}
