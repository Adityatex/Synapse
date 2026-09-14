const { rateLimit, ipKeyGenerator } = require('express-rate-limit');

/**
 * P0-02 — Centralized rate limits (memory store for now).
 *
 * Roadmap limits:
 * - OTP request: 3 / 10 min per email + 10 / hour per IP
 * - OTP verify: 10 / 10 min
 * - login: 10 / 15 min per IP
 * - execute: 20 / min per user
 * - AI chat: 30 / hour per user
 * - global: 300 / min per IP
 *
 * All limiters respond with HTTP 429 + Retry-After (via standardHeaders).
 * MemoryStore is the default — sufficient for single-instance Phase 0.
 * Will move to Redis in Phase 2 (P2-02).
 */

function normalizeEmail(value) {
  return String(value || '').toLowerCase().trim();
}

function emailKeyGenerator(req) {
  const email = normalizeEmail(req.body && req.body.email);
  if (email) {
    return `email:${email}`;
  }
  return ipKeyGenerator(req.ip);
}

function userKeyGenerator(req) {
  const userId = req.user && (req.user.userId || req.user.id);
  if (userId) {
    return `user:${userId}`;
  }
  return ipKeyGenerator(req.ip);
}

// P0-07: rate-limit rejections use the same public envelope as every other
// error ({ error, requestId }). RateLimit-*/Retry-After headers are still set
// by express-rate-limit before this handler runs.
function limitHandler(retryHint) {
  return (req, res) => {
    res.status(429).json({
      error: `Too many requests. Please try again in ${retryHint}.`,
      requestId: req.id,
    });
  };
}

const otpRequestByEmailLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutes
  limit: 3,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: emailKeyGenerator,
  handler: limitHandler('10 minutes'),
});

const otpRequestByIpLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(req.ip),
  handler: limitHandler('an hour'),
});

const otpVerifyLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutes
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  // Key by email when present so brute-force against one account is capped,
  // otherwise fall back to IP.
  keyGenerator: emailKeyGenerator,
  handler: limitHandler('10 minutes'),
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(req.ip),
  handler: limitHandler('15 minutes'),
});

const executeLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: userKeyGenerator,
  handler: limitHandler('a minute'),
});

const aiChatLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: userKeyGenerator,
  handler: limitHandler('an hour'),
});

const globalLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(req.ip),
  handler: limitHandler('a minute'),
});

module.exports = {
  otpRequestByEmailLimiter,
  otpRequestByIpLimiter,
  otpVerifyLimiter,
  loginLimiter,
  executeLimiter,
  aiChatLimiter,
  globalLimiter,
};
