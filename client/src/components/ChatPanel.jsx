import { useState, useEffect, useRef, useMemo } from 'react';
import {
  Send, Copy, Check, Pin, Reply, Pencil, Trash2,
  Search, X, CornerDownRight, SmilePlus, ChevronUp
} from 'lucide-react';

// ─── URL / Link detection ────────────────────────────────────────────────────
const URL_REGEX = /(https?:\/\/[^\s<]+)/g;

function LinkifyText({ text }) {
  const parts = text.split(URL_REGEX);
  return (
    <>
      {parts.map((part, i) =>
        URL_REGEX.test(part) ? (
          <a
            key={i}
            href={part}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-400 hover:underline break-all"
          >
            {part}
          </a>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </>
  );
}

// ─── @Mention highlighting ───────────────────────────────────────────────────
function RichText({ text }) {
  // Split by @mentions
  const mentionRegex = /(@\w+)/g;
  const segments = text.split(mentionRegex);
  return (
    <>
      {segments.map((seg, i) =>
        seg.startsWith('@') ? (
          <span key={i} className="bg-indigo-500/20 text-indigo-400 font-semibold rounded px-0.5">
            {seg}
          </span>
        ) : (
          <LinkifyText key={i} text={seg} />
        )
      )}
    </>
  );
}

// ─── Code snippet with copy ──────────────────────────────────────────────────
function CodeSnippet({ code, theme }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="relative group mt-1.5 rounded-md overflow-hidden border border-white/10">
      <div className="absolute right-1.5 top-1.5 z-10 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={handleCopy}
          className={`p-1 rounded flex items-center justify-center transition-colors ${
            copied ? 'bg-emerald-500 text-white' : 'bg-white/10 hover:bg-white/20 text-slate-300'
          }`}
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
        </button>
      </div>
      <pre className={`p-2.5 text-[11px] font-mono overflow-x-auto ${
        theme === 'dark' ? 'bg-[#0d1117] text-slate-300' : 'bg-slate-100 text-slate-800'
      }`}>
        <code>{code}</code>
      </pre>
    </div>
  );
}

// ─── Message content parser ──────────────────────────────────────────────────
function MessageContent({ text, theme }) {
  const parts = text.split(/(```[\s\S]*?```)/g);
  return (
    <div className="space-y-1">
      {parts.map((part, i) => {
        if (part.startsWith('```') && part.endsWith('```')) {
          const inner = part.slice(3, -3);
          const nlIdx = inner.indexOf('\n');
          const code = nlIdx >= 0 ? inner.slice(nlIdx + 1) : inner;
          return <CodeSnippet key={i} code={code} theme={theme} />;
        }
        if (!part.trim()) return null;
        return (
          <span key={i} className="whitespace-pre-wrap">
            <RichText text={part} />
          </span>
        );
      })}
    </div>
  );
}

// ─── Emoji picker (compact) ──────────────────────────────────────────────────
const QUICK_EMOJIS = ['👍', '🔥', '✅', '❤️', '😂', '👀', '🎉', '🚀'];

function EmojiPicker({ onSelect, theme }) {
  return (
    <div className={`flex gap-1 p-1.5 rounded-lg shadow-lg border ${
      theme === 'dark' ? 'bg-[#1a1f2e] border-white/10' : 'bg-white border-slate-200'
    }`}>
      {QUICK_EMOJIS.map(e => (
        <button key={e} onClick={() => onSelect(e)}
          className="w-7 h-7 flex items-center justify-center hover:bg-white/10 rounded text-sm cursor-pointer transition-transform hover:scale-125">
          {e}
        </button>
      ))}
    </div>
  );
}

// ─── Mention autocomplete dropdown ───────────────────────────────────────────
function MentionDropdown({ users, filter, onSelect, theme }) {
  const filtered = users.filter(u =>
    u.username?.toLowerCase().startsWith(filter.toLowerCase())
  );
  if (filtered.length === 0) return null;
  return (
    <div className={`absolute bottom-full left-0 mb-1 w-48 rounded-lg shadow-lg border overflow-hidden z-20 ${
      theme === 'dark' ? 'bg-[#1a1f2e] border-white/10' : 'bg-white border-slate-200'
    }`}>
      {filtered.slice(0, 5).map(u => (
        <button key={u.userId || u.username} onClick={() => onSelect(u.username)}
          className={`w-full text-left px-3 py-1.5 text-xs cursor-pointer ${
            theme === 'dark' ? 'hover:bg-white/10 text-slate-200' : 'hover:bg-slate-100 text-slate-700'
          }`}>
          @{u.username}
        </button>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN CHAT PANEL
// ═══════════════════════════════════════════════════════════════════════════════
export default function ChatPanel({
  theme, themeClasses: t, chatMessages = [], typingUsers = [],
  getSocket, roomId, currentUser, collaborators = []
}) {
  const [inputValue, setInputValue] = useState('');
  const [replyTo, setReplyTo] = useState(null);      // message being replied to
  const [editingMsg, setEditingMsg] = useState(null); // message being edited
  const [searchMode, setSearchMode] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [showPinned, setShowPinned] = useState(false);
  const [activeEmojiPicker, setActiveEmojiPicker] = useState(null); // messageId
  const [hoveredMsg, setHoveredMsg] = useState(null);
  const [mentionFilter, setMentionFilter] = useState(null);
  const messagesEndRef = useRef(null);
  const scrollContainerRef = useRef(null);
  const typingTimeoutRef = useRef(null);
  const inputRef = useRef(null);

  // Auto-scroll to bottom
  useEffect(() => {
    if (!searchMode && !showPinned) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [chatMessages, typingUsers, searchMode, showPinned]);

  // Listen for search results from socket via custom event
  useEffect(() => {
    const handler = (e) => setSearchResults(e.detail || []);
    window.addEventListener('chat-search-results', handler);
    return () => window.removeEventListener('chat-search-results', handler);
  }, []);

  // Lazy load older messages on scroll to top
  const handleScroll = () => {
    const el = scrollContainerRef.current;
    const socket = getSocket?.();
    if (!el || !socket) return;
    if (el.scrollTop === 0 && chatMessages.length > 0) {
      const oldest = chatMessages[0];
      if (oldest?.timestamp) {
        socket.emit('request-chat-history', {
          roomId,
          limit: 50,
          beforeTimestamp: oldest.timestamp
        });
      }
    }
  };

  // ─── Input handling ──────────────────────────────────────────────────────
  const handleInputChange = (e) => {
    const val = e.target.value;
    setInputValue(val);
    const socket = getSocket?.();

    // Detect @ for mention autocomplete
    const words = val.split(/\s/);
    const lastWord = words[words.length - 1];
    if (lastWord.startsWith('@') && lastWord.length > 1) {
      setMentionFilter(lastWord.slice(1));
    } else {
      setMentionFilter(null);
    }

    if (socket) {
      socket.emit('typing-indicator', { roomId, isTyping: true });
      clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = setTimeout(() => {
        socket.emit('typing-indicator', { roomId, isTyping: false });
      }, 2000);
    }
  };

  const handleMentionSelect = (username) => {
    const words = inputValue.split(/\s/);
    words[words.length - 1] = `@${username} `;
    setInputValue(words.join(' '));
    setMentionFilter(null);
    inputRef.current?.focus();
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    const socket = getSocket?.();
    if (!inputValue.trim() || !socket) return;

    if (editingMsg) {
      socket.emit('edit-chat-message', { messageId: editingMsg._id, content: inputValue });
      setEditingMsg(null);
    } else {
      const payload = { roomId, content: inputValue, type: 'user' };
      if (replyTo) {
        payload.replyTo = {
          messageId: replyTo._id,
          senderName: replyTo.senderName,
          content: replyTo.content?.slice(0, 80)
        };
      }
      socket.emit('send-chat-message', payload);
      setReplyTo(null);
    }

    socket.emit('typing-indicator', { roomId, isTyping: false });
    clearTimeout(typingTimeoutRef.current);
    setInputValue('');
  };

  const handleSearchSubmit = () => {
    const socket = getSocket?.();
    if (!searchQuery.trim() || !socket) return;
    socket.emit('search-chat-messages', { roomId, query: searchQuery });
  };

  // ─── Helpers ─────────────────────────────────────────────────────────────
  const getInitials = (name) => (name ? name.charAt(0).toUpperCase() : 'A');
  const border = t?.border || 'border-slate-700';
  const textMuted = t?.textMuted || 'text-slate-500';

  // De-duplicate messages
  const uniqueMessages = useMemo(() => {
    const seen = new Set();
    return chatMessages.filter(m => {
      const k = m._id || `${m.timestamp}-${m.content}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }, [chatMessages]);

  const pinnedMessages = useMemo(() =>
    uniqueMessages.filter(m => m.pinned && !m.deleted),
    [uniqueMessages]
  );

  const displayMessages = searchMode ? searchResults : uniqueMessages;

  // ─── Render a single message ─────────────────────────────────────────────
  const renderMessage = (msg, index) => {
    const isMe = msg.senderId === currentUser?.userId;
    const isSystem = msg.type === 'system';
    const msgKey = msg._id || `msg-${index}`;
    const isDeleted = msg.deleted;
    const isHovered = hoveredMsg === msgKey;

    if (isSystem) {
      return (
        <div key={msgKey} className="flex justify-center my-2">
          <span className={`text-[10px] px-2 py-1 rounded-full ${
            theme === 'dark' ? 'bg-white/5 text-slate-400' : 'bg-black/5 text-slate-500'
          }`}>
            {msg.content}
          </span>
        </div>
      );
    }

    // Parse reactions map
    const reactions = msg.reactions
      ? (msg.reactions instanceof Map ? Object.fromEntries(msg.reactions) : msg.reactions)
      : {};

    return (
      <div key={msgKey}
        className={`flex flex-col ${isMe ? 'items-end' : 'items-start'} group/msg`}
        onMouseEnter={() => setHoveredMsg(msgKey)}
        onMouseLeave={() => { setHoveredMsg(null); setActiveEmojiPicker(null); }}
      >
        {/* Reply reference */}
        {msg.replyTo?.content && (
          <div className={`flex items-center gap-1 text-[9px] mb-0.5 px-2 ${textMuted} opacity-70`}>
            <CornerDownRight size={10} />
            <span className="font-semibold">{msg.replyTo.senderName}:</span>
            <span className="truncate max-w-[140px]">{msg.replyTo.content}</span>
          </div>
        )}

        <div className={`flex items-end gap-2 max-w-[95%] ${isMe ? 'flex-row-reverse' : 'flex-row'}`}>
          {/* Avatar */}
          <div className={`w-6 h-6 rounded-full shrink-0 flex items-center justify-center text-[9px] font-bold text-white ${
            isMe ? 'bg-indigo-500' : 'bg-slate-600'
          }`}>
            {getInitials(msg.senderName)}
          </div>

          {/* Bubble */}
          <div className={`flex flex-col ${isMe ? 'items-end' : 'items-start'} relative`}>
            <span className={`text-[9px] mb-0.5 px-1 opacity-60 ${textMuted}`}>
              {isMe ? 'You' : msg.senderName}
              {msg.edited && <span className="italic ml-1">(edited)</span>}
              {msg.pinned && <span className="ml-1">📌</span>}
              {' • '}
              {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>

            <div className={`px-3 py-2 rounded-xl text-xs break-words relative ${
              isDeleted
                ? 'italic opacity-50 ' + (theme === 'dark' ? 'bg-[#1e232b] text-slate-400' : 'bg-slate-100 text-slate-500')
                : isMe
                  ? 'bg-indigo-600 text-white rounded-br-sm'
                  : theme === 'dark'
                    ? 'bg-[#1e232b] text-slate-200 border-white/5 border rounded-bl-sm'
                    : 'bg-white text-slate-800 border shadow-sm border-slate-200 rounded-bl-sm'
            }`}>
              {isDeleted ? (
                <span className="italic">This message was deleted.</span>
              ) : (
                <MessageContent text={msg.content || ''} theme={theme} />
              )}
            </div>

            {/* Action buttons (on hover) */}
            {isHovered && !isDeleted && !searchMode && (
              <div className={`absolute -top-6 ${isMe ? 'right-0' : 'left-0'} flex gap-0.5 rounded-lg p-0.5 shadow-lg border z-20 ${
                theme === 'dark' ? 'bg-[#1a1f2e] border-white/10' : 'bg-white border-slate-200'
              }`}>
                <button onClick={() => setActiveEmojiPicker(activeEmojiPicker === msgKey ? null : msgKey)}
                  className="p-1 rounded hover:bg-white/10 cursor-pointer" title="React">
                  <SmilePlus size={12} className="text-slate-400" />
                </button>
                <button onClick={() => { setReplyTo(msg); inputRef.current?.focus(); }}
                  className="p-1 rounded hover:bg-white/10 cursor-pointer" title="Reply">
                  <Reply size={12} className="text-slate-400" />
                </button>
                <button onClick={() => getSocket?.()?.emit('pin-chat-message', { messageId: msg._id })}
                  className="p-1 rounded hover:bg-white/10 cursor-pointer" title={msg.pinned ? 'Unpin' : 'Pin'}>
                  <Pin size={12} className={msg.pinned ? 'text-amber-400' : 'text-slate-400'} />
                </button>
                {isMe && (
                  <>
                    <button onClick={() => { setEditingMsg(msg); setInputValue(msg.content); inputRef.current?.focus(); }}
                      className="p-1 rounded hover:bg-white/10 cursor-pointer" title="Edit">
                      <Pencil size={12} className="text-slate-400" />
                    </button>
                    <button onClick={() => getSocket?.()?.emit('delete-chat-message', { messageId: msg._id })}
                      className="p-1 rounded hover:bg-white/10 cursor-pointer" title="Delete">
                      <Trash2 size={12} className="text-red-400" />
                    </button>
                  </>
                )}
              </div>
            )}

            {/* Emoji picker popover */}
            {activeEmojiPicker === msgKey && (
              <div className={`absolute -top-12 ${isMe ? 'right-0' : 'left-0'} z-30`}>
                <EmojiPicker theme={theme} onSelect={(emoji) => {
                  getSocket?.()?.emit('react-chat-message', { messageId: msg._id, emoji });
                  setActiveEmojiPicker(null);
                }} />
              </div>
            )}

            {/* Reactions display */}
            {Object.keys(reactions).length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1">
                {Object.entries(reactions).map(([emoji, users]) => {
                  const reactionUsers = Array.isArray(users) ? users : [];
                  if (reactionUsers.length === 0) return null;
                  const iReacted = reactionUsers.some(u => u.userId === currentUser?.userId);
                  return (
                    <button key={emoji}
                      onClick={() => getSocket?.()?.emit('react-chat-message', { messageId: msg._id, emoji })}
                      className={`flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] border cursor-pointer transition-colors ${
                        iReacted
                          ? 'border-indigo-500/50 bg-indigo-500/10'
                          : theme === 'dark' ? 'border-white/10 bg-white/5 hover:bg-white/10' : 'border-slate-200 bg-slate-50 hover:bg-slate-100'
                      }`}
                      title={reactionUsers.map(u => u.username).join(', ')}
                    >
                      <span>{emoji}</span>
                      <span className={textMuted}>{reactionUsers.length}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  // ═══════════════════════════════════════════════════════════════════════════
  return (
    <div className="flex flex-col h-full bg-transparent">

      {/* ─── Header bar with search + pinned ──────────────────────────────── */}
      <div className={`flex items-center gap-1 px-3 py-1.5 border-b ${border} shrink-0`}>
        {searchMode ? (
          <div className="flex items-center gap-1 flex-1">
            <input
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSearchSubmit()}
              placeholder="Search messages..."
              className={`flex-1 text-xs rounded px-2 py-1 border focus:outline-none ${
                theme === 'dark' ? 'bg-[#0d1117] border-white/10 text-slate-200' : 'bg-slate-50 border-slate-300 text-slate-800'
              }`}
              autoFocus
            />
            <button onClick={handleSearchSubmit} className="p-1 hover:bg-white/10 rounded cursor-pointer">
              <Search size={13} className="text-slate-400" />
            </button>
            <button onClick={() => { setSearchMode(false); setSearchQuery(''); setSearchResults([]); }}
              className="p-1 hover:bg-white/10 rounded cursor-pointer">
              <X size={13} className="text-slate-400" />
            </button>
          </div>
        ) : (
          <>
            <button onClick={() => setSearchMode(true)}
              className="p-1 hover:bg-white/10 rounded cursor-pointer" title="Search messages">
              <Search size={13} className="text-slate-400" />
            </button>
            {pinnedMessages.length > 0 && (
              <button onClick={() => setShowPinned(!showPinned)}
                className={`p-1 hover:bg-white/10 rounded cursor-pointer flex items-center gap-1 text-[10px] ${
                  showPinned ? 'text-amber-400' : 'text-slate-400'
                }`}
                title="Pinned messages">
                <Pin size={13} />
                <span>{pinnedMessages.length}</span>
              </button>
            )}
            <div className="flex-1" />
            <span className={`text-[10px] ${textMuted}`}>
              {uniqueMessages.filter(m => m.type !== 'system').length} messages
            </span>
          </>
        )}
      </div>

      {/* ─── Pinned messages bar ──────────────────────────────────────────── */}
      {showPinned && pinnedMessages.length > 0 && (
        <div className={`px-3 py-2 border-b ${border} space-y-1.5 max-h-32 overflow-y-auto custom-scrollbar`}>
          <div className="flex items-center gap-1 text-[10px] text-amber-400 font-semibold mb-1">
            <Pin size={11} /> Pinned Messages
          </div>
          {pinnedMessages.map(pm => (
            <div key={pm._id} className={`text-[10px] px-2 py-1 rounded ${
              theme === 'dark' ? 'bg-white/5 text-slate-300' : 'bg-amber-50 text-slate-700'
            }`}>
              <span className="font-semibold">{pm.senderName}:</span> {pm.content?.slice(0, 100)}
            </div>
          ))}
        </div>
      )}

      {/* ─── Messages list ────────────────────────────────────────────────── */}
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-3"
      >
        {searchMode && searchResults.length === 0 && searchQuery && (
          <div className={`text-xs ${textMuted} text-center py-8 opacity-70`}>
            No results for "{searchQuery}"
          </div>
        )}

        {!searchMode && uniqueMessages.length === 0 && (
          <div className={`text-xs ${textMuted} text-center py-8 opacity-70`}>
            No messages yet. Say hello!
          </div>
        )}

        {displayMessages.map((msg, i) => renderMessage(msg, i))}

        {/* Typing Indicators */}
        {!searchMode && typingUsers.length > 0 && (
          <div className="flex items-center gap-2 text-[10px] text-slate-400 px-2 opacity-70">
            <div className="flex gap-1">
              <span className="w-1 h-1 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: '0ms' }} />
              <span className="w-1 h-1 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: '150ms' }} />
              <span className="w-1 h-1 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: '300ms' }} />
            </div>
            {typingUsers.join(', ')} {typingUsers.length > 1 ? 'are' : 'is'} typing...
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* ─── Reply / Edit banner ──────────────────────────────────────────── */}
      {(replyTo || editingMsg) && (
        <div className={`px-3 py-1.5 border-t ${border} flex items-center gap-2 text-[10px] ${textMuted}`}>
          {replyTo && (
            <>
              <Reply size={11} className="text-indigo-400 shrink-0" />
              <span className="truncate">Replying to <span className="font-semibold">{replyTo.senderName}</span>: {replyTo.content?.slice(0, 60)}</span>
            </>
          )}
          {editingMsg && (
            <>
              <Pencil size={11} className="text-amber-400 shrink-0" />
              <span>Editing message...</span>
            </>
          )}
          <button onClick={() => { setReplyTo(null); setEditingMsg(null); setInputValue(''); }}
            className="ml-auto p-0.5 hover:bg-white/10 rounded cursor-pointer shrink-0">
            <X size={12} />
          </button>
        </div>
      )}

      {/* ─── Input Area ───────────────────────────────────────────────────── */}
      <div className={`p-3 border-t ${border} shrink-0`}>
        <form onSubmit={handleSubmit} className="relative">
          {/* Mention dropdown */}
          {mentionFilter && (
            <MentionDropdown
              users={collaborators}
              filter={mentionFilter}
              onSelect={handleMentionSelect}
              theme={theme}
            />
          )}
          <textarea
            ref={inputRef}
            value={inputValue}
            onChange={handleInputChange}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSubmit(e);
              }
              if (e.key === 'Escape') {
                setReplyTo(null);
                setEditingMsg(null);
                setInputValue('');
              }
            }}
            placeholder={
              editingMsg ? 'Edit your message...'
                : replyTo ? `Reply to ${replyTo.senderName}...`
                  : 'Type a message... (@ to mention)'
            }
            className={`w-full resize-none rounded-lg border ${
              theme === 'dark'
                ? 'bg-[#0d1117] border-white/10 text-slate-200 focus:border-indigo-500'
                : 'bg-slate-50 border-slate-300 text-slate-800 focus:border-indigo-500'
            } p-2.5 pr-10 text-xs focus:outline-none custom-scrollbar`}
            rows="2"
          />
          <button
            type="submit"
            disabled={!inputValue.trim()}
            className={`absolute right-2 bottom-3 p-1.5 rounded-md transition-colors ${
              inputValue.trim()
                ? 'bg-indigo-600 text-white hover:bg-indigo-500 cursor-pointer'
                : 'bg-transparent text-slate-400 cursor-not-allowed'
            }`}
          >
            <Send size={14} />
          </button>
        </form>
        <div className={`text-[9px] mt-1 px-1 ${textMuted}`}>
          ``` for code • @name to mention • Shift+Enter for new line
        </div>
      </div>
    </div>
  );
}
