const express = require('express');
const axios = require('axios');
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

// Submit code and get result
router.post('/execute', async (req, res) => {
  try {
    const { source_code, language_id, stdin = '' } = req.body;

    if (!source_code || !language_id) {
      return res.status(400).json({
        error: 'source_code and language_id are required',
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
