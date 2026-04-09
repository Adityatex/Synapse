import { useState } from 'react';
import {
  Terminal,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
  ChevronUp,
  ChevronDown,
  Cpu,
  Timer,
} from 'lucide-react';

export default function OutputPanel({ output }) {
  const [activeTab, setActiveTab] = useState('output');
  const [isCollapsed, setIsCollapsed] = useState(false);

  const hasError = output?.stderr || output?.compile_output || output?.error;
  const hasOutput = output?.stdout;
  const isRunning = output?.running;

  const getStatusColor = () => {
    if (isRunning) return 'var(--accent-blue)';
    if (output?.error) return 'var(--accent-red)';
    if (output?.status?.id === 3) return 'var(--accent-green)'; // Accepted
    if (output?.status?.id >= 5) return 'var(--accent-red)'; // Runtime errors
    if (output?.status?.id === 4) return 'var(--accent-red)'; // Wrong answer
    return 'var(--text-muted)';
  };

  const getStatusIcon = () => {
    if (isRunning) return <Loader2 size={14} className="animate-spin" />;
    if (output?.status?.id === 3) return <CheckCircle2 size={14} />;
    if (output?.status?.id >= 4) return <XCircle size={14} />;
    if (output?.error) return <AlertTriangle size={14} />;
    return <Terminal size={14} />;
  };

  const getStatusLabel = () => {
    if (isRunning) return 'Running...';
    if (output?.error) return 'Error';
    if (output?.status) return output.status.description;
    return 'Ready';
  };

  const displayContent = () => {
    if (isRunning) {
      return (
        <div className="flex items-center gap-2 p-4" style={{ color: 'var(--accent-blue)' }}>
          <Loader2 size={16} className="animate-spin" />
          <span className="text-sm">Executing code...</span>
        </div>
      );
    }

    if (activeTab === 'output') {
      if (output?.error) {
        return (
          <pre className="p-5 text-[13px] leading-relaxed whitespace-pre-wrap" style={{ color: 'var(--accent-red)' }}>
            {output.error}
          </pre>
        );
      }
      if (output?.status && output.status.id === 3) {
        return (
          <pre
            className="p-5 text-[13px] leading-relaxed whitespace-pre-wrap"
            style={{
              color: 'var(--text-primary)',
              fontFamily: "'JetBrains Mono', monospace",
            }}
          >
            {output.stdout || <span style={{ color: 'var(--text-muted)' }}>Execution finished. No output.</span>}
          </pre>
        );
      }
      if (output?.stdout) {
         return (
          <pre
            className="p-5 text-[13px] leading-relaxed whitespace-pre-wrap"
            style={{
              color: 'var(--text-primary)',
              fontFamily: "'JetBrains Mono', monospace",
            }}
          >
            {output.stdout}
          </pre>
        );
      }
      return (
        <div className="p-6 text-[13px]" style={{ color: 'var(--text-muted)' }}>
          Run your code to see output here...
        </div>
      );
    }

    if (activeTab === 'errors') {
      const errorContent = output?.stderr || output?.compile_output;
      if (errorContent) {
        return (
          <pre
            className="p-5 text-[13px] leading-relaxed whitespace-pre-wrap"
            style={{
              color: 'var(--accent-red)',
              fontFamily: "'JetBrains Mono', monospace",
            }}
          >
            {errorContent}
          </pre>
        );
      }
      return (
        <div className="p-6 text-[13px]" style={{ color: 'var(--text-muted)' }}>
          No errors — you're all clear! ✨
        </div>
      );
    }
  };

  return (
    <div
      className="flex flex-col shrink-0 transition-all duration-200"
      style={{
        height: isCollapsed ? '40px' : 'var(--output-height)',
        background: 'var(--bg-secondary)',
        borderTop: '1px solid var(--border-primary)',
      }}
    >
      {/* Panel Header */}
      <div
        className="flex items-center justify-between px-5 shrink-0 cursor-pointer"
        style={{
          height: '40px',
          borderBottom: isCollapsed ? 'none' : '1px solid var(--border-primary)',
        }}
        onClick={() => setIsCollapsed(!isCollapsed)}
      >
        <div className="flex items-center gap-3">
          {/* Output tab */}
          <button
            className="flex items-center gap-2 text-[13px] font-medium py-2 transition-all duration-300 cursor-pointer bg-transparent border-none shrink-0 whitespace-nowrap"
            style={{
              color: activeTab === 'output' ? 'var(--text-primary)' : 'var(--text-muted)',
              borderBottom: activeTab === 'output' ? '2px solid var(--accent-blue)' : '2px solid transparent',
            }}
            onClick={(e) => {
              e.stopPropagation();
              setActiveTab('output');
              setIsCollapsed(false);
            }}
          >
            <Terminal size={12} />
            Output
          </button>

          {/* Errors tab */}
          <button
            className="flex items-center gap-2 text-[13px] font-medium py-2 transition-all duration-300 cursor-pointer bg-transparent border-none shrink-0 whitespace-nowrap"
            style={{
              color: activeTab === 'errors'
                ? (hasError ? 'var(--accent-red)' : 'var(--text-primary)')
                : (hasError ? 'var(--accent-red)' : 'var(--text-muted)'),
              borderBottom: activeTab === 'errors' ? '2px solid var(--accent-red)' : '2px solid transparent',
            }}
            onClick={(e) => {
              e.stopPropagation();
              setActiveTab('errors');
              setIsCollapsed(false);
            }}
          >
            <AlertTriangle size={12} />
            Errors
            {hasError && (
              <span
                className="w-2 h-2 rounded-full"
                style={{ background: 'var(--accent-red)' }}
              />
            )}
          </button>
        </div>

        <div className="flex items-center gap-3">
          {/* Execution stats */}
          {output?.time && (
            <div className="flex items-center gap-1 text-xs shrink-0 whitespace-nowrap" style={{ color: 'var(--text-muted)' }}>
              <Timer size={11} />
              {output.time}s
            </div>
          )}
          {output?.memory && (
            <div className="flex items-center gap-1 text-xs shrink-0 whitespace-nowrap" style={{ color: 'var(--text-muted)' }}>
              <Cpu size={11} />
              {(output.memory / 1024).toFixed(1)}MB
            </div>
          )}

          {/* Status badge */}
          <div
            className="flex items-center gap-1.5 px-3 py-1 rounded-full text-[13px] shrink-0 whitespace-nowrap"
            style={{
              color: getStatusColor(),
              background: `color-mix(in srgb, ${getStatusColor()} 15%, transparent)`,
            }}
          >
            {getStatusIcon()}
            {getStatusLabel()}
          </div>

          {/* Collapse toggle */}
          <button
            className="p-0.5 rounded transition-colors duration-300 cursor-pointer shrink-0"
            style={{ color: 'var(--text-muted)' }}
          >
            {isCollapsed ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
        </div>
      </div>

      {/* Content */}
      {!isCollapsed && (
        <div className="flex-1 overflow-auto">
          {displayContent()}
        </div>
      )}
    </div>
  );
}
