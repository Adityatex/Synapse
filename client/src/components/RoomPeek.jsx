import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { createInviteLink } from '../services/roomService';
import { copyText } from '../utils/clipboard';

const PREVIEW_LINES = 14;

// Flatten the room's files into display order: folders first, children
// indented under their parent.
function flattenTree(files) {
  const byParent = new Map();
  files.forEach((f) => {
    const key = f.parentId || null;
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key).push(f);
  });
  const sortKids = (list) =>
    [...list].sort((a, b) => (a.type === b.type ? (a.name || '').localeCompare(b.name || '') : a.type === 'folder' ? -1 : 1));
  const out = [];
  const walk = (parentId, depth) => {
    sortKids(byParent.get(parentId) || []).forEach((f) => {
      out.push({ ...f, depth });
      if (f.type === 'folder') walk(f.id, depth + 1);
    });
  };
  walk(null, 0);
  return out;
}

// A read-only look inside a room from the dashboard: its files and the first
// lines of one, plus the two things you usually do next.
export default function RoomPeek({ room }) {
  const files = useMemo(() => flattenTree(Array.isArray(room.files) ? room.files : []), [room.files]);
  const firstFile = files.find((f) => f.type === 'file');
  const [selectedId, setSelectedId] = useState(room.activeFileId || firstFile?.id || null);
  const selected = files.find((f) => f.id === selectedId && f.type === 'file') || firstFile;
  const [copyState, setCopyState] = useState('');

  const lines = String(selected?.content || '').split(/\r?\n/);
  const shown = lines.slice(0, PREVIEW_LINES);

  async function copyInvite() {
    try {
      setCopyState('working');
      const { inviteToken } = await createInviteLink(room.roomId);
      const link = `${window.location.origin}/room/${room.roomId}?invite=${encodeURIComponent(inviteToken)}`;
      const ok = await copyText(link);
      setCopyState(ok ? 'copied' : 'failed');
    } catch {
      setCopyState('failed');
    }
    window.setTimeout(() => setCopyState(''), 2200);
  }

  return (
    <div className="peek" data-ui>
      <div className="peek-files" role="list" aria-label={`Files in ${room.roomName || room.roomId}`}>
        {files.length === 0 && <p className="peek-empty">No files yet.</p>}
        {files.map((f) => (
          <button
            key={f.id}
            type="button"
            role="listitem"
            className={`peek-file ${f.type === 'folder' ? 'peek-file--folder' : ''} ${selected?.id === f.id ? 'is-active' : ''}`}
            style={{ paddingLeft: 12 + f.depth * 16 }}
            disabled={f.type === 'folder'}
            onClick={() => setSelectedId(f.id)}
          >
            {f.name}
            {f.type === 'folder' ? '/' : ''}
          </button>
        ))}
      </div>
      <div className="peek-code">
        <div className="peek-code-head">
          <span>{selected ? selected.name : 'Nothing to preview'}</span>
          {lines.length > PREVIEW_LINES && <span>{lines.length} lines</span>}
        </div>
        <pre>
          <code>
            {shown.map((line, i) => (
              <span key={i} className="peek-line">
                <span className="peek-ln">{i + 1}</span>
                {line || ' '}
              </span>
            ))}
          </code>
        </pre>
        <div className="peek-actions">
          <Link to={`/room/${room.roomId}`} className="lp-btn">Open room</Link>
          <button type="button" className="peek-btn" onClick={copyInvite} disabled={copyState === 'working'}>
            {copyState === 'copied' ? 'Invite link copied' : copyState === 'failed' ? 'Could not copy' : 'Copy invite link'}
          </button>
        </div>
      </div>
    </div>
  );
}
