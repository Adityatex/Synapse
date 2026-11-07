'use strict';

const { logger } = require('./logger');

/**
 * A room's files as plain text, read from the collab server (P2-09). The api never reads the text
 * from `Room.files` (the seed a room was made from, which nothing updates any more) and never trusts the text
 * a client sends when the room can be asked instead.
 *
 * The collab server checks that the caller is a member, so the caller's own token is passed on.
 * Any failure (not configured, not a member, collab down, slow) gives `null`, and the callers fall
 * back to what the client sent, which is what the person is looking at.
 */

const DEFAULT_TIMEOUT_MS = 3000;

function collabBaseUrl() {
  return String(process.env.COLLAB_INTERNAL_URL || '').trim().replace(/\/+$/, '');
}

/**
 * @param {string} roomId
 * @param {{ authorization?: string, fresh?: boolean, timeoutMs?: number }} [options]
 *   `fresh` skips the 5 s cache: use it when the result must be what is on screen right now.
 * @returns {Promise<{ files: Array<{id: string, name: string, path: string, content: string}>, content: string, source: string } | null>}
 */
async function getRoomFiles(roomId, { authorization, fresh = false, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const base = collabBaseUrl();
  const id = String(roomId || '').trim().toUpperCase();
  if (!base || !id || !authorization) return null;

  try {
    const response = await fetch(`${base}/rooms/${encodeURIComponent(id)}/files${fresh ? '?fresh=1' : ''}`, {
      headers: { Authorization: authorization },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      logger.info({ status: response.status, roomId: id }, 'room files unavailable from collab');
      return null;
    }
    const body = await response.json();
    if (!Array.isArray(body.files)) return null;
    return { files: body.files, content: String(body.content ?? ''), source: String(body.source || '') };
  } catch (err) {
    logger.warn({ err: err.message || String(err), roomId: id }, 'room files request to collab failed');
    return null;
  }
}

/**
 * Which source code to run. When the request names a room and a file, the text comes from the
 * room's live document; otherwise (or if the room cannot be read and the client sent its own copy)
 * it is the client's text.
 *
 * @returns {Promise<{ ok: true, source_code: string, from: 'room' | 'client' } | { ok: false, status: number, error: string }>}
 */
async function resolveExecuteSource({ source_code: sent, roomId, fileId }, authorization) {
  if (roomId && fileId) {
    const projection = await getRoomFiles(roomId, { authorization, fresh: true });
    const file = projection?.files.find((candidate) => candidate.id === fileId);
    if (file) {
      return file.content
        ? { ok: true, source_code: file.content, from: 'room' }
        : { ok: false, status: 400, error: 'This file is empty.' };
    }
    if (!sent) {
      return projection
        ? { ok: false, status: 404, error: 'That file is not in the room.' }
        : { ok: false, status: 503, error: 'The room could not be read right now. Try again in a moment.' };
    }
  }
  return sent ? { ok: true, source_code: sent, from: 'client' } : { ok: false, status: 400, error: 'source_code and language_id are required' };
}

/**
 * Neura's context. If the client says which room it is in, the file list and the active file's text
 * come from the room (cached for a few seconds); anything else the client sent is kept.
 */
async function withRoomContext(context, authorization) {
  const roomId = context?.roomId;
  if (typeof roomId !== 'string' || !roomId) return context;

  const projection = await getRoomFiles(roomId, { authorization });
  if (!projection || projection.files.length === 0) return context;

  const activeId = context.activeFile?.id ?? context.activeFileId;
  const active = projection.files.find((file) => file.id === activeId);
  return {
    ...context,
    files: projection.files.map(({ id, name, path }) => ({ id, name, path })),
    activeFile: active ? { id: active.id, name: active.path, content: active.content } : context.activeFile,
  };
}

module.exports = { getRoomFiles, resolveExecuteSource, withRoomContext };
