import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  createNode,
  deleteNode,
  getFileText,
  listNodes,
  moveNode,
  renameNode,
  RoomDocError,
} from '@synapse/room-doc';
import { FileContext } from './FileContext';
import { getLanguageByExtension } from '../utils/languageMap';

// Text changes arrive on every keystroke; the file list (which carries each
// file's text for Run and Neura) is rebuilt at most this often.
const REFRESH_MS = 120;

const newId = (prefix) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

/**
 * The same interface as FileProvider, backed by the room's shared Y.Doc
 * (P2-06). Every component that calls useFiles() works unchanged: files,
 * folders, renames, moves and deletes go through @synapse/room-doc and are
 * merged by Yjs, while tabs, the active file and open folders stay per-user.
 */
export function CollabFileProvider({ doc, readOnly = false, children }) {
  const [version, setVersion] = useState(0);
  const [openFolders, setOpenFolders] = useState(() => new Set());
  const [chosenFileId, setActiveFileId] = useState(null);
  const [chosenTabs, setOpenTabs] = useState([]);
  const [jumpTarget, setJumpTarget] = useState(null);

  // Re-derive from the document: the first change in a burst renders at once,
  // the rest of the burst is coalesced.
  useEffect(() => {
    let timer = null;
    let pending = false;
    const bump = () => setVersion((v) => v + 1);
    const onUpdate = () => {
      if (timer !== null) {
        pending = true;
        return;
      }
      bump();
      timer = setTimeout(() => {
        timer = null;
        if (pending) {
          pending = false;
          bump();
        }
      }, REFRESH_MS);
    };
    doc.on('update', onUpdate);
    bump();
    return () => {
      doc.off('update', onUpdate);
      if (timer !== null) clearTimeout(timer);
    };
  }, [doc]);

  // `version` is the signal that the document changed; the document itself is stable.
  const files = useMemo(
    () =>
      listNodes(doc).map((node) => ({
        ...node,
        isOpen: openFolders.has(node.id),
        content: node.type === 'file' ? getFileText(doc, node.id) : '',
        language: getLanguageByExtension(node.name),
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [doc, version, openFolders]
  );

  // This user's tabs and active file, resolved against what still exists: a peer
  // deleting a file closes its tab here, and an empty selection falls back to the
  // first file. Derived each render so there is no state to keep in sync.
  const firstFileId = files.find((f) => f.type === 'file')?.id ?? null;
  const openTabs = useMemo(() => {
    const exists = new Set(files.map((f) => f.id));
    const kept = chosenTabs.filter((id) => exists.has(id));
    if (kept.length) return kept;
    return firstFileId ? [firstFileId] : [];
  }, [files, chosenTabs, firstFileId]);
  const activeFileId = chosenFileId && files.some((f) => f.id === chosenFileId) ? chosenFileId : firstFileId;
  const activeFile = files.find((f) => f.id === activeFileId) || null;

  // `readOnly` (the sign-in expired, P2-12): changes would only stay on this screen, so make none.
  const run = useCallback(
    (operation) => {
      if (readOnly) return;
      try {
        operation();
      } catch (error) {
        // An invalid move, or an edit to something a peer just deleted: the tree is unchanged.
        if (!(error instanceof RoomDocError)) throw error;
      }
    },
    [readOnly]
  );

  const createFile = useCallback(
    (name, parentId = null) => {
      if (readOnly) return null;
      const id = newId('file');
      run(() =>
        createNode(doc, { id, name, type: 'file', parentId, content: getLanguageByExtension(name).template })
      );
      if (parentId) setOpenFolders((prev) => new Set(prev).add(parentId));
      setOpenTabs([...openTabs, id]);
      setActiveFileId(id);
      return id;
    },
    [doc, run, openTabs, readOnly]
  );

  const createFolder = useCallback(
    (name, parentId = null) => {
      if (readOnly) return null;
      const id = newId('folder');
      run(() => createNode(doc, { id, name, type: 'folder', parentId }));
      setOpenFolders((prev) => {
        const next = new Set(prev).add(id);
        if (parentId) next.add(parentId);
        return next;
      });
      return id;
    },
    [doc, run, readOnly]
  );

  const toggleFolder = useCallback((id) => {
    setOpenFolders((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const moveItem = useCallback((id, newParentId, newOrder) => run(() => moveNode(doc, id, newParentId, newOrder)), [doc, run]);
  const renameFile = useCallback((id, newName) => run(() => renameNode(doc, id, newName)), [doc, run]);
  const deleteFile = useCallback((id) => run(() => deleteNode(doc, id)), [doc, run]);

  const openTab = useCallback(
    (id) => {
      setOpenTabs(openTabs.includes(id) ? openTabs : [...openTabs, id]);
      setActiveFileId(id);
    },
    [openTabs]
  );

  const closeTab = useCallback(
    (id) => {
      const remaining = openTabs.filter((tabId) => tabId !== id);
      if (!remaining.length) return;
      setOpenTabs(remaining);
      if (activeFileId === id) {
        setActiveFileId(remaining[Math.min(openTabs.indexOf(id), remaining.length - 1)]);
      }
    },
    [openTabs, activeFileId]
  );

  const jumpToFileLine = useCallback(
    (id, line) => {
      setJumpTarget({ fileId: id, line, ts: Date.now() });
      openTab(id);
    },
    [openTab]
  );

  const noop = useCallback(() => {}, []);

  return (
    <FileContext.Provider
      value={{
        files,
        activeFile,
        activeFileId,
        openTabs,
        createFile,
        createFolder,
        toggleFolder,
        moveItem,
        renameFile,
        deleteFile,
        // The editor writes text straight into the shared Y.Text; nothing to mirror.
        updateContent: noop,
        openTab,
        closeTab,
        // Legacy relay hooks, meaningless when the document is the source of truth.
        replaceState: noop,
        replaceSharedFiles: noop,
        setActiveFileId,
        jumpTarget,
        jumpToFileLine,
      }}
    >
      {children}
    </FileContext.Provider>
  );
}
