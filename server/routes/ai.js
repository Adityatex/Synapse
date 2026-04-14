const express = require('express');
const { requestGroqChat } = require('../services/groqService');

const router = express.Router();

router.post('/chat', async (req, res) => {
  try {
    const { message, history = [], context = {} } = req.body || {};

    if (!String(message || '').trim()) {
      return res.status(400).json({
        error: 'A message is required.',
      });
    }

    const reply = await requestGroqChat({
      message: String(message).trim(),
      history,
      context,
    });

    return res.json({ reply });
  } catch (error) {
    console.error('AI chat error:', error.response?.data || error.message);

    const upstreamMessage =
      error.response?.data?.error?.message ||
      error.response?.data?.message ||
      error.message;

    const statusCode =
      error.response?.status && error.response.status >= 400 && error.response.status < 600
        ? error.response.status
        : 500;

    return res.status(statusCode).json({
      error: upstreamMessage || 'Failed to generate AI response.',
    });
  }
});

module.exports = router;
