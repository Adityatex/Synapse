import { z } from 'zod';

// Shared primitives
export const emailSchema = z.string().trim().toLowerCase().email().max(254);
export const passwordSchema = z.string().min(6).max(256);
export const nameSchema = z.string().trim().min(1).max(100);
export const otpSchema = z.string().trim().regex(/^\d{4,8}$/, 'OTP must be 4-8 digits');
export const roomIdSchema = z.string().trim().min(4).max(16).regex(/^[A-Z0-9]+$/i, 'Invalid room id');
export const userIdSchema = z.string().trim().min(1).max(128);
export const objectIdSchema = z.string().trim().regex(/^[a-f\d]{24}$/i, 'Invalid id');

// --- Auth ---
export const signupRequestOtpSchema = z.object({
  name: nameSchema,
  email: emailSchema,
  password: passwordSchema,
});
export type SignupRequestOtp = z.infer<typeof signupRequestOtpSchema>;

export const signupVerifyOtpSchema = z.object({
  email: emailSchema,
  otp: otpSchema,
});
export type SignupVerifyOtp = z.infer<typeof signupVerifyOtpSchema>;

export const loginRequestOtpSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(256),
});
export type LoginRequestOtp = z.infer<typeof loginRequestOtpSchema>;

export const loginVerifyOtpSchema = z.object({
  email: emailSchema,
  otp: otpSchema,
});
export type LoginVerifyOtp = z.infer<typeof loginVerifyOtpSchema>;

// --- Execute (Judge0) ---
export const executeSchema = z.object({
  source_code: z.string().min(1).max(200_000),
  language_id: z.coerce.number().int().min(1).max(200),
  stdin: z.string().max(100_000).optional().default(''),
});
export type ExecuteRequest = z.infer<typeof executeSchema>;

// --- AI chat ---
export const aiRoleSchema = z.enum(['user', 'assistant', 'system']);
export const aiHistoryEntrySchema = z.object({
  role: aiRoleSchema,
  content: z.string().trim().min(1).max(8_000),
});
export const aiChatSchema = z.object({
  message: z.string().trim().min(1).max(8_000),
  conversationId: objectIdSchema.optional(),
  history: z.array(aiHistoryEntrySchema).max(20).optional().default([]),
  context: z.record(z.unknown()).optional().default({}),
});
export type AiChatRequest = z.infer<typeof aiChatSchema>;

export const aiSaveMessageSchema = z.object({
  conversationId: objectIdSchema,
  role: aiRoleSchema,
  content: z.string().trim().min(1).max(8_000),
});
export type AiSaveMessage = z.infer<typeof aiSaveMessageSchema>;

// --- Rooms ---
export const createRoomSchema = z.object({
  roomName: z.string().trim().min(1).max(120),
});
export type CreateRoomRequest = z.infer<typeof createRoomSchema>;

export const inviteMemberSchema = z
  .object({
    userId: userIdSchema.optional(),
    email: emailSchema.optional(),
    username: z.string().trim().max(100).optional().default(''),
  })
  .refine((v) => v.userId || v.email, { message: 'userId or email is required' });
export type InviteMemberRequest = z.infer<typeof inviteMemberSchema>;
