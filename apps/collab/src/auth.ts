import jwt from 'jsonwebtoken';
import { z } from 'zod';

/** Same payload the api signs in routes/auth.js (generateToken). */
const tokenPayload = z.object({
  userId: z.string().min(1),
  name: z.string().optional(),
  email: z.string().optional(),
});

export type AuthUser = z.infer<typeof tokenPayload>;

/** Hocuspocus sends `reason` to the client as the permission-denied message. */
export class AuthError extends Error {
  readonly reason: string;

  constructor(message: string) {
    super(message);
    this.name = 'AuthError';
    this.reason = message;
  }
}

/** Identity comes from the token alone (principle 4). */
export function verifyAccessToken(token: string | undefined, secret: string): AuthUser {
  if (!token) throw new AuthError('Authentication required.');
  try {
    return tokenPayload.parse(jwt.verify(token, secret));
  } catch {
    throw new AuthError('Invalid or expired token.');
  }
}

const DOCUMENT_PREFIX = 'room:';
const ROOM_ID = /^[A-Z0-9]{4,32}$/;

export function documentNameFor(roomId: string): string {
  return `${DOCUMENT_PREFIX}${roomId}`;
}

/** `room:abc123` -> `ABC123`. Returns null for anything that isn't a room document. */
export function parseDocumentName(documentName: string): string | null {
  if (!documentName.startsWith(DOCUMENT_PREFIX)) return null;
  const roomId = documentName.slice(DOCUMENT_PREFIX.length).trim().toUpperCase();
  return ROOM_ID.test(roomId) ? roomId : null;
}
