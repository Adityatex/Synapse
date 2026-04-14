const axios = require('axios');

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const DEFAULT_MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
const DEFAULT_TEMPERATURE = Number(process.env.GROQ_TEMPERATURE || 0.2);
const DEFAULT_MAX_TOKENS = Number(process.env.GROQ_MAX_TOKENS || 1024);

function truncateText(value, maxLength) {
  const text = String(value || '');
  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength)}\n\n...[truncated]`;
}

function buildContextBlock(context = {}) {
  const activeFile = context.activeFile || null;
  const fileSummaries = Array.isArray(context.files) ? context.files : [];

  const fileList = fileSummaries
    .slice(0, 30)
    .map((file) => `- ${file.name}${file.id === activeFile?.id ? ' (active)' : ''}`)
    .join('\n');

  if (!activeFile) {
    return fileList ? `Workspace files:\n${fileList}` : 'No code context was provided.';
  }

  return [
    `Active file: ${activeFile.name}`,
    '',
    fileList ? `Workspace files:\n${fileList}` : 'Workspace files: unavailable',
    '',
    'Active file content:',
    '```',
    truncateText(activeFile.content, 12000),
    '```',
  ].join('\n');
}

function buildMessages({ message, history = [], context = {} }) {
  const safeHistory = Array.isArray(history)
    ? history
        .filter((entry) => entry && (entry.role === 'user' || entry.role === 'assistant'))
        .slice(-8)
        .map((entry) => ({
          role: entry.role,
          content: truncateText(entry.content, 4000),
        }))
    : [];

  return [
    {
      role: 'system',
      content: [
        'You are Neura, an AI coding assistant inside Synapse.',
        'Help with code understanding, debugging, refactoring, architecture, and tests.',
        'Be concise, practical, and specific.',
        'When code context is provided, ground your answer in it instead of making assumptions.',
        'If context is missing, say what is missing and still provide the most useful next step.',
      ].join(' '),
    },
    {
      role: 'system',
      content: buildContextBlock(context),
    },
    ...safeHistory,
    {
      role: 'user',
      content: truncateText(message, 4000),
    },
  ];
}

async function requestGroqChat({ message, history, context }) {
  const apiKey = String(process.env.GROQ_API_KEY || '').trim();
  if (!apiKey || apiKey === 'replace_with_your_groq_api_key') {
    throw new Error(
      'GROQ_API_KEY is missing or still using the placeholder value in server/.env.'
    );
  }

  const response = await axios.post(
    GROQ_API_URL,
    {
      model: DEFAULT_MODEL,
      temperature: DEFAULT_TEMPERATURE,
      max_tokens: DEFAULT_MAX_TOKENS,
      messages: buildMessages({ message, history, context }),
    },
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      // Ignore broken global proxy env vars when talking to Groq directly.
      proxy: false,
      timeout: 45000,
    }
  );

  return (
    response.data?.choices?.[0]?.message?.content?.trim() ||
    'I could not generate a response for that request.'
  );
}

module.exports = {
  requestGroqChat,
};
