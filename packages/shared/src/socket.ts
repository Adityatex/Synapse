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
});
export type JoinRoomPayload = z.infer<typeof joinRoomSchema>;

export const codeChangeSchema = z.object({
  roomId: roomIdSchema.optional(),
  fileId: z.string().trim().min(1).max(256),
  // base64-encoded Yjs update
  changes: z.string().min(1).max(2_000_000),
});
export type CodeChangePayload = z.infer<typeof codeChangeSchema>;

export const cursorMoveSchema = z.object({
  roomId: roomIdSchema.optional(),
  position: z.record(z.unknown()),
});
export type CursorMovePayload = z.infer<typeof cursorMoveSchema>;

export const selectionChangeSchema = z.object({
  roomId: roomIdSchema.optional(),
  selectionRange: z.record(z.unknown()),
});
export type SelectionChangePayload = z.infer<typeof selectionChangeSchema>;

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

export const fileLockSchema = z.object({
  roomId: roomIdSchema.optional(),
  fileId: z.string().trim().min(1).max(256),
});
export type FileLockPayload = z.infer<typeof fileLockSchema>;

export const syncRoomStateSchema = z.object({
  files: z
    .array(
      z.object({
        id: z.string().trim().min(1).max(256),
        name: z.string().trim().min(1).max(256),
        type: z.enum(['file', 'folder']).optional().default('file'),
        parentId: z.string().trim().max(256).nullable().optional().default(null),
        order: z.number().optional().default(0),
        content: z.string().max(2_000_000).optional().default(''),
        updatedAt: z.number().optional(),
      })
    )
    .max(500)
    .optional(),
  activeFileId: z.string().trim().max(256).optional(),
  openTabs: z.array(z.string().trim().max(256)).max(100).optional(),
});
export type SyncRoomStatePayload = z.infer<typeof syncRoomStateSchema>;

export const autosaveSchema = z.object({
  roomId: roomIdSchema.optional(),
  fileId: z.string().trim().min(1).max(256),
  content: z.string().max(2_000_000),
});
export type AutosavePayload = z.infer<typeof autosaveSchema>;

export const saveVersionSchema = autosaveSchema;
export type SaveVersionPayload = z.infer<typeof saveVersionSchema>;

export { userIdSchema };
