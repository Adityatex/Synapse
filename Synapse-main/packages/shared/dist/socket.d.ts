import { z } from 'zod';
import { userIdSchema } from './http';
export declare const joinRoomSchema: z.ZodObject<{
    roomId: z.ZodString;
}, "strip", z.ZodTypeAny, {
    roomId: string;
}, {
    roomId: string;
}>;
export type JoinRoomPayload = z.infer<typeof joinRoomSchema>;
export declare const codeChangeSchema: z.ZodObject<{
    roomId: z.ZodOptional<z.ZodString>;
    fileId: z.ZodString;
    changes: z.ZodString;
}, "strip", z.ZodTypeAny, {
    fileId: string;
    changes: string;
    roomId?: string | undefined;
}, {
    fileId: string;
    changes: string;
    roomId?: string | undefined;
}>;
export type CodeChangePayload = z.infer<typeof codeChangeSchema>;
export declare const cursorMoveSchema: z.ZodObject<{
    roomId: z.ZodOptional<z.ZodString>;
    position: z.ZodRecord<z.ZodString, z.ZodUnknown>;
}, "strip", z.ZodTypeAny, {
    position: Record<string, unknown>;
    roomId?: string | undefined;
}, {
    position: Record<string, unknown>;
    roomId?: string | undefined;
}>;
export type CursorMovePayload = z.infer<typeof cursorMoveSchema>;
export declare const selectionChangeSchema: z.ZodObject<{
    roomId: z.ZodOptional<z.ZodString>;
    selectionRange: z.ZodRecord<z.ZodString, z.ZodUnknown>;
}, "strip", z.ZodTypeAny, {
    selectionRange: Record<string, unknown>;
    roomId?: string | undefined;
}, {
    selectionRange: Record<string, unknown>;
    roomId?: string | undefined;
}>;
export type SelectionChangePayload = z.infer<typeof selectionChangeSchema>;
export declare const chatMessageSchema: z.ZodObject<{
    roomId: z.ZodOptional<z.ZodString>;
    content: z.ZodString;
    type: z.ZodDefault<z.ZodOptional<z.ZodEnum<["user", "system"]>>>;
    replyTo: z.ZodOptional<z.ZodObject<{
        messageId: z.ZodString;
        senderName: z.ZodDefault<z.ZodOptional<z.ZodString>>;
        content: z.ZodDefault<z.ZodOptional<z.ZodString>>;
    }, "strip", z.ZodTypeAny, {
        content: string;
        messageId: string;
        senderName: string;
    }, {
        messageId: string;
        content?: string | undefined;
        senderName?: string | undefined;
    }>>;
}, "strip", z.ZodTypeAny, {
    type: "user" | "system";
    content: string;
    roomId?: string | undefined;
    replyTo?: {
        content: string;
        messageId: string;
        senderName: string;
    } | undefined;
}, {
    content: string;
    type?: "user" | "system" | undefined;
    roomId?: string | undefined;
    replyTo?: {
        messageId: string;
        content?: string | undefined;
        senderName?: string | undefined;
    } | undefined;
}>;
export type ChatMessagePayload = z.infer<typeof chatMessageSchema>;
export declare const chatHistoryRequestSchema: z.ZodObject<{
    roomId: z.ZodOptional<z.ZodString>;
} & {
    limit: z.ZodDefault<z.ZodOptional<z.ZodNumber>>;
    beforeTimestamp: z.ZodUnion<[z.ZodOptional<z.ZodString>, z.ZodOptional<z.ZodNumber>]>;
}, "strip", z.ZodTypeAny, {
    limit: number;
    roomId?: string | undefined;
    beforeTimestamp?: string | number | undefined;
}, {
    roomId?: string | undefined;
    limit?: number | undefined;
    beforeTimestamp?: string | number | undefined;
}>;
export type ChatHistoryRequest = z.infer<typeof chatHistoryRequestSchema>;
export declare const editChatMessageSchema: z.ZodObject<{
    messageId: z.ZodString;
    content: z.ZodString;
}, "strip", z.ZodTypeAny, {
    content: string;
    messageId: string;
}, {
    content: string;
    messageId: string;
}>;
export type EditChatMessagePayload = z.infer<typeof editChatMessageSchema>;
export declare const deleteChatMessageSchema: z.ZodObject<{
    messageId: z.ZodString;
}, "strip", z.ZodTypeAny, {
    messageId: string;
}, {
    messageId: string;
}>;
export type DeleteChatMessagePayload = z.infer<typeof deleteChatMessageSchema>;
export declare const pinChatMessageSchema: z.ZodObject<{
    messageId: z.ZodString;
}, "strip", z.ZodTypeAny, {
    messageId: string;
}, {
    messageId: string;
}>;
export type PinChatMessagePayload = z.infer<typeof pinChatMessageSchema>;
export declare const reactChatMessageSchema: z.ZodObject<{
    messageId: z.ZodString;
    emoji: z.ZodString;
}, "strip", z.ZodTypeAny, {
    messageId: string;
    emoji: string;
}, {
    messageId: string;
    emoji: string;
}>;
export type ReactChatMessagePayload = z.infer<typeof reactChatMessageSchema>;
export declare const searchChatMessagesSchema: z.ZodObject<{
    roomId: z.ZodOptional<z.ZodString>;
    query: z.ZodString;
}, "strip", z.ZodTypeAny, {
    query: string;
    roomId?: string | undefined;
}, {
    query: string;
    roomId?: string | undefined;
}>;
export type SearchChatMessagesPayload = z.infer<typeof searchChatMessagesSchema>;
export declare const fileLockSchema: z.ZodObject<{
    roomId: z.ZodOptional<z.ZodString>;
    fileId: z.ZodString;
}, "strip", z.ZodTypeAny, {
    fileId: string;
    roomId?: string | undefined;
}, {
    fileId: string;
    roomId?: string | undefined;
}>;
export type FileLockPayload = z.infer<typeof fileLockSchema>;
export declare const syncRoomStateSchema: z.ZodObject<{
    files: z.ZodOptional<z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        name: z.ZodString;
        type: z.ZodDefault<z.ZodOptional<z.ZodEnum<["file", "folder"]>>>;
        parentId: z.ZodDefault<z.ZodOptional<z.ZodNullable<z.ZodString>>>;
        order: z.ZodDefault<z.ZodOptional<z.ZodNumber>>;
        content: z.ZodDefault<z.ZodOptional<z.ZodString>>;
        updatedAt: z.ZodOptional<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        type: "file" | "folder";
        name: string;
        content: string;
        id: string;
        parentId: string | null;
        order: number;
        updatedAt?: number | undefined;
    }, {
        name: string;
        id: string;
        type?: "file" | "folder" | undefined;
        content?: string | undefined;
        parentId?: string | null | undefined;
        order?: number | undefined;
        updatedAt?: number | undefined;
    }>, "many">>;
    activeFileId: z.ZodOptional<z.ZodString>;
    openTabs: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
}, "strip", z.ZodTypeAny, {
    files?: {
        type: "file" | "folder";
        name: string;
        content: string;
        id: string;
        parentId: string | null;
        order: number;
        updatedAt?: number | undefined;
    }[] | undefined;
    activeFileId?: string | undefined;
    openTabs?: string[] | undefined;
}, {
    files?: {
        name: string;
        id: string;
        type?: "file" | "folder" | undefined;
        content?: string | undefined;
        parentId?: string | null | undefined;
        order?: number | undefined;
        updatedAt?: number | undefined;
    }[] | undefined;
    activeFileId?: string | undefined;
    openTabs?: string[] | undefined;
}>;
export type SyncRoomStatePayload = z.infer<typeof syncRoomStateSchema>;
export declare const autosaveSchema: z.ZodObject<{
    roomId: z.ZodOptional<z.ZodString>;
    fileId: z.ZodString;
    content: z.ZodString;
}, "strip", z.ZodTypeAny, {
    content: string;
    fileId: string;
    roomId?: string | undefined;
}, {
    content: string;
    fileId: string;
    roomId?: string | undefined;
}>;
export type AutosavePayload = z.infer<typeof autosaveSchema>;
export declare const saveVersionSchema: z.ZodObject<{
    roomId: z.ZodOptional<z.ZodString>;
    fileId: z.ZodString;
    content: z.ZodString;
}, "strip", z.ZodTypeAny, {
    content: string;
    fileId: string;
    roomId?: string | undefined;
}, {
    content: string;
    fileId: string;
    roomId?: string | undefined;
}>;
export type SaveVersionPayload = z.infer<typeof saveVersionSchema>;
export { userIdSchema };
//# sourceMappingURL=socket.d.ts.map