import { useState, useCallback } from 'react';
import { useFiles } from '../contexts/FileContext';
import { LANGUAGES, getLanguageByExtension } from '../utils/languageMap';
import { executeCode } from '../services/api';
import {
  Play,
  Sun,
  Moon,
  ChevronDown,
  Loader2,
  Terminal,
  Zap,
} from 'lucide-react';

export default function Toolbar({ theme, onToggleTheme, output, setOutput }) {
  const { activeFile, renameFile } = useFiles();
  const [isRunning, setIsRunning] = useState(false);
  const [stdinOpen, setStdinOpen] = useState(false);
  const [stdin, setStdin] = useState('');
  const [langDropdownOpen, setLangDropdownOpen] = useState(false);

  const currentLang = activeFile ? getLanguageByExtension(activeFile.name) : LANGUAGES[0];

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
        stdin
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
  }, [activeFile, currentLang, stdin, isRunning, setOutput]);

  return (
    <div
      className="flex items-center justify-between px-8 shrink-0"
      style={{
        height: 'var(--toolbar-height)',
        background: 'var(--bg-secondary)',
        borderBottom: '1px solid var(--border-primary)',
      }}
    >
      {/* Left section */}
      <div className="flex items-center gap-3">
        {/* Logo */}
        <div className="flex items-center gap-2 mr-4">
          <Zap size={20} style={{ color: 'var(--accent-blue)' }} />
          <span
            className="text-[15px] font-bold tracking-widest"
            style={{
              background: 'linear-gradient(135deg, var(--accent-blue), var(--accent-purple))',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
            }}
          >
            SYNAPSE
          </span>
        </div>

        {/* Separator */}
        <div
          className="w-px h-6 mx-2"
          style={{ background: 'var(--border-primary)' }}
        />

        {/* Run button */}
        <button
          onClick={handleRun}
          disabled={isRunning || !activeFile}
          className="flex items-center gap-2 px-6 py-2.5 rounded-md text-[13px] font-semibold tracking-wide transition-all duration-300 cursor-pointer whitespace-nowrap shrink-0"
          style={{
            background: isRunning ? 'var(--bg-hover)' : 'var(--accent-green)',
            color: isRunning ? 'var(--text-secondary)' : '#fff',
            opacity: !activeFile ? 0.5 : 1,
            boxShadow: !isRunning && activeFile ? 'var(--shadow-sm)' : 'none',
          }}
          onMouseEnter={(e) => {
            if (!isRunning && activeFile) {
              e.currentTarget.style.transform = 'scale(1.03)';
              e.currentTarget.style.boxShadow = '0 0 12px rgba(63, 185, 80, 0.3)';
            }
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = 'scale(1)';
            e.currentTarget.style.boxShadow = 'none';
          }}
        >
          {isRunning ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <Play size={16} fill="currentColor" />
          )}
          {isRunning ? 'Running...' : 'Run'}
        </button>

        {/* Language indicator */}
        <div className="relative ml-2">
          <button
            className="flex items-center gap-2 px-4 py-2 rounded-md text-[13px] transition-all duration-300 cursor-pointer whitespace-nowrap shrink-0 font-medium"
            style={{
              background: 'var(--bg-tertiary)',
              color: 'var(--text-secondary)',
              border: '1px solid var(--border-primary)',
              boxShadow: 'var(--shadow-sm)',
            }}
            onClick={() => setLangDropdownOpen(!langDropdownOpen)}
            onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'var(--accent-blue)')}
            onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'var(--border-primary)')}
          >
            <span>{currentLang.icon}</span>
            <span>{currentLang.name}</span>
            <ChevronDown size={12} />
          </button>

          {langDropdownOpen && (
            <>
              <div
                className="fixed inset-0 z-40"
                onClick={() => setLangDropdownOpen(false)}
              />
              <div
                className="absolute top-full left-0 mt-1 py-1 rounded-md shadow-lg z-50 min-w-[140px] backdrop-blur-md"
                style={{
                  background: 'var(--bg-glass)',
                  border: '1px solid var(--border-secondary)',
                  boxShadow: 'var(--shadow-md)',
                }}
              >
                {LANGUAGES.map((lang) => (
                  <div
                    key={lang.id}
                    className="flex items-center gap-2 px-3 py-1.5 text-xs cursor-pointer transition-colors duration-150"
                    style={{
                      color: lang.id === currentLang.id ? 'var(--accent-blue)' : 'var(--text-secondary)',
                      background: lang.id === currentLang.id ? 'var(--bg-hover)' : 'transparent',
                    }}
                    onMouseEnter={(e) => {
                      if (lang.id !== currentLang.id) e.currentTarget.style.background = 'var(--bg-hover)';
                    }}
                    onMouseLeave={(e) => {
                      if (lang.id !== currentLang.id) e.currentTarget.style.background = 'transparent';
                    }}
                    onClick={() => {
                      setLangDropdownOpen(false);
                      if (activeFile && lang.id !== currentLang.id) {
                        const lastDotIndex = activeFile.name.lastIndexOf('.');
                        const baseName = lastDotIndex > 0 ? activeFile.name.substring(0, lastDotIndex) : activeFile.name;
                        const newName = baseName + lang.extension;
                        renameFile(activeFile.id, newName);
                      }
                    }}
                  >
                    <span>{lang.icon}</span>
                    <span>{lang.name}</span>
                  </div>
                ))}
                <div
                  className="px-3 py-1 mt-1 text-xs"
                  style={{
                    color: 'var(--text-muted)',
                    borderTop: '1px solid var(--border-primary)',
                  }}
                >
                  Language is auto-detected from file extension
                </div>
              </div>
            </>
          )}
        </div>

        {/* Stdin toggle */}
        <button
          onClick={() => setStdinOpen(!stdinOpen)}
          className="flex items-center gap-2 px-4 py-2 ml-2 rounded-md text-[13px] transition-all duration-300 cursor-pointer whitespace-nowrap shrink-0 font-medium"
          style={{
            background: stdinOpen ? 'var(--accent-blue)' : 'var(--bg-tertiary)',
            color: stdinOpen ? '#fff' : 'var(--text-secondary)',
            border: stdinOpen ? '1px solid var(--accent-blue)' : '1px solid var(--border-primary)',
            boxShadow: stdinOpen ? 'var(--shadow-glow)' : 'var(--shadow-sm)',
          }}
          onMouseEnter={(e) => {
            if (!stdinOpen) {
              e.currentTarget.style.borderColor = 'var(--accent-blue)';
              e.currentTarget.style.color = 'var(--text-primary)';
            }
          }}
          onMouseLeave={(e) => {
            if (!stdinOpen) {
              e.currentTarget.style.borderColor = 'var(--border-primary)';
              e.currentTarget.style.color = 'var(--text-secondary)';
            }
          }}
        >
          <Terminal size={12} className="shrink-0" />
          stdin
        </button>
      </div>

      {/* Right section */}
      <div className="flex items-center gap-2">
        {/* Theme toggle */}
        <button
          onClick={onToggleTheme}
          className="p-2 rounded-md transition-all duration-300 cursor-pointer shrink-0"
          style={{ 
            color: 'var(--text-secondary)',
            border: '1px solid transparent',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'var(--bg-hover)';
            e.currentTarget.style.color = 'var(--accent-orange)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent';
            e.currentTarget.style.color = 'var(--text-secondary)';
          }}
          title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
        >
          {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
        </button>
      </div>

      {/* Stdin input overlay */}
      {stdinOpen && (
        <div
          className="fixed left-1/2 top-14 -translate-x-1/2 z-50 rounded-lg shadow-xl p-3 w-[90vw] max-w-sm transform transition-all duration-300 ease-out backdrop-blur-md"
          style={{
            background: 'var(--bg-glass)',
            border: '1px solid var(--border-secondary)',
            boxShadow: 'var(--shadow-md)',
          }}
        >
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold tracking-wider uppercase" style={{ color: 'var(--text-primary)' }}>
              Standard Input (stdin)
            </span>
            <button
              onClick={() => setStdinOpen(false)}
              className="text-xs px-4 py-1.5 rounded-md cursor-pointer transition-colors duration-200 font-medium shrink-0"
              style={{
                background: 'var(--bg-hover)',
                color: 'var(--text-primary)',
                border: '1px solid var(--border-primary)',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'var(--accent-blue)';
                e.currentTarget.style.color = '#fff';
                e.currentTarget.style.borderColor = 'var(--accent-blue)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'var(--bg-hover)';
                e.currentTarget.style.color = 'var(--text-primary)';
                e.currentTarget.style.borderColor = 'var(--border-primary)';
              }}
            >
              Done
            </button>
          </div>
          <textarea
            value={stdin}
            onChange={(e) => setStdin(e.target.value)}
            className="w-full h-32 p-3 rounded-md text-[13px] resize-none outline-none leading-relaxed"
            style={{
              background: 'var(--bg-primary)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border-primary)',
              fontFamily: "'JetBrains Mono', monospace",
            }}
            placeholder="Enter input for your program..."
          />
        </div>
      )}
    </div>
  );
}
