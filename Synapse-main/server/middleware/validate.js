'use strict';

// P1-05: validation middleware for Express routes + socket handlers,
// backed by @synapse/shared zod contracts (P1-04).
// HTTP: validateBody(schema) → 400 { success:false, error:{...}, requestId }.
// Sockets: validateSocketPayload(schema, payload) → { ok, data } / { ok:false, error }.

const { AppError, fail } = require('../lib/errors');

let shared;
try {
  // eslint-disable-next-line global-require, import/no-unresolved
  shared = require('@synapse/shared');
} catch {
  shared = null;
}

function getSchema(name) {
  if (shared && shared[name]) return shared[name];
  return null;
}

function formatZodIssues(error) {
  if (!error || !Array.isArray(error.issues)) return undefined;
  return error.issues.map((i) => ({
    path: Array.isArray(i.path) ? i.path.join('.') : String(i.path || ''),
    message: i.message,
    code: i.code,
  }));
}

function validateBody(schemaOrName) {
  return (req, res, next) => {
    const schema =
      typeof schemaOrName === 'string' ? getSchema(schemaOrName) : schemaOrName;
    if (!schema) return next();
    const parsed = schema.safeParse(req.body);
    if (parsed.success) {
      req.validatedBody = parsed.data;
      return next();
    }
    return fail(
      res,
      req,
      AppError.badRequest('Invalid request body.', formatZodIssues(parsed.error))
    );
  };
}

function validateSocketPayload(schemaOrName, payload) {
  const schema = typeof schemaOrName === 'string' ? getSchema(schemaOrName) : schemaOrName;
  if (!schema) return { ok: true, data: payload };
  const parsed = schema.safeParse(payload || {});
  if (parsed.success) return { ok: true, data: parsed.data };
  return { ok: false, error: 'Invalid payload.', details: formatZodIssues(parsed.error) };
}

module.exports = { validateBody, validateSocketPayload, formatZodIssues };
