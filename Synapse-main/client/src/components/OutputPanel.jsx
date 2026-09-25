import { useState } from 'react';
import { getThemeClasses } from '../utils/theme';
import {
  Terminal,
  AlertCircle,
  ChevronRight,
  Check,
  Loader2
} from 'lucide-react';

export default function OutputPanel({ theme, output }) {
  const [activeTab, setActiveTab] = useState('output');
  const [isOutputExpanded, setIsOutputExpanded] = useState(true);
  
  const t = getThemeClasses(theme);

  const hasError = output?.stderr || output?.compile_output || output?.error;
  const isRunning = output?.running;

  // The output terminal contents
  const displayContent = () => {
    if (isRunning) {
      return (
        <div className="flex items-center gap-2 p-4 text-indigo-500">
          <Loader2 size={16} className="animate-spin" />
          <span className="text-sm">Executing code...</span>
        </div>
      );
    }

    if (activeTab === 'output') {
      if (output?.error) {
        return (
          <pre className="text-orange-500 leading-relaxed whitespace-pre-wrap">
            {output.error}
          </pre>
        );
      }
      if (output?.status && output.status.id === 3) {
        return (
          <pre className={`leading-relaxed whitespace-pre-wrap ${theme === 'dark' ? 'text-slate-200' : 'text-slate-800'}`}>
            {output.stdout || <span className={t.textMuted}>Execution finished. No output.</span>}
          </pre>
        );
      }
      if (output?.stdout) {
         return (
          <pre className={`leading-relaxed whitespace-pre-wrap ${theme === 'dark' ? 'text-slate-200' : 'text-slate-800'}`}>
            {output.stdout}
          </pre>
        );
      }
      return (
        <div className={`${t.textMuted} italic`}>
          Run your code to see output here...
        </div>
      );
    }

    if (activeTab === 'errors') {
      const errorContent = output?.stderr || output?.compile_output;
      if (errorContent) {
        return (
          <pre className="text-orange-500 leading-relaxed whitespace-pre-wrap">
            {errorContent}
          </pre>
        );
      }
      return (
        <div className="flex items-center gap-2 text-slate-400 italic">
          <Check size={14} className="text-emerald-500" />
          Clean build. Zero issues found.
        </div>
      );
    }
  };

  return (
    <div className={`border-t ${t.border} ${t.header} flex flex-col transition-all duration-300 ease-in-out shrink-0 ${isOutputExpanded ? 'h-64' : 'h-8'}`}>
      <div className={`h-8 flex items-center justify-between px-4 ${t.consoleHeader} border-b ${t.border}`}>
        <div className="flex gap-4 h-full">
          {['output', 'errors'].map((tab) => (
            <button 
              key={tab}
              onClick={() => { setActiveTab(tab); setIsOutputExpanded(true); }}
              className={`text-[11px] font-bold uppercase tracking-widest h-full flex items-center gap-2 border-b-2 transition-all cursor-pointer ${activeTab === tab && isOutputExpanded ? 'border-indigo-500 text-indigo-500' : `border-transparent ${t.textMuted} hover:text-indigo-500`}`}
            >
              {tab === 'output' && <Terminal size={12} />}
              {tab === 'errors' && <AlertCircle size={12} />}
              {tab}
              {tab === 'errors' && hasError && <span className="w-1.5 h-1.5 rounded-full bg-orange-500 mb-2" />}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-4 text-xs font-mono">
          {/* Execution Time */}
          {output?.time && (
            <span className={t.textMuted}>{output.time}s</span>
          )}
          {/* Memory Usage */}
          {output?.memory && (
            <span className={t.textMuted}>{(output.memory / 1024).toFixed(1)}MB</span>
          )}
          
          {/* Collapse Toggle */}
          <button 
            onClick={() => setIsOutputExpanded(!isOutputExpanded)}
            className={`${t.textMuted} hover:text-indigo-500 transition-colors cursor-pointer ml-2`}
          >
            <ChevronRight size={14} className={isOutputExpanded ? 'rotate-90' : '-rotate-90'} />
          </button>
        </div>
      </div>
      
      {isOutputExpanded && (
        <div className={`flex-1 overflow-auto p-4 font-mono text-xs ${theme === 'dark' ? 'bg-[#0d1117]/50' : 'bg-slate-50'} custom-scrollbar`}>
          {displayContent()}
        </div>
      )}
    </div>
  );
}
