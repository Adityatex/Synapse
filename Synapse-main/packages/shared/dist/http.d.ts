import { z } from 'zod';
export declare const emailSchema: z.ZodString;
export declare const passwordSchema: z.ZodString;
export declare const nameSchema: z.ZodString;
export declare const otpSchema: z.ZodString;
export declare const roomIdSchema: z.ZodString;
export declare const userIdSchema: z.ZodString;
export declare const objectIdSchema: z.ZodString;
export declare const signupRequestOtpSchema: z.ZodObject<{
    name: z.ZodString;
    email: z.ZodString;
    password: z.ZodString;
}, "strip", z.ZodTypeAny, {
    name: string;
    email: string;
    password: string;
}, {
    name: string;
    email: string;
    password: string;
}>;
export type SignupRequestOtp = z.infer<typeof signupRequestOtpSchema>;
export declare const signupVerifyOtpSchema: z.ZodObject<{
    email: z.ZodString;
    otp: z.ZodString;
}, "strip", z.ZodTypeAny, {
    email: string;
    otp: string;
}, {
    email: string;
    otp: string;
}>;
export type SignupVerifyOtp = z.infer<typeof signupVerifyOtpSchema>;
export declare const loginRequestOtpSchema: z.ZodObject<{
    email: z.ZodString;
    password: z.ZodString;
}, "strip", z.ZodTypeAny, {
    email: string;
    password: string;
}, {
    email: string;
    password: string;
}>;
export type LoginRequestOtp = z.infer<typeof loginRequestOtpSchema>;
export declare const loginVerifyOtpSchema: z.ZodObject<{
    email: z.ZodString;
    otp: z.ZodString;
}, "strip", z.ZodTypeAny, {
    email: string;
    otp: string;
}, {
    email: string;
    otp: string;
}>;
export type LoginVerifyOtp = z.infer<typeof loginVerifyOtpSchema>;
export declare const executeSchema: z.ZodObject<{
    source_code: z.ZodString;
    language_id: z.ZodNumber;
    stdin: z.ZodDefault<z.ZodOptional<z.ZodString>>;
}, "strip", z.ZodTypeAny, {
    source_code: string;
    language_id: number;
    stdin: string;
}, {
    source_code: string;
    language_id: number;
    stdin?: string | undefined;
}>;
export type ExecuteRequest = z.infer<typeof executeSchema>;
export declare const aiRoleSchema: z.ZodEnum<["user", "assistant", "system"]>;
export declare const aiHistoryEntrySchema: z.ZodObject<{
    role: z.ZodEnum<["user", "assistant", "system"]>;
    content: z.ZodString;
}, "strip", z.ZodTypeAny, {
    role: "user" | "assistant" | "system";
    content: string;
}, {
    role: "user" | "assistant" | "system";
    content: string;
}>;
export declare const aiChatSchema: z.ZodObject<{
    message: z.ZodString;
    conversationId: z.ZodOptional<z.ZodString>;
    history: z.ZodDefault<z.ZodOptional<z.ZodArray<z.ZodObject<{
        role: z.ZodEnum<["user", "assistant", "system"]>;
        content: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        role: "user" | "assistant" | "system";
        content: string;
    }, {
        role: "user" | "assistant" | "system";
        content: string;
    }>, "many">>>;
    context: z.ZodDefault<z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>>;
}, "strip", z.ZodTypeAny, {
    message: string;
    history: {
        role: "user" | "assistant" | "system";
        content: string;
    }[];
    context: Record<string, unknown>;
    conversationId?: string | undefined;
}, {
    message: string;
    conversationId?: string | undefined;
    history?: {
        role: "user" | "assistant" | "system";
        content: string;
    }[] | undefined;
    context?: Record<string, unknown> | undefined;
}>;
export type AiChatRequest = z.infer<typeof aiChatSchema>;
export declare const aiSaveMessageSchema: z.ZodObject<{
    conversationId: z.ZodString;
    role: z.ZodEnum<["user", "assistant", "system"]>;
    content: z.ZodString;
}, "strip", z.ZodTypeAny, {
    role: "user" | "assistant" | "system";
    content: string;
    conversationId: string;
}, {
    role: "user" | "assistant" | "system";
    content: string;
    conversationId: string;
}>;
export type AiSaveMessage = z.infer<typeof aiSaveMessageSchema>;
export declare const createRoomSchema: z.ZodObject<{
    roomName: z.ZodString;
}, "strip", z.ZodTypeAny, {
    roomName: string;
}, {
    roomName: string;
}>;
export type CreateRoomRequest = z.infer<typeof createRoomSchema>;
export declare const inviteMemberSchema: z.ZodEffects<z.ZodObject<{
    userId: z.ZodOptional<z.ZodString>;
    email: z.ZodOptional<z.ZodString>;
    username: z.ZodDefault<z.ZodOptional<z.ZodString>>;
}, "strip", z.ZodTypeAny, {
    username: string;
    email?: string | undefined;
    userId?: string | undefined;
}, {
    email?: string | undefined;
    userId?: string | undefined;
    username?: string | undefined;
}>, {
    username: string;
    email?: string | undefined;
    userId?: string | undefined;
}, {
    email?: string | undefined;
    userId?: string | undefined;
    username?: string | undefined;
}>;
export type InviteMemberRequest = z.infer<typeof inviteMemberSchema>;
//# sourceMappingURL=http.d.ts.map