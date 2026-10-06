const express = require('express');
const axios = require('axios');
const authMiddleware = require('../middleware/auth');
const { logger } = require('../lib/logger');
const { captureException } = require('../lib/sentry');
const { validateBody } = require('../middleware/validate');
const { executeLimiter } = require('../middleware/rateLimits');

const router = express.Router();

const JUDGE0_API = `https://${process.env.JUDGE0_API_HOST}`;

const judge0Client = axios.create({
  baseURL: JUDGE0_API,
  headers: {
    'Content-Type': 'application/json',
    'x-rapidapi-key': process.env.JUDGE0_API_KEY,
    'x-rapidapi-host': process.env.JUDGE0_API_HOST,
  },
});

function decodeBase64Field(value) {
  if (!value) {
    return '';
  }

  return Buffer.from(value, 'base64').toString('utf-8');
}

// Submit code and get result
// code execution costs money (Judge0 quota) — require authentication.
// per-user quota (20/min) on top of auth.
router.post('/execute', authMiddleware, executeLimiter, validateBody('executeSchema'), async (req, res) => {
  try {
    const { source_code, language_id, stdin = '' } = req.body;

    if (!source_code || !language_id) {
      return res.status(400).json({
        error: 'source_code and language_id are required',
       requestId: req.id, });
    }

    // base64-encode source_code/stdin: Judge0 can't losslessly store raw UTF-8
    // for some inputs (control chars, unusual unicode from pasted code) and
    // rejects the submission with "cannot be converted to UTF-8" otherwise.
    const submission = await judge0Client.post(
      '/submissions',
      {
        source_code: Buffer.from(source_code, 'utf-8').toString('base64'),
        language_id,
        stdin: Buffer.from(stdin, 'utf-8').toString('base64'),
      },
      { params: { base64_encoded: true, wait: false } }
    );

    const token = submission.data.token;

    // Poll for result with retry
    let result = null;
    const maxRetries = 15;
    const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    for (let i = 0; i < maxRetries; i++) {
      await delay(1000);

      const response = await judge0Client.get(`/submissions/${token}`, {
        params: { base64_encoded: true, fields: '*' },
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
       requestId: req.id, });
    }

    res.json({
      stdout: decodeBase64Field(result.stdout),
      stderr: decodeBase64Field(result.stderr),
      compile_output: decodeBase64Field(result.compile_output),
      status: result.status,
      time: result.time,
      memory: result.memory,
    });
  } catch (error) {
    logger.error({ err: error.message || error, requestId: req.id }, 'Execution error');
    captureException(error, { extra: { requestId: req.id } });
    // P0-07: generic message; upstream Judge0 details stay server-side.
    res.status(500).json({
      error: 'Failed to execute code. Please try again.',
      requestId: req.id,
    });
  }
});

// Get supported languages (authenticated: Judge0 quota + enumeration guard)
// P0-01: requires auth like /execute.
router.get('/languages', authMiddleware, async (req, res) => {
  try {
    const response = await judge0Client.get('/languages');
    res.json(response.data);
  } catch (error) {
    logger.error({ err: error.message || error, requestId: req.id }, 'Languages error:');
    res.status(500).json({ error: 'Failed to fetch languages' , requestId: req.id, });
  }
});

module.exports = router;
