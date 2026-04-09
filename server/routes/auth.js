const express = require('express');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');
const User = require('../models/User');
const authMiddleware = require('../middleware/auth');

function debugLog(msg) {
  const logFile = path.join(__dirname, '..', 'debug.log');
  fs.appendFileSync(logFile, `[${new Date().toISOString()}] ${msg}\n`);
}

const router = express.Router();

// Generate JWT token
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

/**
 * POST /api/auth/signup
 * Register a new user
 */
router.post('/signup', async (req, res) => {
  try {
    const { name, email, password } = req.body;

    // Validation
    if (!name?.trim() || !email || !password) {
      return res.status(400).json({
        error: 'Username, email, and password are required.',
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        error: 'Password must be at least 6 characters long.',
      });
    }

    // Check if user already exists
    const normalizedEmail = email.toLowerCase().trim();

    const existingUser = await User.findOne({ email: normalizedEmail });
    if (existingUser) {
      return res.status(409).json({
        error: 'An account with this email already exists.',
      });
    }

    // Create user
    const user = new User({
      name: name.trim(),
      email: normalizedEmail,
      password,
    });
    await user.save();

    // Generate token
    const token = generateToken(user);

    res.status(201).json({
      token,
      user: user.toSafeObject(),
    });
  } catch (err) {
    debugLog(`Signup error: ${err.message}`);
    debugLog(`Signup error name: ${err.name}`);
    debugLog(`Signup error stack: ${err.stack}`);
    console.error('Signup error:', err.message);

    if (err.code === 11000) {
      return res.status(409).json({
        error: 'An account with this email already exists.',
      });
    }

    if (err.name === 'ValidationError') {
      const messages = Object.values(err.errors).map((e) => e.message);
      return res.status(400).json({
        error: messages[0] || 'Validation failed.',
      });
    }

    res.status(500).json({
      error: 'Something went wrong. Please try again later.',
    });
  }
});

/**
 * POST /api/auth/login
 * Authenticate an existing user
 */
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    // Validation
    if (!email || !password) {
      return res.status(400).json({
        error: 'Email and password are required.',
      });
    }

    // Find user with password field included
    const user = await User.findOne({ email: email.toLowerCase().trim() }).select(
      '+password'
    );

    if (!user) {
      return res.status(401).json({
        error: 'Invalid email or password.',
      });
    }

    // Compare password
    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({
        error: 'Invalid email or password.',
      });
    }

    // Update last active
    user.lastActive = new Date();
    await user.save();

    // Generate token
    const token = generateToken(user);

    res.json({
      token,
      user: user.toSafeObject(),
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({
      error: 'Something went wrong. Please try again later.',
    });
  }
});

/**
 * GET /api/auth/me
 * Get current user profile (requires authentication)
 */
router.get('/me', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);

    if (!user) {
      return res.status(404).json({
        error: 'User not found.',
      });
    }

    res.json({
      user: user.toSafeObject(),
    });
  } catch (err) {
    console.error('Get profile error:', err);
    res.status(500).json({
      error: 'Something went wrong.',
    });
  }
});

module.exports = router;
