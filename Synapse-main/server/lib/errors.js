'use strict';

// P1-08: consistent API envelope + operational error class.
// Success: { success: true, data, requestId }
// Failure: { success: false, error: { message, code?, details? }, requestId }
// Adoption is incremental: new code (validation, health meta) uses ok()/fail();
// legacy routes keep their shapes until the client migrates (see docs/ARCHITECTURE.md).

class AppError extends Error {
  constructor(message, { status = 500, code = 'INTERNAL', details, isOperational = true } = {}) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.isOperational = isOperational;
    Error.captureStackTrace?.(this, AppError);
  }

  static badRequest(message = 'Invalid request.', details) {
    return new AppError(message, { status: 400, code: 'BAD_REQUEST', details });
  }

  static unauthorized(message = 'Authentication required.') {
    return new AppError(message, { status: 401, code: 'UNAUTHORIZED' });
  }

  static forbidden(message = 'Forbidden.') {
    return new AppError(message, { status: 403, code: 'FORBIDDEN' });
  }

  static notFound(message = 'Not found.') {
    return new AppError(message, { status: 404, code: 'NOT_FOUND' });
  }

  static conflict(message = 'Conflict.') {
    return new AppError(message, { status: 409, code: 'CONFLICT' });
  }

  static tooMany(message = 'Too many requests.') {
    return new AppError(message, { status: 429, code: 'RATE_LIMITED' });
  }
}

function ok(res, req, data, status = 200) {
  return res.status(status).json({
    success: true,
    data,
    ...(req?.id ? { requestId: req.id } : {}),
  });
}

function fail(res, req, err) {
  const status = err?.status && err.status >= 400 && err.status < 600 ? err.status : 500;
  const message =
    status >= 500 ? 'Something went wrong. Please try again later.' : err?.message || 'Request failed.';
  return res.status(status).json({
    success: false,
    error: {
      message,
      code: err?.code || (status >= 500 ? 'INTERNAL' : 'REQUEST_FAILED'),
      ...(err?.details !== undefined ? { details: err.details } : {}),
    },
    ...(req?.id ? { requestId: req.id } : {}),
  });
}

function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

module.exports = { AppError, ok, fail, asyncHandler };
