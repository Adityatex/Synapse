import { z } from 'zod';
export declare const apiErrorSchema: z.ZodObject<{
    message: z.ZodString;
    code: z.ZodOptional<z.ZodString>;
    details: z.ZodOptional<z.ZodUnknown>;
}, "strip", z.ZodTypeAny, {
    message: string;
    code?: string | undefined;
    details?: unknown;
}, {
    message: string;
    code?: string | undefined;
    details?: unknown;
}>;
export type ApiErrorBody = z.infer<typeof apiErrorSchema>;
export interface ApiSuccess<T> {
    success: true;
    data: T;
    requestId?: string;
}
export interface ApiFailure {
    success: false;
    error: ApiErrorBody;
    requestId?: string;
}
export type ApiEnvelope<T> = ApiSuccess<T> | ApiFailure;
//# sourceMappingURL=envelope.d.ts.map