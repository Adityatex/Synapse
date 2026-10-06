import { z } from 'zod';

// P1-08: consistent API envelope. Success: { success: true, data, requestId }.
// Failure: { success: false, error: { message, code?, details? }, requestId }.
export const apiErrorSchema = z.object({
  message: z.string(),
  code: z.string().optional(),
  details: z.unknown().optional(),
});
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
