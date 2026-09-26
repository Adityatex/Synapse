"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.inviteMemberSchema = exports.createRoomSchema = exports.aiSaveMessageSchema = exports.aiChatSchema = exports.aiHistoryEntrySchema = exports.aiRoleSchema = exports.executeSchema = exports.loginVerifyOtpSchema = exports.loginRequestOtpSchema = exports.signupVerifyOtpSchema = exports.signupRequestOtpSchema = exports.objectIdSchema = exports.userIdSchema = exports.roomIdSchema = exports.otpSchema = exports.nameSchema = exports.passwordSchema = exports.emailSchema = void 0;
const zod_1 = require("zod");
// Shared primitives
exports.emailSchema = zod_1.z.string().trim().toLowerCase().email().max(254);
exports.passwordSchema = zod_1.z.string().min(6).max(256);
exports.nameSchema = zod_1.z.string().trim().min(1).max(100);
exports.otpSchema = zod_1.z.string().trim().regex(/^\d{4,8}$/, 'OTP must be 4-8 digits');
exports.roomIdSchema = zod_1.z.string().trim().min(4).max(16).regex(/^[A-Z0-9]+$/i, 'Invalid room id');
exports.userIdSchema = zod_1.z.string().trim().min(1).max(128);
exports.objectIdSchema = zod_1.z.string().trim().regex(/^[a-f\d]{24}$/i, 'Invalid id');
// --- Auth ---
exports.signupRequestOtpSchema = zod_1.z.object({
    name: exports.nameSchema,
    email: exports.emailSchema,
    password: exports.passwordSchema,
});
exports.signupVerifyOtpSchema = zod_1.z.object({
    email: exports.emailSchema,
    otp: exports.otpSchema,
});
exports.loginRequestOtpSchema = zod_1.z.object({
    email: exports.emailSchema,
    password: zod_1.z.string().min(1).max(256),
});
exports.loginVerifyOtpSchema = zod_1.z.object({
    email: exports.emailSchema,
    otp: exports.otpSchema,
});
// --- Execute (Judge0) ---
exports.executeSchema = zod_1.z.object({
    source_code: zod_1.z.string().min(1).max(200_000),
    language_id: zod_1.z.coerce.number().int().min(1).max(200),
    stdin: zod_1.z.string().max(100_000).optional().default(''),
});
// --- AI chat ---
exports.aiRoleSchema = zod_1.z.enum(['user', 'assistant', 'system']);
exports.aiHistoryEntrySchema = zod_1.z.object({
    role: exports.aiRoleSchema,
    content: zod_1.z.string().trim().min(1).max(8_000),
});
exports.aiChatSchema = zod_1.z.object({
    message: zod_1.z.string().trim().min(1).max(8_000),
    conversationId: exports.objectIdSchema.optional(),
    history: zod_1.z.array(exports.aiHistoryEntrySchema).max(20).optional().default([]),
    context: zod_1.z.record(zod_1.z.unknown()).optional().default({}),
});
exports.aiSaveMessageSchema = zod_1.z.object({
    conversationId: exports.objectIdSchema,
    role: exports.aiRoleSchema,
    content: zod_1.z.string().trim().min(1).max(8_000),
});
// --- Rooms ---
exports.createRoomSchema = zod_1.z.object({
    roomName: zod_1.z.string().trim().min(1).max(120),
});
exports.inviteMemberSchema = zod_1.z
    .object({
    userId: exports.userIdSchema.optional(),
    email: exports.emailSchema.optional(),
    username: zod_1.z.string().trim().max(100).optional().default(''),
})
    .refine((v) => v.userId || v.email, { message: 'userId or email is required' });
//# sourceMappingURL=http.js.map