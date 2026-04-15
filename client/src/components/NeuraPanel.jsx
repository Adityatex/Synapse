import React, { useState, useEffect, useRef, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { 
  MessageSquarePlus, 
  History, 
  Send, 
  Sparkles, 
  Code2, 
  Bug, 
  Zap,
  ChevronDown,
  Terminal,
  Eraser,
  Copy,
  Check,
  Trash2,
  ChevronRight,
  LoaderCircle
} from 'lucide-react';
import { useFiles } from '../contexts/FileContext';
import { readStorage, writeStorage } from '../utils/storage';
import {
  chatWithNeura,
  createNeuraConversation,
  getNeuraConversation,
  getNeuraConversationHistory,
  deleteNeuraConversation
} from '../services/aiService';
import { copyText } from '../utils/clipboard';

const PANEL_WIDTH_KEY = 'synapse-neura-width';
const MIN_PANEL_WIDTH = 300;
const MAX_PANEL_WIDTH = 720;

function formatConversationTime(value) {
  if (!value) return '';
  const date = new Date(value);
  return date.toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
  });
}

function CodeBlock({ inline, className, children, theme }) {
  const [copied, setCopied] = useState(false);
  const match = /language-([\w-]+)/.exec(className || '');
  const language = match?.[1] || 'code';
  const code = String(children).replace(/\n$/, '');

  if (inline) {
    return (
      <code className={`px-1.5 py-0.5 rounded-md font-mono text-[11px] ${
        theme === 'dark' ? 'bg-white/10 text-indigo-200' : 'bg-indigo-50 text-indigo-600'
      }`}>
        {children}
      </code>
    );
  }

  const handleCopy = async () => {
    try {
      const didCopy = await copyText(code);
      if (!didCopy) {
        throw new Error('Copy failed');
      }
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className={`my-3 overflow-hidden rounded-xl border ${
      theme === 'dark' ? 'border-white/10 bg-[#0d0d17]' : 'border-slate-200 bg-slate-50'
    }`}>
      <div className={`flex items-center justify-between px-3 py-2 text-[10px] uppercase tracking-[0.18em] border-b ${
        theme === 'dark' ? 'border-white/10 bg-white/5 text-slate-400' : 'border-slate-200 bg-slate-100 text-slate-500'
      }`}>
        <span>{language}</span>
        <button
          type="button"
          onClick={handleCopy}
          className={`inline-flex items-center gap-1 rounded-md px-2 py-1 normal-case tracking-normal transition-colors ${
            theme === 'dark' ? 'text-slate-300 hover:bg-white/10' : 'text-slate-600 hover:bg-slate-200'
          }`}
          title="Copy code"
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
          <span>{copied ? 'Copied' : 'Copy'}</span>
        </button>
      </div>
      <pre className="overflow-x-auto p-3 custom-scrollbar">
        <code className={`font-mono text-[11px] leading-5 ${
          theme === 'dark' ? 'text-slate-200' : 'text-slate-800'
        }`}>
          {code}
        </code>
      </pre>
    </div>
  );
}

function AssistantMessage({ content, theme }) {
  return (
    <div className={`prose prose-sm max-w-none break-words prose-p:my-2 prose-headings:my-2 prose-ul:my-2 prose-ol:my-2 prose-li:my-1 prose-strong:text-inherit ${
      theme === 'dark' ? 'prose-invert' : 'prose-slate'
    }`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p({ children }) {
            return <p className="break-words whitespace-pre-wrap m-0">{children}</p>;
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
  );
}

export default function NeuraPanel({ theme }) {
  const { files, activeFile } = useFiles();
  const panelRef = useRef(null);
  const resizeStateRef = useRef(null);
  const hasLoadedRef = useRef(false);
  const messagesEndRef = useRef(null);
  const [isOpen, setIsOpen] = useState(false);
  const [panelWidth, setPanelWidth] = useState(() => {
    const savedWidth = Number(readStorage(PANEL_WIDTH_KEY));
    if (Number.isFinite(savedWidth) && savedWidth >= MIN_PANEL_WIDTH && savedWidth <= MAX_PANEL_WIDTH) {
      return savedWidth;
    }
    return 400;
  });

  const [inputValue, setInputValue] = useState('');
  const [messages, setMessages] = useState([]);
  const [conversations, setConversations] = useState([]);
  const [activeConversationId, setActiveConversationId] = useState(null);
  const [isSending, setIsSending] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [isLoadingConversation, setIsLoadingConversation] = useState(false);
  const [isCreatingConversation, setIsCreatingConversation] = useState(false);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState('chat'); // 'chat' or 'history'

  useEffect(() => {
    writeStorage(PANEL_WIDTH_KEY, String(panelWidth));
  }, [panelWidth]);

  useEffect(() => {
    const handlePointerMove = (event) => {
      const resizeState = resizeStateRef.current;
      if (!resizeState) return;

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

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    if (activeTab === 'chat') {
      scrollToBottom();
    }
  }, [messages, isSending, activeConversationId, activeTab]);

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

  const upsertConversation = (conversation, options = {}) => {
    if (!conversation?._id) return;

    setConversations((current) => {
      const filtered = current.filter((entry) => entry._id !== conversation._id);
      const next = [conversation, ...filtered];
      if (options.keepOrder) {
        return next;
      }
      return next.sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
    });
  };

  const loadConversationList = async () => {
    setIsLoadingHistory(true);
    setError('');

    try {
      const history = await getNeuraConversationHistory();
      setConversations(history);

      if (history.length > 0) {
        setActiveConversationId(history[0]._id);
        setIsLoadingConversation(true);
        const conversationData = await getNeuraConversation(history[0]._id);
        setMessages(conversationData.messages || []);
      } else {
        setActiveConversationId(null);
        setMessages([
          {
            _id: 'welcome',
            role: 'assistant',
            content: "Hello! I'm Neura AI. I've indexed your current workspace. How can I help you today?",
            createdAt: new Date().toISOString()
          }
        ]);
      }
    } catch (requestError) {
      setError(requestError.message || 'Unable to load conversation history.');
    } finally {
      setIsLoadingHistory(false);
      setIsLoadingConversation(false);
    }
  };

  useEffect(() => {
    if (!isOpen || hasLoadedRef.current) return;
    
    hasLoadedRef.current = true;
    loadConversationList();
  }, [isOpen]);

  const handleLoadConversation = async (conversationId) => {
    if (!conversationId || conversationId === activeConversationId) return;

    setIsLoadingConversation(true);
    setError('');

    try {
      const data = await getNeuraConversation(conversationId);
      setActiveConversationId(conversationId);
      setMessages(data.messages || []);
      if (data.conversation) {
        upsertConversation(data.conversation, { keepOrder: true });
      }
      setActiveTab('chat');
    } catch (requestError) {
      setError(requestError.message || 'Unable to load that conversation.');
    } finally {
      setIsLoadingConversation(false);
    }
  };

  const handleNewChat = async () => {
    setIsCreatingConversation(true);
    setError('');

    try {
      const conversation = await createNeuraConversation();
      setActiveConversationId(conversation._id);
      setMessages([
          {
            _id: 'welcome',
            role: 'assistant',
            content: "Hello! I'm Neura AI. I've indexed your current workspace. How can I help you today?",
            createdAt: new Date().toISOString()
          }
      ]);
      setInputValue('');
      upsertConversation(conversation);
      setActiveTab('chat');
    } catch (requestError) {
      setError(requestError.message || 'Unable to start a new chat.');
    } finally {
      setIsCreatingConversation(false);
    }
  };

  const deleteHistoryItem = async (e, conversationId) => {
    e.stopPropagation();
    try {
      await deleteNeuraConversation(conversationId);
      setConversations(prev => prev.filter(c => c._id !== conversationId));
      if (activeConversationId === conversationId) {
        setActiveConversationId(null);
        setMessages([
          {
            _id: 'welcome',
            role: 'assistant',
            content: "Hello! I'm Neura AI. I've indexed your current workspace. How can I help you today?",
            createdAt: new Date().toISOString()
          }
        ]);
        setActiveTab('chat');
      }
    } catch {
      setError('Failed to delete conversation');
    }
  };

  const handleSend = async (messageOverride = null) => {
    const messageToSend = messageOverride !== null && typeof messageOverride === 'string' ? messageOverride : inputValue;
    const trimmedMessage = String(messageToSend || '').trim();
    if (!trimmedMessage || isSending) return;

    const optimisticUserMessage = {
      _id: `temp-user-${Date.now()}`,
      role: 'user',
      content: trimmedMessage,
      createdAt: new Date().toISOString(),
    };

    setMessages((current) => [...current.filter(m => m._id !== 'welcome'), optimisticUserMessage]);
    setInputValue('');
    setIsSending(true);
    setError('');

    try {
      const response = await chatWithNeura({
        message: trimmedMessage,
        conversationId: activeConversationId,
        context: fileContext,
      });

      setActiveConversationId(response.conversationId);
      if (response.conversation) {
        upsertConversation(response.conversation);
      }

      setMessages((current) => {
        const withoutOptimistic = current.filter((entry) => entry._id !== optimisticUserMessage._id);
        return [
          ...withoutOptimistic,
          response.userMessage || optimisticUserMessage,
          response.assistantMessage || {
            _id: `assistant-${Date.now()}`,
            role: 'assistant',
            content: response.reply,
            createdAt: new Date().toISOString(),
          },
        ];
      });
    } catch (requestError) {
      setMessages((current) => current.filter((entry) => entry._id !== optimisticUserMessage._id));
      setError(requestError.message || 'Neura could not respond right now.');
    } finally {
      setIsSending(false);
    }
  };

  // UI mapping
  if (!isOpen) {
    return (
      <div className={`w-12 border ${theme === 'dark' ? 'bg-[#0d1117] border-white/10 shadow-black/50' : 'bg-slate-200/80 border-slate-300 shadow-slate-200/50'} rounded-xl shadow-lg flex flex-col items-center py-4 shrink-0 transition-all duration-300 overflow-hidden`}>
        <button
          onClick={() => setIsOpen(true)}
          className={`relative flex items-center justify-center w-8 h-8 rounded-lg outline-none overflow-hidden group border border-transparent hover:border-indigo-500/50 transition-all shadow-lg ${theme === 'dark' ? 'shadow-indigo-900/20' : 'shadow-indigo-200/50 cursor-pointer'}`}
          title="Open Neura AI Assistant"
        >
          <div className="absolute inset-0 bg-gradient-to-br from-indigo-500 to-indigo-600 opacity-80 group-hover:opacity-100 transition-opacity" />
          <Sparkles className="w-4 h-4 text-white relative z-10" />
        </button>
      </div>
    );
  }

  return (
    <aside
      ref={panelRef}
      style={{ width: `${panelWidth}px` }}
      className={`relative flex flex-col transition-[width] duration-200 shrink-0 rounded-2xl overflow-hidden shadow-xl min-w-0 border ${
        theme === 'dark' ? 'bg-[#0d0d17] border-white/10 shadow-black/50 text-slate-300' : 'bg-slate-50 border-slate-200 shadow-slate-200/50 text-slate-700'
      }`}
    >
      <button
        type="button"
        aria-label="Resize Neura panel"
        onPointerDown={startResizing}
        className={`absolute left-0 top-0 z-20 h-full w-3 -translate-x-1/2 cursor-col-resize hover:bg-white/5`}
      >
        <span className="sr-only">Resize</span>
      </button>

      {/* Main Container */}
      <div className="flex flex-col w-full h-full relative font-sans">
        {/* Header Section */}
        <header className={`px-4 py-3 border-b flex items-center justify-between shrink-0 ${
          theme === 'dark' ? 'border-white/5 bg-[#12121f]' : 'border-slate-200 bg-white'
        }`}>
          <div className="flex items-center gap-3">
            <div className="relative">
              <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center shadow-lg shadow-indigo-500/20">
                <Sparkles className="w-4 h-4 text-white" />
              </div>
              <div className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 bg-green-500 border-2 rounded-full ${
                theme === 'dark' ? 'border-[#12121f]' : 'border-white'
              }`}></div>
            </div>
            <div>
              <h2 className={`text-sm font-semibold tracking-tight ${theme === 'dark' ? 'text-white' : 'text-slate-900'}`}>Neura AI</h2>
            </div>
          </div>
          
          <div className="flex items-center gap-1">
            <button 
              className={`p-1.5 rounded-md transition-colors ${
                theme === 'dark' ? 'hover:bg-white/5 text-slate-400' : 'hover:bg-slate-100 text-slate-500'
              }`} 
              title="New Chat"
              onClick={handleNewChat}
              disabled={isCreatingConversation || isSending}
            >
               {isCreatingConversation ? <LoaderCircle className="w-4 h-4 animate-spin" /> : <MessageSquarePlus className="w-4 h-4" />}
            </button>
            <button
               onClick={() => setIsOpen(false)}
               className={`p-1.5 rounded-md transition-colors ${
                theme === 'dark' ? 'hover:bg-white/5 text-slate-400' : 'hover:bg-slate-100 text-slate-500'
              }`}
               title="Close Panel"
            >
               <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </header>

        {/* Action Quick-Tabs */}
        <div className={`flex items-center gap-2 px-4 py-2 border-b overflow-x-auto no-scrollbar shrink-0 ${
          theme === 'dark' ? 'border-white/5 bg-[#0d0d17]/50' : 'border-slate-200 bg-slate-50/50'
        }`}>
          <button onClick={() => handleSend("Explain the current code")} disabled={isSending} className="flex items-center gap-1.5 px-2.5 py-1.5 bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 rounded-md text-xs whitespace-nowrap hover:bg-indigo-500/20 transition-all">
            <Zap className="w-3 h-3" />
            Explain Code
          </button>
          <button onClick={() => handleSend("Find bugs in the current code")} disabled={isSending} className={`flex items-center gap-1.5 px-2.5 py-1.5 border rounded-md text-xs whitespace-nowrap transition-all ${
            theme === 'dark' ? 'bg-white/5 text-slate-400 border-white/10 hover:bg-white/10' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
          }`}>
            <Bug className="w-3 h-3" />
            Find Bugs
          </button>
          <button onClick={() => handleSend("Refactor the current code")} disabled={isSending} className={`flex items-center gap-1.5 px-2.5 py-1.5 border rounded-md text-xs whitespace-nowrap transition-all ${
            theme === 'dark' ? 'bg-white/5 text-slate-400 border-white/10 hover:bg-white/10' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
          }`}>
            <Code2 className="w-3 h-3" />
            Refactor
          </button>
        </div>

        {/* History / Chat Toggle */}
        <div className={`flex px-4 py-2 text-[11px] font-medium uppercase tracking-wider border-b shrink-0 ${
          theme === 'dark' ? 'text-slate-500 border-white/5' : 'text-slate-400 border-slate-200'
        }`}>
          <button 
            onClick={() => setActiveTab('chat')}
            className={`mr-4 pb-1 border-b-2 transition-all ${activeTab === 'chat' ? 'border-indigo-500 text-indigo-500' : 'border-transparent hover:text-slate-300'}`}
          >
            Chat
          </button>
          <button 
            onClick={() => setActiveTab('history')}
            className={`pb-1 border-b-2 transition-all ${activeTab === 'history' ? 'border-indigo-500 text-indigo-500' : 'border-transparent hover:text-slate-300'}`}
          >
            History
          </button>
        </div>

        {/* Main Content Area */}
        <main className="flex-1 overflow-x-hidden overflow-y-auto p-4 space-y-6 custom-scrollbar min-w-0 flex flex-col pb-6">
          {activeTab === 'chat' ? (
            <>
              {isLoadingConversation ? (
                <div className="flex items-center gap-2 rounded-xl border border-white/5 px-4 py-3 text-[11px] text-slate-400 mx-auto mt-4">
                  <LoaderCircle size={13} className="animate-spin" />
                  <span>Loading conversation...</span>
                </div>
              ) : messages.map((msg, idx) => {
                const timeStr = msg.createdAt ? new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                return (
                 <div key={msg._id || idx} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'} group animate-in fade-in slide-in-from-bottom-2 duration-300 w-full`}>
                   <div className="flex items-center gap-2 mb-1.5 px-1">
                     <span className={`text-[10px] font-bold uppercase tracking-tighter ${
                        theme === 'dark' ? 'text-slate-500' : 'text-slate-400'
                     }`}>
                       {msg.role === 'user' ? 'You' : 'Neura AI'}
                     </span>
                     <span className="text-[10px] text-slate-600">{timeStr}</span>
                   </div>
                   
                   <div className={`max-w-[90%] px-3.5 py-2.5 rounded-xl text-sm leading-relaxed shadow-sm break-words overflow-hidden ${
                     msg.role === 'user' 
                       ? 'bg-indigo-600 text-white rounded-tr-none' 
                       : theme === 'dark' 
                         ? 'bg-[#1a1a2e] text-slate-200 border border-white/5 rounded-tl-none'
                         : 'bg-white text-slate-800 border border-slate-200 shadow-sm rounded-tl-none'
                   }`}>
                     {msg.role === 'user' ? (
                       <div className="whitespace-pre-wrap">{msg.content}</div>
                     ) : (
                       <AssistantMessage content={msg.content} theme={theme} />
                     )}
                     
                     {msg.role === 'assistant' && msg._id === 'welcome' && (activeFile || files.length > 0) && (
                       <div className={`mt-3 p-2 rounded border font-mono text-[11px] ${
                          theme === 'dark' ? 'bg-black/30 border-white/5 text-indigo-300' : 'bg-indigo-50 border-indigo-100 text-indigo-600'
                       }`}>
                         <div className="flex items-center justify-between opacity-60">
                           <span>Context: {activeFile ? activeFile.name : 'Workspace'}</span>
                           <Terminal className="w-3 h-3" />
                         </div>
                       </div>
                     )}
                   </div>
                   
                   {msg.role === 'assistant' && (
                     <div className="flex gap-2 mt-2 ml-1 opacity-0 group-hover:opacity-100 transition-opacity">
                       <button onClick={() => { copyText(msg.content); }} className={`p-1 rounded transition-colors ${
                          theme === 'dark' ? 'hover:bg-white/5 text-slate-500 hover:text-slate-300' : 'hover:bg-slate-100 text-slate-400 hover:text-slate-600'
                       }`} title="Copy to clipboard">
                         <Copy className="w-3 h-3" />
                       </button>
                     </div>
                   )}
                 </div>
              )})}

              {isSending && (
                <div className="flex flex-col items-start group animate-in fade-in slide-in-from-bottom-2 duration-300 w-full">
                  <div className="flex items-center gap-2 mb-1.5 px-1">
                    <span className={`text-[10px] font-bold uppercase tracking-tighter ${
                        theme === 'dark' ? 'text-slate-500' : 'text-slate-400'
                    }`}>
                      Neura AI
                    </span>
                  </div>
                  <div className={`max-w-[90%] px-4 py-3 rounded-xl border rounded-tl-none text-[11px] ${
                    theme === 'dark' ? 'bg-[#1a1a2e] border-white/5 text-slate-200' : 'bg-white border-slate-200 text-slate-700 shadow-sm'
                  }`}>
                    <div className="flex items-center gap-2">
                       <LoaderCircle size={13} className="animate-spin text-indigo-400" />
                       <span>Neura is thinking...</span>
                    </div>
                  </div>
                </div>
              )}

              {error && (
                <div className="text-[11px] rounded-lg border px-3 py-2 border-rose-500/30 text-rose-300 bg-rose-500/10 mx-auto my-2">
                  {error}
                </div>
              )}

              <div ref={messagesEndRef} className="h-4 w-full" />
            </>
          ) : (
            <div className="space-y-1">
              {isLoadingHistory ? (
                <div className="flex items-center justify-center gap-2 py-6 text-[11px] text-slate-500">
                  <LoaderCircle size={13} className="animate-spin" />
                  <span>Loading chats...</span>
                </div>
              ) : conversations.length > 0 ? (
                conversations.map((item) => {
                  const isActive = item._id === activeConversationId;
                  return (
                    <div key={item._id} className="relative group/item">
                      <button 
                         onClick={() => handleLoadConversation(item._id)}
                         className={`w-full flex items-center justify-between p-2.5 pr-10 rounded-lg text-left transition-colors border ${
                           isActive 
                             ? 'bg-indigo-500/10 border-indigo-500/20' 
                             : theme === 'dark' 
                               ? 'hover:bg-white/5 border-transparent' 
                               : 'hover:bg-slate-100 border-transparent'
                         }`}
                      >
                        <div className="flex items-center gap-3 truncate">
                          <History className={`w-3.5 h-3.5 ${isActive ? 'text-indigo-400' : 'text-slate-600 group-hover/item:text-indigo-400'}`} />
                          <span className={`text-sm truncate ${isActive ? 'text-indigo-500 font-medium' : theme === 'dark' ? 'text-slate-400 group-hover/item:text-slate-200' : 'text-slate-600 group-hover/item:text-slate-900'}`}>{item.title}</span>
                        </div>
                        <span className="text-[10px] text-slate-500 whitespace-nowrap group-hover/item:hidden transition-all shrink-0 ml-2">
                           {formatConversationTime(item.updatedAt)}
                        </span>
                      </button>
                      
                      <button 
                        onClick={(e) => deleteHistoryItem(e, item._id)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 opacity-0 group-hover/item:opacity-100 hover:bg-red-500/10 text-slate-500 hover:text-red-500 rounded-md transition-all z-10"
                        title="Delete chat"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )
                })
              ) : (
                <div className="flex flex-col items-center justify-center py-10 opacity-40">
                  <History className="w-8 h-8 mb-2" />
                  <p className="text-xs">No chat history</p>
                </div>
              )}
            </div>
          )}
        </main>

        {/* Footer Input Section */}
        {activeTab === 'chat' && (
          <footer className={`p-4 border-t shrink-0 z-10 relative ${
            theme === 'dark' ? 'bg-[#12121f] border-white/5' : 'bg-white border-slate-200'
          }`}>
            <div className="relative group">
              <textarea
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                maxLength={4000}
                placeholder="Ask for fixes, architecture advice..."
                className={`w-full min-h-[100px] border rounded-xl p-3 pt-2 text-sm placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-indigo-500/50 focus:border-indigo-500/50 transition-all resize-none shadow-inner ${
                  theme === 'dark' ? 'bg-[#0d0d17] border-white/10 text-slate-200' : 'bg-slate-50 border-slate-200 text-slate-800'
                }`}
              />
              
              <div className="absolute bottom-3 left-3 flex items-center gap-3">
                <button className="text-slate-500 hover:text-slate-400 transition-colors">
                  <ChevronDown className="w-4 h-4" />
                </button>
                <div className={`h-4 w-px ${theme === 'dark' ? 'bg-white/10' : 'bg-slate-200'}`}></div>
                <span className="text-[10px] font-medium text-slate-500">{inputValue.trim().length}/4000</span>
              </div>

              <div className="absolute bottom-3 right-3 flex items-center gap-1">
                <button 
                  onClick={() => setInputValue('')}
                  className={`p-1.5 hover:bg-red-400/10 rounded-md transition-all ${
                    theme === 'dark' ? 'text-slate-500 hover:text-red-400' : 'text-slate-400 hover:text-red-500'
                  }`}
                  title="Clear input"
                >
                  <Eraser className="w-4 h-4" />
                </button>
                <button 
                  onClick={() => handleSend()}
                  disabled={!inputValue.trim() || isSending}
                  className={`flex items-center justify-center p-2 rounded-lg transition-all ${
                    inputValue.trim() && !isSending
                      ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/30 scale-100 hover:scale-105 active:scale-95' 
                      : theme === 'dark' ? 'bg-white/5 text-slate-700 cursor-not-allowed' : 'bg-slate-100 text-slate-300 cursor-not-allowed'
                  }`}
                >
                  <Send className="w-4 h-4" />
                </button>
              </div>
            </div>
            
            <div className="mt-3 flex items-center justify-center gap-2">
              <p className={`text-[10px] flex items-center gap-1 overflow-hidden max-w-full ${
                theme === 'dark' ? 'text-slate-600' : 'text-slate-500'
              }`}>
                <Check className="w-3 h-3 text-green-500/50 shrink-0" />
                <span className="truncate">Context: {activeFile ? activeFile.name : 'Current workspace'}</span>
              </p>
            </div>
          </footer>
        )}
      </div>

      <style dangerouslySetInnerHTML={{ __html: `
        .no-scrollbar::-webkit-scrollbar { display: none; }
        .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
        
        .custom-scrollbar::-webkit-scrollbar {
          width: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.05);
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: rgba(255, 255, 255, 0.1);
        }
      `}} />
    </aside>
  );
}
