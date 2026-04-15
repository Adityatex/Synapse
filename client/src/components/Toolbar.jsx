import { useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useFiles } from '../contexts/FileContext';
import { executeCode } from '../services/api';
import { getThemeClasses } from '../utils/theme';
import { LANGUAGES, getLanguageByExtension } from '../utils/languageMap';
import {
  Code2,
  LayoutGrid,
  Play,
  CloudUpload,
  Check,
  ChevronDown,
  Keyboard,
  X,
  Sun,
  Moon,
  Copy,
  Share2
} from 'lucide-react';

export default function Toolbar({ 
  theme, 
  onToggleTheme, 
  setOutput, 
  onSaveVersion,
  roomId,
  roomName,
  copied,
  onCopyInvite,
  currentUser
}) {
  const { activeFile, renameFile } = useFiles();
  const [isRunning, setIsRunning] = useState(false);
  const [isStdinOpen, setIsStdinOpen] = useState(false);
  const [stdinValue, setStdinValue] = useState('');
  const [saveStatus, setSaveStatus] = useState('idle');

  const t = getThemeClasses(theme);
  const currentLang = activeFile ? getLanguageByExtension(activeFile.name) : LANGUAGES[0];
  const showRoomControls = Boolean(roomId || onCopyInvite);

  const handleRun = useCallback(async () => {
    if (!activeFile || isRunning) return;

    setIsRunning(true);
    setOutput({
      stdout: '',
      stderr: '',
      compile_output: '',
      status: null,
      error: null,
      running: true,
    });

    try {
      const result = await executeCode(
        activeFile.content,
        currentLang.id,
        stdinValue
      );
      setOutput({
        ...result,
        error: null,
        running: false,
      });
    } catch (error) {
      setOutput({
        stdout: '',
        stderr: '',
        compile_output: '',
        status: { description: 'Error' },
        error: error.message,
        running: false,
      });
    } finally {
      setIsRunning(false);
    }
  }, [activeFile, currentLang, stdinValue, isRunning, setOutput]);

  const handleSave = () => {
    if (onSaveVersion) {
      setSaveStatus('saving');
      onSaveVersion();
      setTimeout(() => setSaveStatus('saved'), 1500);
      setTimeout(() => setSaveStatus('idle'), 4000);
    }
  };

  const getInitials = (name) => {
    return name ? name.charAt(0).toUpperCase() : 'A';
  };

  return (
    <header className={`h-12 border-b ${t.border} flex items-center justify-between pr-4 pl-2 ${t.header} relative z-50 shadow-sm shrink-0`}>
      <div className="flex items-center flex-1">
        <div className="w-[312px] flex items-center shrink-0">
          <Link to="/" className="flex items-center hover:opacity-80 transition-opacity">
            <div className="w-12 flex items-center justify-center shrink-0">
              <div className="flex w-6 h-6 bg-gradient-to-br from-indigo-500 to-purple-600 rounded drop-shadow-[0_0_12px_rgba(99,102,241,0.35)] items-center justify-center">
                <Code2 size={14} className="text-white" />
              </div>
            </div>
            <span className={`ml-1 font-black uppercase tracking-[-0.04em] ${theme === 'dark' ? 'text-white' : 'text-slate-800'} text-sm`} style={{ fontFamily: "'Sora', 'Inter', sans-serif" }}>SYNAPSE</span>
          </Link>
          <Link 
            to="/dashboard"
            className={`hidden md:flex ml-6 items-center gap-1.5 px-2.5 py-1 ${theme === 'dark' ? 'bg-white/5 hover:bg-white/10 text-slate-300' : 'bg-slate-100 hover:bg-slate-200 text-slate-700'} rounded border ${t.border} text-[11px] font-medium transition-colors`}
          >
            <LayoutGrid size={12} />
            Dashboard
          </Link>
        </div>
        
        <div className="w-2 shrink-0" />
        
        <div className="hidden md:flex items-center gap-2">
          {/* Run Button */}
          <button 
            onClick={handleRun}
            disabled={isRunning || !activeFile}
            className={`flex items-center gap-2 px-3 py-1 ${theme === 'dark' ? 'bg-white/5 hover:bg-white/10' : 'bg-slate-100 hover:bg-slate-200'} rounded-md cursor-pointer transition-colors border ${t.border} group disabled:opacity-50`}
          >
            {isRunning ? (
              <div className="w-3.5 h-3.5 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
            ) : (
              <Play size={14} className="text-emerald-500 fill-emerald-500 group-hover:scale-110 transition-transform" />
            )}
            <span className={`text-xs font-medium ${theme === 'dark' ? 'text-emerald-50' : 'text-emerald-700'}`}>
              {isRunning ? 'Running...' : 'Run'}
            </span>
          </button>

          {/* Save Version Button */}
          {onSaveVersion && (
            <button 
              onClick={handleSave}
              className={`flex items-center gap-2 px-3 py-1 ${theme === 'dark' ? 'bg-white/5 hover:bg-white/10' : 'bg-slate-100 hover:bg-slate-200'} rounded-md cursor-pointer transition-colors border ${t.border} group`}
            >
              {saveStatus === 'saving' ? (
                <div className="w-3.5 h-3.5 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
              ) : saveStatus === 'saved' ? (
                <Check size={14} className="text-indigo-500" />
              ) : (
                <CloudUpload size={14} className="text-indigo-500 group-hover:scale-110 transition-transform" />
              )}
              <span className={`text-xs font-medium ${saveStatus === 'saved' ? 'text-indigo-500' : theme === 'dark' ? 'text-indigo-50' : 'text-indigo-700'}`}>
                {saveStatus === 'saving' ? 'Saving...' : saveStatus === 'saved' ? 'Version Saved' : 'Save Version'}
              </span>
            </button>
          )}

          <div className="relative group pb-2 -mb-2">
            <button className={`flex items-center gap-2 px-3 py-1 ${theme === 'dark' ? 'bg-white/5 hover:bg-white/10' : 'bg-slate-100 hover:bg-slate-200'} rounded-md border ${t.border} text-xs ${theme === 'dark' ? 'text-slate-300' : 'text-slate-700'} cursor-pointer`}>
              <span>{currentLang.name}</span>
              <ChevronDown size={12} className={t.textMuted} />
            </button>
            <div className={`absolute top-[calc(100%-8px)] left-0 mt-2 w-32 ${theme === 'dark' ? 'bg-[#161b22]' : 'bg-white'} border ${t.border} rounded-md shadow-xl hidden group-hover:block overflow-hidden animate-in fade-in zoom-in-95 duration-100`}>
              {LANGUAGES.map(lang => (
                <div 
                  key={lang.id}
                  onClick={() => {
                    if (activeFile && lang.id !== currentLang.id) {
                      const lastDotIndex = activeFile.name.lastIndexOf('.');
                      const baseName = lastDotIndex > 0 ? activeFile.name.substring(0, lastDotIndex) : activeFile.name;
                      const newName = baseName + lang.extension;
                      renameFile(activeFile.id, newName);
                    }
                  }}
                  className="px-3 py-2 hover:bg-indigo-600 hover:text-white text-xs cursor-pointer transition-colors"
                >
                  {lang.name}
                </div>
              ))}
            </div>
          </div>

          {/* Std In Button */}
          <div className="relative">
            <button 
              onClick={() => setIsStdinOpen(!isStdinOpen)}
              className={`flex items-center gap-2 px-3 py-1 rounded-md border transition-colors text-xs cursor-pointer ${isStdinOpen ? 'bg-indigo-600/20 border-indigo-500 text-indigo-500' : theme === 'dark' ? 'bg-white/5 border-white/5 hover:bg-white/10 text-slate-300' : 'bg-slate-100 border-slate-200 hover:bg-slate-200 text-slate-700'}`}
            >
              <Keyboard size={14} />
              <span>stdin</span>
            </button>

            {isStdinOpen && (
              <div className={`absolute top-full left-0 mt-1 w-72 ${theme === 'dark' ? 'bg-[#161b22]' : 'bg-white'} border ${t.border} rounded-md shadow-2xl p-3 flex flex-col gap-2 animate-in slide-in-from-top-2 duration-150`}>
                <div className={`flex justify-between items-center text-[11px] font-bold ${t.textMuted} uppercase`}>
                  Standard Input
                  <X size={12} className="cursor-pointer hover:text-indigo-500" onClick={() => setIsStdinOpen(false)} />
                </div>
                <textarea 
                  autoFocus
                  value={stdinValue}
                  onChange={(e) => setStdinValue(e.target.value)}
                  placeholder="Enter inputs here..."
                  className={`w-full h-32 ${theme === 'dark' ? 'bg-[#0d1117]' : 'bg-slate-50'} border ${t.border} rounded p-2 text-xs font-mono focus:outline-none focus:border-indigo-500 ${theme === 'dark' ? 'text-slate-200' : 'text-slate-800'} resize-none`}
                />
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3">
        {/* Theme Toggle Button */}
        <button 
          onClick={onToggleTheme}
          className={`p-1.5 rounded-full cursor-pointer ${theme === 'dark' ? 'hover:bg-white/10 text-orange-300' : 'hover:bg-slate-100 text-slate-600'} transition-all`}
          title={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
        >
          {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
        </button>

        {showRoomControls && (
          <div className={`hidden lg:flex items-center gap-3 px-3 py-1 ${theme === 'dark' ? 'bg-[#0d1117]' : 'bg-slate-100'} rounded border ${t.border}`}>
            <div className="flex flex-col items-start leading-tight">
              <span className={`text-[11px] font-bold ${theme === 'dark' ? 'text-white' : 'text-slate-800'} truncate max-w-[150px] uppercase tracking-wide`}>
                {roomName || 'Untitled Project'}
              </span>
              <span className={`text-[10px] ${t.textMuted} font-mono uppercase tracking-tighter`}>
                ID: {roomId}
              </span>
            </div>
            <button 
              onClick={onCopyInvite}
              className={`ml-1 p-1 hover:bg-white/5 rounded cursor-pointer transition-colors ${t.textMuted} hover:text-indigo-500`}
              title="Copy invite link"
            >
              {copied ? <Check size={12} className="text-emerald-500" /> : <Copy size={12} />}
            </button>
          </div>
        )}
        {showRoomControls && (
          <button 
            onClick={onCopyInvite}
            className="flex items-center gap-2 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded cursor-pointer text-xs font-medium transition-all shadow-lg shadow-indigo-900/20"
          >
            <Share2 size={14} />
            Invite
          </button>
        )}
        <div className="w-8 h-8 rounded-full bg-blue-500 flex items-center justify-center text-[11px] font-bold text-white border-2 border-white/20 select-none">
          {getInitials(currentUser?.name)}
        </div>
      </div>
    </header>
  );
}
