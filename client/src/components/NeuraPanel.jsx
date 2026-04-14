import { useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { getThemeClasses } from '../utils/theme';
import {
  Send,
  ChevronRight,
  LoaderCircle,
  Copy,
  Check,
  BrainCircuit,
  ShieldCheck,
  Code2,
  Lightbulb,
} from 'lucide-react';
import { useFiles } from '../contexts/FileContext';
import { chatWithNeura } from '../services/aiService';

const PANEL_WIDTH_KEY = 'synapse-neura-width';
const MIN_PANEL_WIDTH = 320;
const MAX_PANEL_WIDTH = 560;

function getInitials(name) {
  return name ? String(name).charAt(0).toUpperCase() : 'A';
}

function UserAvatar({ name, size = 'w-7 h-7', textSize = 'text-[10px]' }) {
  return (
    <div
      className={`${size} rounded-full bg-blue-500 flex items-center justify-center ${textSize} font-bold text-white border-2 border-white/20 select-none shrink-0`}
    >
      {getInitials(name)}
    </div>
  );
}

function CodeBlock({ inline, className, children, theme }) {
  const [copied, setCopied] = useState(false);
  const match = /language-([\w-]+)/.exec(className || '');
  const language = match?.[1] || 'code';
  const code = String(children).replace(/\n$/, '');

  if (inline) {
    return (
      <code
        className={`px-1.5 py-0.5 rounded-md font-mono text-[11px] ${
          theme === 'dark'
            ? 'bg-white/10 text-fuchsia-200'
            : 'bg-slate-100 text-fuchsia-700'
        }`}
      >
        {children}
      </code>
    );
  }

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div
      className={`my-3 overflow-hidden rounded-xl border ${
        theme === 'dark'
          ? 'border-white/10 bg-[#08111d]'
          : 'border-slate-200 bg-[#f7f9fc]'
      }`}
    >
      <div
        className={`flex items-center justify-between px-3 py-2 text-[10px] uppercase tracking-[0.18em] ${
          theme === 'dark'
            ? 'border-b border-white/10 bg-white/5 text-slate-400'
            : 'border-b border-slate-200 bg-slate-100 text-slate-500'
        }`}
      >
        <span>{language}</span>
        <button
          type="button"
          onClick={handleCopy}
          className={`inline-flex items-center gap-1 rounded-md px-2 py-1 normal-case tracking-normal transition-colors ${
            theme === 'dark'
              ? 'text-slate-300 hover:bg-white/10'
              : 'text-slate-600 hover:bg-white'
          }`}
          title="Copy code"
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
          <span>{copied ? 'Copied' : 'Copy'}</span>
        </button>
      </div>
      <pre className="overflow-x-auto p-3">
        <code
          className={`font-mono text-[11px] leading-5 ${
            theme === 'dark' ? 'text-slate-200' : 'text-slate-800'
          }`}
        >
          {code}
        </code>
      </pre>
    </div>
  );
}

function AssistantMessage({ content, theme }) {
  return (
    <div
      className={`rounded-2xl border px-4 py-3 shadow-sm ${
        theme === 'dark'
          ? 'border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.02))]'
          : 'border-slate-200 bg-white'
      }`}
    >
      <div className="prose prose-sm max-w-none break-words prose-p:my-2 prose-headings:my-2 prose-ul:my-2 prose-ol:my-2 prose-li:my-1 prose-strong:text-inherit">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            p({ children }) {
              return <p className="break-words whitespace-pre-wrap">{children}</p>;
            },
            li({ children }) {
              return <li className="break-words">{children}</li>;
            },
            code({ inline, className, children }) {
              return (
                <CodeBlock inline={inline} className={className} theme={theme}>
                  {children}
                </CodeBlock>
              );
            },
          }}
        >
          {content}
        </ReactMarkdown>
      </div>
    </div>
  );
}

export default function NeuraPanel({ theme, currentUser }) {
  const { files, activeFile } = useFiles();
  const panelRef = useRef(null);
  const resizeStateRef = useRef(null);
  const [isOpen, setIsOpen] = useState(false);
  const [panelWidth, setPanelWidth] = useState(() => {
    const savedWidth = Number(localStorage.getItem(PANEL_WIDTH_KEY));
    if (Number.isFinite(savedWidth) && savedWidth >= MIN_PANEL_WIDTH && savedWidth <= MAX_PANEL_WIDTH) {
      return savedWidth;
    }
    return 360;
  });
  const [message, setMessage] = useState('');
  const [messages, setMessages] = useState([
    {
      id: 'intro',
      role: 'assistant',
      content:
        "Hi! I'm Neura. I can help you understand code, write tests, find bugs, or suggest improvements. What are we working on today?",
    },
  ]);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState('');
  const t = getThemeClasses(theme);
  const suggestionChips = useMemo(
    () => [
      { label: 'Explain architecture', icon: BrainCircuit },
      { label: 'Find risky code paths', icon: ShieldCheck },
      { label: 'Draft tests', icon: Code2 },
      { label: 'Suggest improvements', icon: Lightbulb },
    ],
    []
  );

  useEffect(() => {
    localStorage.setItem(PANEL_WIDTH_KEY, String(panelWidth));
  }, [panelWidth]);

  useEffect(() => {
    const handlePointerMove = (event) => {
      const resizeState = resizeStateRef.current;
      if (!resizeState) {
        return;
      }

      const nextWidth = resizeState.startWidth + (resizeState.startX - event.clientX);
      const boundedWidth = Math.min(MAX_PANEL_WIDTH, Math.max(MIN_PANEL_WIDTH, nextWidth));
      setPanelWidth(boundedWidth);
    };

    const stopResizing = () => {
      resizeStateRef.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', stopResizing);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', stopResizing);
    };
  }, []);

  const startResizing = (event) => {
    resizeStateRef.current = {
      startX: event.clientX,
      startWidth: panelWidth,
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  const fileContext = useMemo(
    () => ({
      activeFile: activeFile
        ? {
            id: activeFile.id,
            name: activeFile.name,
            content: activeFile.content,
          }
        : null,
      files: files.map((file) => ({
        id: file.id,
        name: file.name,
      })),
    }),
    [activeFile, files]
  );

  const sendMessage = async (rawMessage) => {
    const trimmedMessage = String(rawMessage || '').trim();
    if (!trimmedMessage || isSending) {
      return;
    }

    const nextUserMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: trimmedMessage,
    };

    const nextHistory = messages
      .filter((entry) => entry.role === 'user' || entry.role === 'assistant')
      .map(({ role, content }) => ({ role, content }))
      .concat({ role: 'user', content: trimmedMessage });

    setMessages((current) => [...current, nextUserMessage]);
    setMessage('');
    setIsSending(true);
    setError('');

    try {
      const response = await chatWithNeura({
        message: trimmedMessage,
        history: nextHistory,
        context: fileContext,
      });

      setMessages((current) => [
        ...current,
        {
          id: `assistant-${Date.now()}`,
          role: 'assistant',
          content: response.reply,
        },
      ]);
    } catch (requestError) {
      setError(requestError.message || 'Neura could not respond right now.');
    } finally {
      setIsSending(false);
    }
  };

  if (!isOpen) {
    return (
      <div 
        className={`w-12 border ${theme === 'dark' ? 'bg-[#0d1117] border-white/10 shadow-black/50' : 'bg-slate-200/80 border-slate-300 shadow-slate-200/50'} rounded-xl shadow-lg flex flex-col items-center py-4 shrink-0 transition-all duration-300 overflow-hidden`}
      >
        <button
          onClick={() => setIsOpen(true)}
          className={`relative flex items-center justify-center w-8 h-8 rounded-lg outline-none overflow-hidden group border border-transparent hover:border-fuchsia-500/50 transition-all shadow-lg ${theme === 'dark' ? 'shadow-fuchsia-900/20' : 'shadow-fuchsia-200/50 cursor-pointer'}`}
          title="Open Neura AI Assistant"
        >
          <div className="absolute inset-0 bg-gradient-to-br from-fuchsia-500 to-indigo-600 opacity-80 group-hover:opacity-100 transition-opacity" />
          <BrainCircuit size={16} className="text-white relative z-10" />
        </button>
      </div>
    );
  }

  return (
    <aside
      ref={panelRef}
      style={{ width: `${panelWidth}px` }}
      className={`relative border flex flex-col transition-[width] duration-200 shrink-0 rounded-2xl overflow-hidden shadow-xl min-w-0 ${
        theme === 'dark'
          ? 'bg-[radial-gradient(circle_at_top,#142033_0%,#0b1119_42%,#090d14_100%)] border-white/10 shadow-black/50'
          : 'bg-[linear-gradient(180deg,#ffffff_0%,#f7f9fc_100%)] border-slate-300 shadow-slate-200/70'
      }`}
    >
      <button
        type="button"
        aria-label="Resize Neura panel"
        onPointerDown={startResizing}
        className={`absolute left-0 top-0 z-20 h-full w-3 -translate-x-1/2 cursor-col-resize ${
          theme === 'dark' ? 'hover:bg-fuchsia-400/20' : 'hover:bg-fuchsia-500/15'
        }`}
      >
        <span className="sr-only">Resize</span>
      </button>
      {/* Header */}
      <div className={`shrink-0 relative overflow-hidden border-b ${t.border}`}>
        <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(circle_at_top_left,rgba(99,102,241,0.18),transparent_38%),radial-gradient(circle_at_top_right,rgba(236,72,153,0.16),transparent_30%)]" />
        <div className="relative z-10 p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex gap-3 min-w-0">
              <div className="flex items-center justify-center w-11 h-11 rounded-2xl bg-gradient-to-br from-slate-900 via-indigo-700 to-cyan-500 shadow-lg shadow-cyan-500/10 shrink-0">
                <BrainCircuit size={20} className="text-white" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h2 className={`font-semibold text-sm tracking-tight ${t.text}`}>Neura AI</h2>
                  <span
                    className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${
                      theme === 'dark'
                        ? 'bg-emerald-500/10 text-emerald-300 ring-1 ring-emerald-400/20'
                        : 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200'
                    }`}
                  >
                    Ready
                  </span>
                </div>
                <p className={`text-[11px] leading-tight mt-1 ${t.textMuted}`}>
                  Context-aware engineering copilot for the active workspace.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              <button 
                onClick={() => setIsOpen(false)}
                className={`p-1.5 rounded-lg hover:bg-black/5 ${theme === 'dark' ? 'hover:bg-white/10 text-slate-400 hover:text-slate-200' : 'text-slate-500 hover:text-slate-800'} transition-colors cursor-pointer relative z-10`}
              >
                <ChevronRight size={18} />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Chat Area */}
      <div className="flex-1 overflow-x-hidden overflow-y-auto custom-scrollbar p-4 flex flex-col gap-5 min-w-0">
        {messages.map((entry) => (
          <div
            key={entry.id}
            className={`flex min-w-0 gap-3 ${entry.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            {entry.role === 'assistant' && (
              <div className="flex flex-col items-center gap-1 pt-1 shrink-0">
                <div className="w-7 h-7 rounded-xl bg-gradient-to-br from-slate-900 via-indigo-700 to-cyan-500 flex items-center justify-center shadow-md shadow-cyan-500/10">
                  <BrainCircuit size={14} className="text-white" />
                </div>
                <span className={`text-[9px] uppercase tracking-[0.2em] ${t.textMuted}`}>AI</span>
              </div>
            )}
            <div
              className={`min-w-0 overflow-hidden text-xs leading-relaxed whitespace-pre-wrap break-words ${
                entry.role === 'assistant' ? 'flex-1' : 'max-w-[88%]'
              }`}
            >
              {entry.role === 'assistant' ? (
                <AssistantMessage content={entry.content} theme={theme} />
              ) : (
                <div
                  className={`rounded-2xl px-4 py-3 shadow-sm ${
                    theme === 'dark'
                      ? 'bg-gradient-to-br from-indigo-600 to-fuchsia-600 text-white'
                      : 'bg-gradient-to-br from-slate-900 to-indigo-700 text-white'
                  }`}
                >
                  <div className="min-w-0 whitespace-pre-wrap break-words">{entry.content}</div>
                </div>
              )}
            </div>
            {entry.role === 'user' && (
              <div className="flex flex-col items-center gap-1 pt-1 shrink-0">
                <UserAvatar name={currentUser?.name} />
                <span className={`text-[9px] uppercase tracking-[0.2em] ${t.textMuted}`}>You</span>
              </div>
            )}
          </div>
        ))}
        
        {/* Example suggestion chips */}
        <div
          className={`rounded-2xl border p-3 ${
            theme === 'dark'
              ? 'border-white/10 bg-white/5'
              : 'border-slate-200 bg-white/80'
          }`}
        >
          <div className={`mb-3 text-[10px] font-semibold uppercase tracking-[0.18em] ${t.textMuted}`}>
            Suggested Prompts
          </div>
          <div className="grid grid-cols-1 gap-2">
          {suggestionChips.map((chip) => {
            const Icon = chip.icon;
            return (
            <button
              key={chip.label}
              onClick={() => sendMessage(chip.label)}
              disabled={isSending}
              className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-left text-[11px] transition-colors disabled:opacity-50 ${
                theme === 'dark'
                  ? 'border-white/10 bg-white/0 text-slate-200 hover:bg-white/5'
                  : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
              }`}
            >
              <span
                className={`flex h-7 w-7 items-center justify-center rounded-lg ${
                  theme === 'dark'
                    ? 'bg-indigo-500/10 text-indigo-300'
                    : 'bg-indigo-50 text-indigo-700'
                }`}
              >
                <Icon size={14} />
              </span>
              <span className="truncate">{chip.label}</span>
            </button>
            );
          })}
          </div>
        </div>

        {activeFile && (
          <div
            className={`rounded-xl px-3 py-2 text-[10px] ${
              theme === 'dark'
                ? 'bg-white/5 text-slate-400 ring-1 ring-white/10'
                : 'bg-slate-100 text-slate-500 ring-1 ring-slate-200'
            }`}
          >
            Working with <span className={theme === 'dark' ? 'text-slate-200' : 'text-slate-700'}>{activeFile.name}</span>
          </div>
        )}

        {error && (
          <div className={`text-[11px] rounded-lg border px-3 py-2 ${theme === 'dark' ? 'border-rose-500/30 text-rose-300 bg-rose-500/10' : 'border-rose-200 text-rose-700 bg-rose-50'}`}>
            {error}
          </div>
        )}
      </div>

      {/* Input Area */}
      <div
        className={`p-3 border-t ${t.border} ${
          theme === 'dark'
            ? 'bg-[linear-gradient(180deg,rgba(8,11,18,0.3),rgba(8,11,18,0.92))]'
            : 'bg-[linear-gradient(180deg,rgba(255,255,255,0.55),rgba(248,250,252,0.96))]'
        }`}
      >
        <div
          className={`mb-2 flex items-center justify-between px-1 text-[10px] uppercase tracking-[0.16em] ${t.textMuted}`}
        >
          <span>Prompt</span>
          <span>{message.trim().length}/4000</span>
        </div>
        <div className={`relative flex items-end gap-2 bg-transparent border ${theme === 'dark' ? 'border-white/10 focus-within:border-cyan-400/40 bg-white/5' : 'border-slate-300 focus-within:border-indigo-400 bg-white'} rounded-2xl px-3 py-3 overflow-hidden transition-colors`}>
          <input 
            type="text"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            maxLength={4000}
            placeholder="Ask for fixes, architecture guidance, bugs, tests, or implementation help..."
            className={`w-full min-w-0 bg-transparent text-xs outline-none ${t.text} ${theme === 'dark' ? 'placeholder:text-slate-500' : 'placeholder:text-slate-400'}`}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && message.trim() && !isSending) {
                sendMessage(message);
              }
            }}
          />
          <button 
            onClick={() => sendMessage(message)}
            disabled={!message.trim() || isSending}
            className={`shrink-0 p-2 rounded-xl ${
              message.trim()
                ? theme === 'dark'
                  ? 'bg-gradient-to-br from-cyan-500 to-indigo-600 text-white'
                  : 'bg-gradient-to-br from-slate-900 to-indigo-700 text-white'
                : theme === 'dark'
                  ? 'text-slate-600 bg-white/5'
                  : 'text-slate-400 bg-slate-100'
            } transition-colors cursor-pointer`}
          >
            {isSending ? <LoaderCircle size={14} className="animate-spin" /> : <Send size={14} />}
          </button>
        </div>
        <div className={`flex items-center justify-between text-[9px] mt-2 px-1 ${theme === 'dark' ? 'text-slate-600' : 'text-slate-400'}`}>
          <span>Neura can make mistakes. Verify important output.</span>
          <span>Enter to send</span>
        </div>
      </div>
    </aside>
  );
}
