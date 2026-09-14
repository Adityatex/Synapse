const express = require('express');
const axios = require('axios');
const authMiddleware = require('../middleware/auth');
const { executeLimiter } = require('../middleware/rateLimits');

const router = express.Router();

// P0-01: code execution costs money (Judge0 quota) — require authentication.
// Auth is applied PER ROUTE (not router.use): this router is mounted at bare
// `/api`, so a router-level auth would 401 every other API namespace
// (/api/auth, /api/ai, /api/rooms) including public login/signup.
// P0-02: per-user quota (20/min) on top of auth.
// P0-05: 2 MB body budget for full source files + stdin, after auth so
// unauthenticated callers get 401 without us parsing their bodies.

const JUDGE0_API = `https://${process.env.JUDGE0_API_HOST}`;

const judge0Client = axios.create({
  baseURL: JUDGE0_API,
  headers: {
    'Content-Type': 'application/json',
    'x-rapidapi-key': process.env.JUDGE0_API_KEY,
    'x-rapidapi-host': process.env.JUDGE0_API_HOST,
  },
});

// Submit code and get result
router.post(
  '/execute',
  authMiddleware,
  express.json({ limit: '2mb' }),
  executeLimiter,
  async (req, res) => {
  try {
    const { source_code, language_id, stdin = '' } = req.body;

    if (!source_code || !language_id) {
      return res.status(400).json({
        error: 'source_code and language_id are required',
        requestId: req.id,
      });
    }

    // Create submission
    const submission = await judge0Client.post('/submissions', {
      source_code,
      language_id,
      stdin,
      base64_encoded: false,
      wait: false,
    });

    const token = submission.data.token;

    // Poll for result with retry
    let result = null;
    const maxRetries = 15;
    const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    for (let i = 0; i < maxRetries; i++) {
      await delay(1000);

      const response = await judge0Client.get(`/submissions/${token}`, {
        params: { base64_encoded: false, fields: '*' },
      });

      const status = response.data.status;

      // Status IDs: 1 = In Queue, 2 = Processing
      if (status.id > 2) {
        result = response.data;
        break;
      }
    }

    if (!result) {
      return res.status(408).json({
        error: 'Code execution timed out. Please try again.',
        requestId: req.id,
      });
    }

    res.json({
      stdout: result.stdout || '',
      stderr: result.stderr || '',
      compile_output: result.compile_output || '',
      status: result.status,
      time: result.time,
      memory: result.memory,
    });
  } catch (error) {
    // P0-07: full upstream detail stays in server logs; the client only gets
    // a generic message + correlation ID (never Judge0 response bodies).
    console.error(`[${req.id}] Execution error:`, error.response?.data || error.message);
    res.status(500).json({
      error: 'Failed to execute code. Please try again.',
      requestId: req.id,
    });
  }
});

// Get supported languages
router.get('/languages', authMiddleware, async (req, res) => {
  try {
    const response = await judge0Client.get('/languages');
    res.json(response.data);
  } catch (error) {
    console.error(`[${req.id}] Languages error:`, error.message);
    res.status(500).json({ error: 'Failed to fetch languages', requestId: req.id });
  }
});

module.exports = router;
