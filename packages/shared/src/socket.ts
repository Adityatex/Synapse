import { z } from 'zod';
import { roomIdSchema, userIdSchema } from './http';

// Socket payloads are validated server-side with `validateSocketPayload`
// (P1-05). Identity fields (userId/username) are never accepted from the
// payload — they always come from the verified JWT (P0-03).

const roomRefSchema = z.object({
  roomId: roomIdSchema.optional(),
});

export const joinRoomSchema = z.object({
  roomId: roomIdSchema,
  // P2-10: a client that edits through the collab server joins for chat only.
  collab: z.boolean().optional(),
});
export type JoinRoomPayload = z.infer<typeof joinRoomSchema>;

export const chatMessageSchema = z.object({
  roomId: roomIdSchema.optional(),
  content: z.string().trim().min(1).max(8_000),
  type: z.enum(['user', 'system']).optional().default('user'),
  replyTo: z
    .object({
      messageId: z.string().trim().min(1).max(128),
      senderName: z.string().max(100).optional().default(''),
      content: z.string().max(2_000).optional().default(''),
    })
    .optional(),
});
export type ChatMessagePayload = z.infer<typeof chatMessageSchema>;

export const chatHistoryRequestSchema = roomRefSchema.extend({
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
  beforeTimestamp: z.string().datetime().optional().or(z.coerce.number().positive().optional()),
});
export type ChatHistoryRequest = z.infer<typeof chatHistoryRequestSchema>;

export const editChatMessageSchema = z.object({
  messageId: z.string().trim().min(1).max(128),
  content: z.string().trim().min(1).max(8_000),
});
export type EditChatMessagePayload = z.infer<typeof editChatMessageSchema>;

export const deleteChatMessageSchema = z.object({
  messageId: z.string().trim().min(1).max(128),
});
export type DeleteChatMessagePayload = z.infer<typeof deleteChatMessageSchema>;

export const pinChatMessageSchema = deleteChatMessageSchema;
export type PinChatMessagePayload = z.infer<typeof pinChatMessageSchema>;

export const reactChatMessageSchema = z.object({
  messageId: z.string().trim().min(1).max(128),
  emoji: z.string().trim().min(1).max(16),
});
export type ReactChatMessagePayload = z.infer<typeof reactChatMessageSchema>;

export const searchChatMessagesSchema = z.object({
  roomId: roomIdSchema.optional(),
  query: z.string().trim().min(1).max(200),
});
export type SearchChatMessagesPayload = z.infer<typeof searchChatMessagesSchema>;

export { userIdSchema };
