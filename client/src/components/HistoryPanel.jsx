import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';
import { History, Loader2, RotateCcw, X } from 'lucide-react';
import { getThemeClasses } from '../utils/theme';
import { getMonacoLanguage } from '../utils/languageMap';
import { MONACO_THEME, defineSynapseThemes } from '../utils/monacoThemes';
import { timeAgo, versionTime } from '../utils/versionTime';
import { getVersion, listVersions, restoreVersion } from '../services/roomService';

// Monaco is the heaviest client dependency: load its diff editor only when someone opens the history.
const DiffEditor = lazy(() => import('@monaco-editor/react').then((module) => ({ default: module.DiffEditor })));

const KIND_LABEL = {
  auto: () => 'Saved automatically',
  'restore-point': (by) => `Saved before ${by?.name || 'someone'}’s restore`,
  restore: (by) => `Restored by ${by?.name || 'someone'}`,
};

/**
 * A file's version history (P2-15): the versions the room was saved in, each shown against the file's
 * current text, and a way to put one back. Restoring is an ordinary edit for everyone in the room, and
 * the text it replaces is kept as a version, so it can be undone from this same list.
 */
export default function HistoryPanel({ onClose, theme, roomId, fileId, fileName, getCurrentText, canRestore = true }) {
  const t = getThemeClasses(theme);
  const [versions, setVersions] = useState(null); // null while loading
  const [listError, setListError] = useState('');
  const [selected, setSelected] = useState(null); // seq
  // What was last read for one version; it counts only while it is the selected one.
  const [loaded, setLoaded] = useState({ seq: null, content: '', current: '', error: '' });
  const [confirming, setConfirming] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [restoreError, setRestoreError] = useState('');
  const [notice, setNotice] = useState('');
  // The current text is read when a version is opened, not on every render of the room behind this panel.
  const currentTextRef = useRef(getCurrentText);
  useEffect(() => {
    currentTextRef.current = getCurrentText;
  });

  const loadList = useCallback(
    async (selectSeq) => {
      try {
        const { versions: list } = await listVersions(roomId, fileId);
        setVersions(list);
        setListError('');
        setSelected((previous) => selectSeq ?? (list.some((v) => v.seq === previous) ? previous : list[0]?.seq ?? null));
      } catch (error) {
        setVersions((previous) => previous ?? []);
        setListError(error.message || 'Could not load the history.');
      }
    },
    [roomId, fileId]
  );

  // The parent mounts this fresh for each file it is opened on, so this runs once per look at a history.
  useEffect(() => {
    let cancelled = false;
    listVersions(roomId, fileId)
      .then(({ versions: list }) => {
        if (cancelled) return;
        setVersions(list);
        setSelected(list[0]?.seq ?? null);
      })
      .catch((error) => {
        if (cancelled) return;
        setVersions([]);
        setListError(error.message || 'Could not load the history.');
      });
    return () => {
      cancelled = true;
    };
  }, [roomId, fileId]);

  useEffect(() => {
    if (selected === null) return undefined;
    let cancelled = false;
    getVersion(roomId, selected, fileId)
      .then(({ version }) => {
        if (!cancelled) setLoaded({ seq: selected, content: version.content, current: currentTextRef.current(), error: '' });
      })
      .catch((error) => {
        if (!cancelled) setLoaded({ seq: selected, content: '', current: '', error: error.message || 'Could not load that version.' });
      });
    return () => {
      cancelled = true;
    };
  }, [selected, roomId, fileId]);

  useEffect(() => {
    const onKey = (event) => event.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const selectVersion = (seq) => {
    setSelected(seq);
    setConfirming(false);
    setRestoreError('');
    setNotice('');
  };

  const handleRestore = async () => {
    setRestoring(true);
    setRestoreError('');
    try {
      const result = await restoreVersion(roomId, selected, fileId);
      setConfirming(false);
      setNotice(result.changed ? 'Restored. What was there before is saved as a version below.' : 'The file already has this text.');
      await loadList(result.seq);
      // The new version is read afresh; if there is none to move to, at least compare with the text now.
      if (!result.seq) setLoaded((previous) => ({ ...previous, current: currentTextRef.current() }));
    } catch (error) {
      setRestoreError(error.message || 'Could not restore that version.');
    } finally {
      setRestoring(false);
    }
  };

  const preview = selected !== null && loaded.seq === selected && !loaded.error ? loaded : null;
  const previewError = selected !== null && loaded.seq === selected ? loaded.error : '';
  const same = preview && preview.content === preview.current;
  const chosen = versions?.find((v) => v.seq === selected);
  const muted = theme === 'dark' ? 'text-slate-400' : 'text-slate-500';

  return (
    <div className="fixed inset-0 z-[200] flex justify-end" role="dialog" aria-modal="true" aria-label={`History of ${fileName}`}>
      <button type="button" aria-label="Close history" className="absolute inset-0 bg-black/40 cursor-default" onClick={onClose} />
      <aside className={`relative h-full w-[min(920px,96vw)] flex flex-col ${t.bg} ${t.text} border-l ${t.border} shadow-2xl select-text`}>
        <header className={`h-12 shrink-0 flex items-center gap-2 px-4 border-b ${t.border} ${t.header}`}>
          <History size={16} aria-hidden="true" />
          <h2 className="text-sm font-semibold flex-1 truncate">
            History <span className={`font-normal ${muted}`}>· {fileName}</span>
          </h2>
          <button type="button" onClick={onClose} aria-label="Close" className="p-1 rounded hover:bg-black/10 cursor-pointer">
            <X size={16} />
          </button>
        </header>

        <div className="flex flex-1 min-h-0">
          <nav className={`w-[260px] shrink-0 overflow-y-auto border-r ${t.border}`} aria-label="Versions">
            {versions === null && (
              <div className={`p-4 text-xs flex items-center gap-2 ${muted}`}>
                <Loader2 size={14} className="animate-spin" /> Loading versions…
              </div>
            )}
            {listError && <p className="p-4 text-xs text-red-500">{listError}</p>}
            {versions?.length === 0 && !listError && (
              <p className={`p-4 text-xs leading-relaxed ${muted}`}>
                Nothing saved yet. A version is saved a few minutes after people start editing, or after a burst of changes.
              </p>
            )}
            <ul>
              {versions?.map((version) => (
                <li key={version.seq}>
                  <button
                    type="button"
                    onClick={() => selectVersion(version.seq)}
                    aria-current={version.seq === selected ? 'true' : undefined}
                    className={`w-full text-left px-4 py-2.5 border-b ${t.border} cursor-pointer transition-colors ${
                      version.seq === selected ? (theme === 'dark' ? 'bg-white/10' : 'bg-black/5') : theme === 'dark' ? 'hover:bg-white/5' : 'hover:bg-black/[0.03]'
                    }`}
                  >
                    <span className="block text-[13px] font-semibold">{versionTime(version.at)}</span>
                    <span className={`block text-[11px] ${muted}`}>
                      {timeAgo(version.at)} · {version.chars} chars
                    </span>
                    <span className={`block text-[11px] mt-0.5 ${version.kind === 'auto' ? muted : 'text-accent-fg font-medium'}`}>
                      {KIND_LABEL[version.kind](version.by)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </nav>

          <section className="flex-1 min-w-0 flex flex-col">
            {selected !== null && (
              <div className={`shrink-0 px-4 py-3 border-b ${t.border} flex items-center gap-3 flex-wrap`}>
                <div className="flex-1 min-w-[200px]">
                  <p className="text-[13px] font-semibold">{chosen ? `Version from ${versionTime(chosen.at)}` : 'Version'}</p>
                  <p className={`text-[11px] ${muted}`}>
                    {preview ? (same ? 'Same as the current text.' : 'Red is in this version only; green is in the file now.') : 'Loading…'}
                  </p>
                </div>
                {!confirming && (
                  <button
                    type="button"
                    disabled={!preview || same || !canRestore}
                    onClick={() => setConfirming(true)}
                    title={canRestore ? undefined : 'Sign in again to restore'}
                    className="flex items-center gap-2 h-8 px-3.5 bg-accent hover:bg-accent-hover text-accent-ink rounded-md text-[13px] font-semibold cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <RotateCcw size={14} /> Restore this version
                  </button>
                )}
                {confirming && (
                  <div className="flex items-center gap-2 text-[12px]">
                    <span>Replace the current text of {fileName}?</span>
                    <button
                      type="button"
                      onClick={handleRestore}
                      disabled={restoring}
                      className="h-8 px-3 bg-accent hover:bg-accent-hover text-accent-ink rounded-md text-[13px] font-semibold cursor-pointer disabled:opacity-60"
                    >
                      {restoring ? 'Restoring…' : 'Restore'}
                    </button>
                    <button type="button" onClick={() => setConfirming(false)} disabled={restoring} className={`h-8 px-3 rounded-md border ${t.border} text-[13px] cursor-pointer`}>
                      Cancel
                    </button>
                  </div>
                )}
              </div>
            )}
            {restoreError && <p role="alert" className="px-4 py-2 text-xs text-red-500 border-b border-red-500/30 bg-red-500/10">{restoreError}</p>}
            {notice && <p role="status" className="px-4 py-2 text-xs text-accent-fg border-b border-accent/30 bg-accent/10">{notice}</p>}

            <div className="flex-1 min-h-0 relative">
              {previewError && <p className="p-4 text-xs text-red-500">{previewError}</p>}
              {!previewError && selected !== null && !preview && (
                <div className={`absolute inset-0 flex items-center justify-center gap-2 text-xs ${muted}`}>
                  <Loader2 size={16} className="animate-spin" /> Loading version…
                </div>
              )}
              {preview && (
                <Suspense
                  fallback={
                    <div className={`absolute inset-0 flex items-center justify-center gap-2 text-xs ${muted}`}>
                      <Loader2 size={16} className="animate-spin" /> Loading editor…
                    </div>
                  }
                >
                  <DiffEditor
                    key={preview.seq}
                    height="100%"
                    language={getMonacoLanguage(fileName)}
                    theme={theme === 'dark' ? MONACO_THEME.dark : MONACO_THEME.light}
                    beforeMount={defineSynapseThemes}
                    original={preview.content}
                    modified={preview.current}
                    options={{
                      readOnly: true,
                      originalEditable: false,
                      renderSideBySide: false,
                      fontSize: 14,
                      minimap: { enabled: false },
                      scrollBeyondLastLine: false,
                      automaticLayout: true,
                      padding: { top: 12, bottom: 12 },
                    }}
                  />
                </Suspense>
              )}
            </div>
          </section>
        </div>
      </aside>
    </div>
  );
}
