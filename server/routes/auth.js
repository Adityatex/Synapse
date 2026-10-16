const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const otpGenerator = require('otp-generator');
const User = require('../models/User');
const OtpVerification = require('../models/OtpVerification');
const authMiddleware = require('../middleware/auth');
const { logger } = require('../lib/logger');
const { captureException } = require('../lib/sentry');
const { validateBody } = require('../middleware/validate');
const {
  otpRequestByEmailLimiter,
  otpRequestByIpLimiter,
  otpVerifyLimiter,
  loginLimiter,
} = require('../middleware/rateLimits');
const { sendOtpEmail } = require('../services/emailService');

const router = express.Router();
const OTP_EXPIRY_MINUTES = Number(process.env.OTP_EXPIRY_MINUTES || 10);
const MAX_OTP_ATTEMPTS = Number(process.env.OTP_MAX_ATTEMPTS || 5);

function ensureDatabaseReady(res) {
  if (require('mongoose').connection.readyState === 1) {
    return true;
  }

  res.status(503).json({
    error: 'Authentication is temporarily unavailable because the database is disconnected. Please wait a few seconds and try again.',
   requestId: req.id, });
  return false;
}

function getPublicAuthError(error, fallbackMessage) {
  if (error?.code === 'EAUTH') {
    return 'OTP email delivery is misconfigured on the server. Please update the Gmail app password in server/.env.';
  }

  if (error?.code === 'ETIMEDOUT') {
    return 'OTP email delivery timed out connecting to Gmail. Check Render outbound network access and SMTP settings.';
  }

  if (error?.code === 'ENETUNREACH' || error?.code === 'EHOSTUNREACH' || error?.code === 'ESOCKET') {
    return 'OTP email delivery could not reach Gmail from the server network. Check Render outbound SMTP access and IPv6/IPv4 routing.';
  }

  if (/BadCredentials|Username and Password not accepted/i.test(error?.message || '')) {
    return 'OTP email delivery is misconfigured on the server. Please update the Gmail app password in server/.env.';
  }

  return fallbackMessage;
}

function generateToken(user) {
  return jwt.sign(
    {
      userId: user._id.toString(),
      name: user.name,
      email: user.email,
    },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );
}

function normalizeEmail(email) {
  return String(email || '').toLowerCase().trim();
}

function hashOtp(otp) {
  return crypto.createHash('sha256').update(String(otp)).digest('hex');
}

function generateOtpCode() {
  return otpGenerator.generate(6, {
    upperCaseAlphabets: false,
    lowerCaseAlphabets: false,
    specialChars: false,
    digits: true,
  });
}

async function createAndSendOtp({ email, purpose, pendingSignup, loginUserId }) {
  const otp = generateOtpCode();
  const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);

  await OtpVerification.findOneAndUpdate(
    { email, purpose },
    {
      email,
      purpose,
      otpHash: hashOtp(otp),
      expiresAt,
      attempts: 0,
      loginUserId: loginUserId || null,
      pendingSignup: pendingSignup || undefined,
    },
    {
      upsert: true,
      returnDocument: 'after',
      setDefaultsOnInsert: true,
    }
  );

  try {
    await sendOtpEmail({ email, otp, purpose });
  } catch (error) {
    await OtpVerification.deleteOne({ email, purpose });
    throw error;
  }
}

async function consumeValidOtp({ email, purpose, otp }) {
  const record = await OtpVerification.findOne({ email, purpose });

  if (!record) {
    return { error: 'No active OTP request found. Please request a new code.' };
  }

  if (record.expiresAt.getTime() < Date.now()) {
    await OtpVerification.deleteOne({ _id: record._id });
    return { error: 'OTP expired. Please request a new code.' };
  }

  if (record.attempts >= MAX_OTP_ATTEMPTS) {
    await OtpVerification.deleteOne({ _id: record._id });
    return { error: 'Too many invalid OTP attempts. Please request a new code.' };
  }

  if (record.otpHash !== hashOtp(otp)) {
    record.attempts += 1;
    await record.save();
    return { error: 'Invalid OTP. Please try again.' };
  }

  await OtpVerification.deleteOne({ _id: record._id });
  return { record };
}

router.post(
  '/signup/request-otp',
  otpRequestByEmailLimiter,
  otpRequestByIpLimiter,
  validateBody('signupRequestOtpSchema'),
  async (req, res) => {
  try {
    if (!ensureDatabaseReady(res)) {
      return;
    }

    const { name, email, password } = req.body;
    const normalizedEmail = normalizeEmail(email);

    if (!name?.trim() || !normalizedEmail || !password) {
      return res.status(400).json({
        error: 'Username, email, and password are required.',
       requestId: req.id, });
    }

    if (!/^\S+@\S+\.\S+$/.test(normalizedEmail)) {
      return res.status(400).json({
        error: 'Please enter a valid email address.',
       requestId: req.id, });
    }

    if (password.length < 6) {
      return res.status(400).json({
        error: 'Password must be at least 6 characters long.',
       requestId: req.id, });
    }

    const existingUser = await User.findOne({ email: normalizedEmail });
    if (existingUser) {
      return res.status(409).json({
        error: 'An account with this email already exists.',
       requestId: req.id, });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    await createAndSendOtp({
      email: normalizedEmail,
      purpose: 'signup',
      pendingSignup: {
        name: name.trim(),
        passwordHash,
      },
    });

    res.json({
      message: 'OTP sent to your email address.',
      email: normalizedEmail,
    });
  } catch (err) {
    logger.error({ err: err.message, requestId: req.id }, 'Signup OTP request error');

    if (err.code === 11000) {
      return res.status(409).json({
        error: 'An account with this email already exists.',
        requestId: req.id,
      });
    }

    res.status(500).json({
      error: getPublicAuthError(err, 'Something went wrong. Please try again later.'),
      requestId: req.id,
    });
  }
});

router.post('/signup/verify-otp', otpVerifyLimiter, validateBody('signupVerifyOtpSchema'), async (req, res) => {
  try {
    if (!ensureDatabaseReady(res)) {
      return;
    }

    const normalizedEmail = normalizeEmail(req.body.email);
    const otp = String(req.body.otp || '').trim();

    if (!normalizedEmail || !otp) {
      return res.status(400).json({
        error: 'Email and OTP are required.',
       requestId: req.id, });
    }

    const existingUser = await User.findOne({ email: normalizedEmail });
    if (existingUser) {
      await OtpVerification.deleteOne({ email: normalizedEmail, purpose: 'signup' });
      return res.status(409).json({
        error: 'An account with this email already exists.',
       requestId: req.id, });
    }

    const otpResult = await consumeValidOtp({
      email: normalizedEmail,
      purpose: 'signup',
      otp,
    });

    if (otpResult.error) {
      return res.status(400).json({ error: otpResult.error , requestId: req.id, });
    }

    const pendingSignup = otpResult.record.pendingSignup;
    if (!pendingSignup?.name || !pendingSignup?.passwordHash) {
      return res.status(400).json({
        error: 'Signup session is invalid. Please start again.',
       requestId: req.id, });
    }

    const user = new User({
      name: pendingSignup.name,
      email: normalizedEmail,
      password: pendingSignup.passwordHash,
    });
    await user.save();

    const token = generateToken(user);

    res.status(201).json({
      token,
      user: user.toSafeObject(),
    });
  } catch (err) {
    logger.error({ err: err.message, requestId: req.id }, 'Signup OTP verification error:');
    res.status(500).json({
      error: 'Something went wrong. Please try again later.',
     requestId: req.id, });
  }
});

router.post(
  '/login/request-otp',
  loginLimiter,
  otpRequestByEmailLimiter,
  otpRequestByIpLimiter,
  validateBody('loginRequestOtpSchema'),
  async (req, res) => {
  try {
    if (!ensureDatabaseReady(res)) {
      return;
    }

    const normalizedEmail = normalizeEmail(req.body.email);
    const { password } = req.body;

    if (!normalizedEmail || !password) {
      return res.status(400).json({
        error: 'Email and password are required.',
       requestId: req.id, });
    }

    const user = await User.findOne({ email: normalizedEmail }).select('+password');

    if (!user) {
      return res.status(401).json({
        error: 'Invalid email or password.',
       requestId: req.id, });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({
        error: 'Invalid email or password.',
       requestId: req.id, });
    }

    await createAndSendOtp({
      email: normalizedEmail,
      purpose: 'login',
      loginUserId: user._id,
    });

    res.json({
      message: 'OTP sent to your email address.',
      email: normalizedEmail,
    });
  } catch (err) {
    logger.error({ err: err.message, requestId: req.id }, 'Login OTP request error:');
    res.status(500).json({
      error: getPublicAuthError(err, 'Something went wrong. Please try again later.'),
     requestId: req.id, });
  }
});

router.post('/login/verify-otp', loginLimiter, otpVerifyLimiter, validateBody('loginVerifyOtpSchema'), async (req, res) => {
  try {
    if (!ensureDatabaseReady(res)) {
      return;
    }

    const normalizedEmail = normalizeEmail(req.body.email);
    const otp = String(req.body.otp || '').trim();

    if (!normalizedEmail || !otp) {
      return res.status(400).json({
        error: 'Email and OTP are required.',
       requestId: req.id, });
    }

    const otpResult = await consumeValidOtp({
      email: normalizedEmail,
      purpose: 'login',
      otp,
    });

    if (otpResult.error) {
      return res.status(400).json({ error: otpResult.error , requestId: req.id, });
    }

    const user = await User.findById(otpResult.record.loginUserId);
    if (!user || user.email !== normalizedEmail) {
      return res.status(401).json({
        error: 'Login session is invalid. Please start again.',
       requestId: req.id, });
    }

    user.lastActive = new Date();
    await user.save();

    const token = generateToken(user);

    res.json({
      token,
      user: user.toSafeObject(),
    });
  } catch (err) {
    logger.error({ err: err.message, requestId: req.id }, 'Login OTP verification error:');
    res.status(500).json({
      error: 'Something went wrong. Please try again later.',
     requestId: req.id, });
  }
});

router.get('/me', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);

    if (!user) {
      return res.status(404).json({
        error: 'User not found.',
       requestId: req.id, });
    }

    res.json({
      user: user.toSafeObject(),
    });
  } catch (err) {
    logger.error({ err: err.message, requestId: req.id }, 'Get profile error:');
    res.status(500).json({
      error: 'Something went wrong.',
     requestId: req.id, });
  }
});

module.exports = router;
// P0-12: export pure OTP helpers for unit tests (no DB required).
module.exports.hashOtp = hashOtp;
module.exports.generateOtpCode = generateOtpCode;
module.exports.normalizeEmail = normalizeEmail;
module.exports.MAX_OTP_ATTEMPTS = MAX_OTP_ATTEMPTS;
module.exports.OTP_EXPIRY_MINUTES = OTP_EXPIRY_MINUTES;
