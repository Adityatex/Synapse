'use strict';

const { logger } = require('./logger');

/**
 * A file's version history (P2-15) is the collab server's: it holds the snapshots and applies a
 * restore to the live document. The api only passes the request on with the caller's own token, so
 * collab applies the same membership rule as everywhere else and there is no service secret, and
 * gives the caller its answer unchanged (status, error text, and for a lock the holder's name).
 */

const READ_TIMEOUT_MS = 8000;
// A restore may have to open a room nobody has loaded and wait for other replicas to answer its sync.
const RESTORE_TIMEOUT_MS = 15000;

function collabBaseUrl() {
  return String(process.env.COLLAB_INTERNAL_URL || '').trim().replace(/\/+$/, '');
}

/**
 * @param {{ method: 'GET' | 'POST', roomId: string, seq?: string | number, fileId?: string, limit?: string | number,
 *           restore?: boolean, authorization?: string }} request
 * @returns {Promise<{ status: number, body: object }>}
 */
async function requestRoomHistory({ method, roomId, seq, fileId, limit, restore = false, authorization }) {
  const base = collabBaseUrl();
  if (!base) return { status: 503, body: { error: 'Version history is not available.' } };

  const id = encodeURIComponent(String(roomId || '').trim().toUpperCase());
  let path = `/rooms/${id}/history`;
  if (seq !== undefined) path += `/${encodeURIComponent(String(seq))}${restore ? '/restore' : ''}`;
  const query = new URLSearchParams();
  if (!restore && fileId) query.set('fileId', fileId);
  if (limit !== undefined && limit !== '') query.set('limit', String(limit));
  const qs = query.toString();

  try {
    const response = await fetch(`${base}${path}${qs ? `?${qs}` : ''}`, {
      method,
      headers: {
        ...(authorization ? { Authorization: authorization } : {}),
        ...(restore ? { 'Content-Type': 'application/json' } : {}),
      },
      body: restore ? JSON.stringify({ fileId }) : undefined,
      signal: AbortSignal.timeout(restore ? RESTORE_TIMEOUT_MS : READ_TIMEOUT_MS),
    });
    let body;
    try {
      body = await response.json();
    } catch {
      body = { error: 'Unexpected answer from the history service.' };
    }
    return { status: response.status, body };
  } catch (err) {
    logger.warn({ err: err.message || String(err), roomId }, 'room history request to collab failed');
    return { status: 503, body: { error: 'Version history is unavailable right now. Try again in a moment.' } };
  }
}

module.exports = { requestRoomHistory };
