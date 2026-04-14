import { useEffect, useRef, useState } from 'react';
import Editor from '@monaco-editor/react';
import { MonacoBinding } from 'y-monaco';
import { useFiles } from '../contexts/FileContext';
import { getMonacoLanguage } from '../utils/languageMap';
import { getThemeClasses } from '../utils/theme';
import { Loader2 } from 'lucide-react';



function hexToRgba(color, alpha) {
  const normalized = color.replace('#', '');
  const expanded =
    normalized.length === 3
      ? normalized
          .split('')
          .map((char) => `${char}${char}`)
          .join('')
      : normalized;
  const red = parseInt(expanded.slice(0, 2), 16);
  const green = parseInt(expanded.slice(2, 4), 16);
  const blue = parseInt(expanded.slice(4, 6), 16);

  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function ensurePresenceStyle(userId, cursorColor) {
  if (typeof document === 'undefined') return;

  const safeId = String(userId).replace(/[^a-zA-Z0-9_-]/g, '-');
  const styleId = `presence-style-${safeId}`;
  // Always recreate if color changed (remove old style)
  const existing = document.getElementById(styleId);
  if (existing) return;

  const style = document.createElement('style');
  style.id = styleId;
  style.textContent = `
    /* Colored cursor line — full height of the line */
    .presence-cursor-${safeId} {
      border-left: 3px solid ${cursorColor} !important;
      margin-left: -2px;
      box-shadow: 0 0 6px 1px ${hexToRgba(cursorColor, 0.55)};
      pointer-events: none;
      position: relative;
    }
    /* Small colored dot at the top of the cursor line */
    .presence-cursor-${safeId}::before {
      content: "";
      position: absolute;
      top: 0;
      left: -5px;
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: ${cursorColor};
      box-shadow: 0 0 5px 1px ${hexToRgba(cursorColor, 0.7)};
      pointer-events: none;
      z-index: 100;
    }
    /* Selection highlight */
    .presence-selection-${safeId} {
      background: ${hexToRgba(cursorColor, 0.2)} !important;
      border-radius: 2px;
    }
  `;
  document.head.appendChild(style);
}

/** Animated "who is typing" bar */
function EditingIndicatorBar({ editingUsers = {}, activeFileId }) {
  const editors = Object.values(editingUsers).filter(
    (u) => !activeFileId || u.fileId === activeFileId
  );
  if (editors.length === 0) return null;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '4px 14px',
        background: 'var(--bg-secondary, #1e1e2e)',
        borderBottom: '1px solid var(--border-color, #2a2a3c)',
        fontSize: '12px',
        color: 'var(--text-muted, #888)',
        minHeight: '28px',
        flexWrap: 'wrap',
      }}
    >
      <span style={{ opacity: 0.6, flexShrink: 0 }}>Live:</span>
      {editors.map((u) => (
        <div
          key={u.userId}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '5px',
            background: hexToRgba(u.cursorColor || '#888', 0.12),
            border: `1px solid ${hexToRgba(u.cursorColor || '#888', 0.35)}`,
            borderRadius: '999px',
            padding: '2px 8px 2px 4px',
          }}
        >
          <span
            style={{
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              background: u.cursorColor || '#888',
              display: 'inline-block',
              flexShrink: 0,
              animation: 'dot-blink 0.9s ease-in-out infinite',
            }}
          />
          <span style={{ color: u.cursorColor || '#ccc', fontWeight: 600 }}>
            {u.username || 'Someone'}
          </span>
          <span style={{ opacity: 0.5 }}>is editing</span>
        </div>
      ))}
      <style>{`
        @keyframes dot-blink {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.4; transform: scale(0.75); }
        }
      `}</style>
    </div>
  );
}

function FileLockBanner({ activeFileLock, isReadOnly, lockNotice }) {
  if (!activeFileLock && !lockNotice) return null;

  const message = isReadOnly && activeFileLock
    ? `${activeFileLock.username || 'Another user'} is editing this file. View-only mode is active.`
    : activeFileLock
      ? 'You hold the edit lock for this file.'
      : lockNotice;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '6px 14px',
        background: isReadOnly ? 'rgba(245, 158, 11, 0.12)' : 'rgba(99, 102, 241, 0.12)',
        borderBottom: `1px solid ${isReadOnly ? 'rgba(245, 158, 11, 0.35)' : 'rgba(99, 102, 241, 0.28)'}`,
        fontSize: '12px',
        color: isReadOnly ? '#fbbf24' : '#a5b4fc',
      }}
    >
      <span style={{ fontWeight: 700 }}>{isReadOnly ? 'Locked' : 'Lock'}</span>
      <span>{message}</span>
    </div>
  );
}

export default function EditorPanel({
  theme,
  onCursorMove,
  onSelectionChange,
  onLocalChange,
  sharedText,
  remotePeers = [],
  editingUsers = {},
  activeFileId: activeFileIdProp,
  activeFileLock = null,
  isReadOnly = false,
  lockNotice = '',
}) {
  const { activeFile, updateContent, jumpTarget } = useFiles();
  const editorRef = useRef(null);
  const monacoRef = useRef(null);
  const decorationsRef = useRef([]);
  const bindingRef = useRef(null);
  const sharedTextRef = useRef(null);

  // Bumped every time onMount fires — this is what lets the binding
  // effect re-run AFTER the editor reference is set.
  const [editorMountKey, setEditorMountKey] = useState(0);

  const activeFileId = activeFileIdProp || activeFile?.id;
  const t = getThemeClasses(theme);
  const monacoTheme = theme === 'dark' ? 'vs-dark' : 'vs';
  const language = activeFile ? getMonacoLanguage(activeFile.name) : 'plaintext';

  // Keep sharedTextRef current so onMount can access the latest Y.Text
  // without a stale-closure issue.
  useEffect(() => {
    sharedTextRef.current = sharedText;
  }, [sharedText]);

  // ─── MonacoBinding ──────────────────────────────────────────────────────────
  //
  // WHY editorMountKey is in the deps:
  //   Monaco's onMount fires asynchronously AFTER the React render cycle.
  //   On first render, editorRef.current is null, so this effect bails out.
  //   When onMount fires it bumps editorMountKey (state), triggering a new
  //   render, which re-runs this effect — now with a valid editorRef.current.
  //
  // WHY activeFileId is in the deps:
  //   <Editor key={activeFile.id}> remounts Monaco on file switch, so
  //   editorMountKey increments again via onMount, and we recreate the binding
  //   for the new file's Y.Text.
  useEffect(() => {
    const editor = editorRef.current;
    if (!sharedText || !editor) return undefined;

    const model = editor.getModel();
    if (!model) return undefined;

    // Destroy any existing binding before creating a new one
    if (bindingRef.current) {
      bindingRef.current.destroy();
      bindingRef.current = null;
    }

    const binding = new MonacoBinding(sharedText, model, new Set([editor]));
    bindingRef.current = binding;

    return () => {
      binding.destroy();
      bindingRef.current = null;
    };
  }, [sharedText, editorMountKey, activeFileId]);

  // ─── Remote cursor & selection decorations ──────────────────────────────────
  useEffect(() => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco || !activeFileId) return undefined;

    const nextDecorations = remotePeers.flatMap((peer) => {
      if (!peer?.userId || !peer?.cursorColor) return [];

      ensurePresenceStyle(peer.userId, peer.cursorColor);
      const safeId = String(peer.userId).replace(/[^a-zA-Z0-9_-]/g, '-');
      const decorations = [];

      if (
        peer.selectionRange?.startLineNumber &&
        peer.selectionRange?.startColumn &&
        peer.selectionRange?.endLineNumber &&
        peer.selectionRange?.endColumn
      ) {
        decorations.push({
          range: new monaco.Range(
            peer.selectionRange.startLineNumber,
            peer.selectionRange.startColumn,
            peer.selectionRange.endLineNumber,
            peer.selectionRange.endColumn
          ),
          options: { className: `presence-selection-${safeId}` },
        });
      }

      if (peer.position?.lineNumber && peer.position?.column) {
        decorations.push({
          range: new monaco.Range(
            peer.position.lineNumber,
            peer.position.column,
            peer.position.lineNumber,
            peer.position.column + 1
          ),
          options: {
            className: `presence-cursor-${safeId}`,
            hoverMessage: { value: `${peer.username || 'Anonymous'} is editing here` },
          },
        });
      }

      return decorations;
    });

    decorationsRef.current = editor.deltaDecorations(decorationsRef.current, nextDecorations);

    return () => {
      if (editorRef.current) {
        decorationsRef.current = editorRef.current.deltaDecorations(
          decorationsRef.current,
          []
        );
      }
    };
  }, [remotePeers, activeFileId]);

  // ─── Scroll to line on jumpTarget change ────────────────────────────────────
  useEffect(() => {
    if (!editorRef.current || !jumpTarget || jumpTarget.fileId !== activeFileId) return;

    editorRef.current.revealLineInCenter(jumpTarget.line);
    editorRef.current.setPosition({ lineNumber: jumpTarget.line, column: 1 });
    editorRef.current.focus();
  }, [jumpTarget, activeFileId, editorMountKey]);

  if (!activeFile) {
    return (
      <div className={`flex-1 flex items-center justify-center ${t.editorBg}`}>
        <div className="text-center" style={{ color: 'var(--text-muted)' }}>
          <p className="text-lg mb-2">No file open</p>
          <p className="text-sm">Create a new file or open one from the sidebar</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex-1 overflow-hidden flex flex-col ${t.editorBg}`}>
      {/* Real-time "who is editing" indicator */}
      <EditingIndicatorBar editingUsers={editingUsers} activeFileId={activeFileId} />
      <FileLockBanner activeFileLock={activeFileLock} isReadOnly={isReadOnly} lockNotice={lockNotice} />

      <div style={{ flex: 1, overflow: 'hidden' }}>
        <Editor
          key={activeFile.id}
          height="100%"
          language={language}
          theme={monacoTheme}
          defaultValue={sharedText ? '' : activeFile.content}
          onChange={(value) => {
            if (!sharedText && activeFileId && updateContent) {
              updateContent(activeFileId, value || '', { updatedAt: Date.now() });
            }
            if (onLocalChange && activeFileId) {
              onLocalChange(activeFileId, value || '');
            }
          }}
          onMount={(editor, monaco) => {
            editorRef.current = editor;
            monacoRef.current = monaco;

            // If sharedText already arrived before the editor mounted, create
            // the binding immediately here so we don't wait for a re-render.
            // The binding useEffect will see bindingRef.current set and skip.
            const currentSharedText = sharedTextRef.current;
            if (currentSharedText) {
              const model = editor.getModel();
              if (model) {
                if (bindingRef.current) {
                  bindingRef.current.destroy();
                }
                bindingRef.current = new MonacoBinding(
                  currentSharedText,
                  model,
                  new Set([editor])
                );
              }
            }

            // Bump the mount key so the binding useEffect re-evaluates with
            // the now-valid editorRef.current (handles the case where sharedText
            // arrives AFTER the editor mounts).
            setEditorMountKey((k) => k + 1);

            editor.onDidChangeCursorSelection((event) => {
              onCursorMove?.(event.selection.getPosition());
              onSelectionChange?.({
                startLineNumber: event.selection.startLineNumber,
                startColumn: event.selection.startColumn,
                endLineNumber: event.selection.endLineNumber,
                endColumn: event.selection.endColumn,
              });
            });
          }}
          loading={
            <div
              className="flex items-center justify-center h-full gap-2"
              style={{ color: 'var(--text-muted)' }}
            >
              <Loader2 size={20} className="animate-spin" />
              <span>Loading editor...</span>
            </div>
          }
          options={{
            readOnly: isReadOnly,
            domReadOnly: isReadOnly,
            fontSize: 14,
            fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
            fontLigatures: true,
            minimap: { enabled: true, scale: 1 },
            scrollBeyondLastLine: false,
            smoothScrolling: true,
            cursorBlinking: 'smooth',
            cursorSmoothCaretAnimation: 'on',
            renderLineHighlight: 'all',
            bracketPairColorization: { enabled: true },
            formatOnPaste: true,
            wordWrap: 'off',
            padding: { top: 24, bottom: 24 },
            lineNumbers: 'on',
            glyphMargin: false,
            folding: true,
            automaticLayout: true,
            tabSize: 4,
            insertSpaces: true,
            suggest: { showIcons: true, showStatusBar: true },
          }}
        />
      </div>
    </div>
  );
}
