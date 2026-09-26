"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.apiErrorSchema = void 0;
const zod_1 = require("zod");
// P1-08: consistent API envelope. Success: { success: true, data, requestId }.
// Failure: { success: false, error: { message, code?, details? }, requestId }.
exports.apiErrorSchema = zod_1.z.object({
    message: zod_1.z.string(),
    code: zod_1.z.string().optional(),
    details: zod_1.z.unknown().optional(),
});
//# sourceMappingURL=envelope.js.map