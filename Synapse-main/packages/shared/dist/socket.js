"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.userIdSchema = exports.saveVersionSchema = exports.autosaveSchema = exports.syncRoomStateSchema = exports.fileLockSchema = exports.searchChatMessagesSchema = exports.reactChatMessageSchema = exports.pinChatMessageSchema = exports.deleteChatMessageSchema = exports.editChatMessageSchema = exports.chatHistoryRequestSchema = exports.chatMessageSchema = exports.selectionChangeSchema = exports.cursorMoveSchema = exports.codeChangeSchema = exports.joinRoomSchema = void 0;
const zod_1 = require("zod");
const http_1 = require("./http");
Object.defineProperty(exports, "userIdSchema", { enumerable: true, get: function () { return http_1.userIdSchema; } });
// Socket payloads are validated server-side with `validateSocketPayload`
// (P1-05). Identity fields (userId/username) are never accepted from the
// payload — they always come from the verified JWT (P0-03).
const roomRefSchema = zod_1.z.object({
    roomId: http_1.roomIdSchema.optional(),
});
exports.joinRoomSchema = zod_1.z.object({
    roomId: http_1.roomIdSchema,
});
exports.codeChangeSchema = zod_1.z.object({
    roomId: http_1.roomIdSchema.optional(),
    fileId: zod_1.z.string().trim().min(1).max(256),
    // base64-encoded Yjs update
    changes: zod_1.z.string().min(1).max(2_000_000),
});
exports.cursorMoveSchema = zod_1.z.object({
    roomId: http_1.roomIdSchema.optional(),
    position: zod_1.z.record(zod_1.z.unknown()),
});
exports.selectionChangeSchema = zod_1.z.object({
    roomId: http_1.roomIdSchema.optional(),
    selectionRange: zod_1.z.record(zod_1.z.unknown()),
});
exports.chatMessageSchema = zod_1.z.object({
    roomId: http_1.roomIdSchema.optional(),
    content: zod_1.z.string().trim().min(1).max(8_000),
    type: zod_1.z.enum(['user', 'system']).optional().default('user'),
    replyTo: zod_1.z
        .object({
        messageId: zod_1.z.string().trim().min(1).max(128),
        senderName: zod_1.z.string().max(100).optional().default(''),
        content: zod_1.z.string().max(2_000).optional().default(''),
    })
        .optional(),
});
exports.chatHistoryRequestSchema = roomRefSchema.extend({
    limit: zod_1.z.coerce.number().int().min(1).max(200).optional().default(50),
    beforeTimestamp: zod_1.z.string().datetime().optional().or(zod_1.z.coerce.number().positive().optional()),
});
exports.editChatMessageSchema = zod_1.z.object({
    messageId: zod_1.z.string().trim().min(1).max(128),
    content: zod_1.z.string().trim().min(1).max(8_000),
});
exports.deleteChatMessageSchema = zod_1.z.object({
    messageId: zod_1.z.string().trim().min(1).max(128),
});
exports.pinChatMessageSchema = exports.deleteChatMessageSchema;
exports.reactChatMessageSchema = zod_1.z.object({
    messageId: zod_1.z.string().trim().min(1).max(128),
    emoji: zod_1.z.string().trim().min(1).max(16),
});
exports.searchChatMessagesSchema = zod_1.z.object({
    roomId: http_1.roomIdSchema.optional(),
    query: zod_1.z.string().trim().min(1).max(200),
});
exports.fileLockSchema = zod_1.z.object({
    roomId: http_1.roomIdSchema.optional(),
    fileId: zod_1.z.string().trim().min(1).max(256),
});
exports.syncRoomStateSchema = zod_1.z.object({
    files: zod_1.z
        .array(zod_1.z.object({
        id: zod_1.z.string().trim().min(1).max(256),
        name: zod_1.z.string().trim().min(1).max(256),
        type: zod_1.z.enum(['file', 'folder']).optional().default('file'),
        parentId: zod_1.z.string().trim().max(256).nullable().optional().default(null),
        order: zod_1.z.number().optional().default(0),
        content: zod_1.z.string().max(2_000_000).optional().default(''),
        updatedAt: zod_1.z.number().optional(),
    }))
        .max(500)
        .optional(),
    activeFileId: zod_1.z.string().trim().max(256).optional(),
    openTabs: zod_1.z.array(zod_1.z.string().trim().max(256)).max(100).optional(),
});
exports.autosaveSchema = zod_1.z.object({
    roomId: http_1.roomIdSchema.optional(),
    fileId: zod_1.z.string().trim().min(1).max(256),
    content: zod_1.z.string().max(2_000_000),
});
exports.saveVersionSchema = exports.autosaveSchema;
//# sourceMappingURL=socket.js.map