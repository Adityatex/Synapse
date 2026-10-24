import { useEffect, useMemo, useRef, useState } from 'react';
import { parseRoomTarget } from '../utils/roomLinks';

// Ctrl/Cmd+K palette for the dashboard: search rooms and run the common
// actions without the mouse. Arrow keys move, Enter runs, Esc closes.
// Mounted only while open, so every opening starts with an empty query.
export default function CommandPalette({ onClose, rooms, onOpenRoom, onCreate, onJoin, onSolo, onLogout }) {
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const items = useMemo(() => {
    const q = query.trim();
    // Offer "join" only for an invite link or something shaped like a room
    // code (6 characters, typed in capitals or containing a digit).
    const parsed = parseRoomTarget(q);
    const looksLikeCode = /^[A-Za-z0-9]{6}$/.test(q) && (/\d/.test(q) || q === q.toUpperCase());
    const target = parsed && (parsed.hasInvite || looksLikeCode) ? parsed : null;
    const actions = [
      q
        ? { id: 'create', group: 'Actions', label: `Create a room named “${q}”`, hint: 'New room', run: () => onCreate(q) }
        : { id: 'create', group: 'Actions', label: 'New room', hint: 'Type a name first, or press Enter', run: () => onCreate('') },
    ];
    if (target) {
      actions.push({
        id: 'join',
        group: 'Actions',
        label: target.hasInvite ? 'Join with this invite link' : `Join room ${target.roomId}`,
        hint: 'Join',
        run: () => onJoin(target),
      });
    }
    actions.push({ id: 'solo', group: 'Actions', label: 'Open the solo editor', hint: 'Editor', run: onSolo });
    actions.push({ id: 'logout', group: 'Actions', label: 'Log out', hint: 'Account', run: onLogout });

    const needle = q.toLowerCase();
    const roomItems = rooms
      .filter((r) => !needle || (r.roomName || '').toLowerCase().includes(needle) || (r.roomId || '').toLowerCase().includes(needle))
      .slice(0, 8)
      .map((r) => ({
        id: `room-${r.roomId}`,
        group: 'Rooms',
        label: r.roomName || 'Untitled room',
        hint: r.live?.length ? `${r.roomId} · ${r.live.length} here now` : r.roomId,
        live: Boolean(r.live?.length),
        run: () => onOpenRoom(r.roomId),
      }));
    // When the query matches rooms, show them first.
    return needle && roomItems.length ? [...roomItems, ...actions] : [...actions, ...roomItems];
  }, [query, rooms, onCreate, onJoin, onSolo, onLogout, onOpenRoom]);

  const active = Math.min(index, Math.max(items.length - 1, 0));

  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  function onKeyDown(e) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setIndex((i) => (Math.min(i, items.length - 1) + 1) % items.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setIndex((i) => (Math.min(i, items.length - 1) - 1 + items.length) % items.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const item = items[active];
      if (item) {
        onClose();
        item.run();
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  }

  let lastGroup = null;
  return (
    <div className="pal-overlay" role="presentation" onMouseDown={onClose}>
      <div className="pal" role="dialog" aria-modal="true" aria-label="Command palette" onMouseDown={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="pal-input"
          placeholder="Search rooms, paste an invite link, or name a new room"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setIndex(0);
          }}
          onKeyDown={onKeyDown}
          role="combobox"
          aria-expanded="true"
          aria-controls="pal-list"
          aria-activedescendant={items[active] ? `pal-${items[active].id}` : undefined}
          spellCheck={false}
        />
        <ul id="pal-list" className="pal-list" role="listbox" ref={listRef}>
          {items.map((item, i) => {
            const header = item.group !== lastGroup ? item.group : null;
            lastGroup = item.group;
            return (
              <li key={item.id} role="presentation">
                {header && <p className="pal-group">{header}</p>}
                <button
                  type="button"
                  id={`pal-${item.id}`}
                  data-index={i}
                  role="option"
                  aria-selected={i === active}
                  className={`pal-item ${i === active ? 'is-active' : ''}`}
                  onMouseEnter={() => setIndex(i)}
                  onClick={() => {
                    onClose();
                    item.run();
                  }}
                >
                  <span className="pal-label">
                    {item.live && <span className="dash-live-dot" aria-hidden="true" />}
                    {item.label}
                  </span>
                  <span className="pal-hint">{item.hint}</span>
                </button>
              </li>
            );
          })}
        </ul>
        <p className="pal-foot">
          <kbd>↑</kbd> <kbd>↓</kbd> to move · <kbd>Enter</kbd> to open · <kbd>Esc</kbd> to close
        </p>
      </div>
    </div>
  );
}
