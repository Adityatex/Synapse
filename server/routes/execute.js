const express = require('express');
const axios = require('axios');
const authMiddleware = require('../middleware/auth');
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
router.post('/execute', authMiddleware, executeLimiter, async (req, res) => {
  try {
    const { source_code, language_id, stdin = '' } = req.body;

    if (!source_code || !language_id) {
      return res.status(400).json({
        error: 'source_code and language_id are required',
      });
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
      });
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
    console.error('Execution error:', error.response?.data || error.message);
    res.status(500).json({
      error: error.response?.data?.message || 'Failed to execute code. Please try again.',
    });
  }
});

// Get supported languages
router.get('/languages', async (req, res) => {
  try {
    const response = await judge0Client.get('/languages');
    res.json(response.data);
  } catch (error) {
    console.error('Languages error:', error.message);
    res.status(500).json({ error: 'Failed to fetch languages' });
  }
});

module.exports = router;
