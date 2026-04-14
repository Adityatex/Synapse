/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { LANGUAGES, getLanguageByExtension } from '../utils/languageMap';

const FileContext = createContext();

const DEFAULT_FILE = {
  id: 'welcome-py',
  name: 'main.py',
  type: 'file',
  parentId: null,
  order: 0,
  isOpen: false,
  content: LANGUAGES[0].template,
  language: LANGUAGES[0],
  updatedAt: Date.now(),
};

const STORAGE_KEY = 'synapse-files';

function normalizeFile(file) {
  return {
    ...file,
    type: file.type || 'file',
    parentId: file.parentId || null,
    order: typeof file.order === 'number' ? file.order : 0,
    isOpen: Boolean(file.isOpen),
    content: file.content ?? '',
    language: getLanguageByExtension(file.name),
    updatedAt: file.updatedAt ?? Date.now(),
  };
}

function getDefaultState() {
  const normalizedFile = normalizeFile(DEFAULT_FILE);

  return {
    files: [normalizedFile],
    activeFileId: normalizedFile.id,
    openTabs: [normalizedFile.id],
  };
}

function getSubTreeIds(filesList, rootId) {
  let ids = [rootId];
  for (const file of filesList) {
    if (file.parentId === rootId) {
      ids = ids.concat(getSubTreeIds(filesList, file.id));
    }
  }
  return ids;
}

export function FileProvider({ children, storageKey = STORAGE_KEY }) {
  const [files, setFiles] = useState(() => {
    if (!storageKey) {
      return getDefaultState().files;
    }

    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        return JSON.parse(saved).map(normalizeFile);
      }
    } catch (error) {
      console.error('Failed to load files:', error);
    }

    return getDefaultState().files;
  });

  const [activeFileId, setActiveFileId] = useState(() => files[0]?.id || DEFAULT_FILE.id);
  const [openTabs, setOpenTabs] = useState(() => [files[0]?.id || DEFAULT_FILE.id]);
  const [jumpTarget, setJumpTarget] = useState(null);

  useEffect(() => {
    if (!storageKey) {
      return;
    }

    try {
      const toSave = files.map(({ id, name, type, parentId, order, isOpen, content, updatedAt }) => ({
        id,
        name,
        type,
        parentId,
        order,
        isOpen,
        content,
        updatedAt,
      }));
      localStorage.setItem(storageKey, JSON.stringify(toSave));
    } catch (error) {
      console.error('Failed to save files:', error);
    }
  }, [files, storageKey]);

  const activeFile = files.find((file) => file.id === activeFileId) || files[0] || null;

  const replaceState = useCallback((nextState) => {
    const normalizedFiles = (nextState.files || []).map(normalizeFile);
    const safeFiles = normalizedFiles.length ? normalizedFiles : getDefaultState().files;
    const safeActiveFileId =
      nextState.activeFileId && safeFiles.some((file) => file.id === nextState.activeFileId)
        ? nextState.activeFileId
        : safeFiles[0].id;
    const safeOpenTabs = (nextState.openTabs || []).filter((tabId) =>
      safeFiles.some((file) => file.id === tabId)
    );

    setFiles(safeFiles);
    setActiveFileId(safeActiveFileId);
    setOpenTabs(safeOpenTabs.length ? safeOpenTabs : [safeActiveFileId]);
  }, []);

  const replaceSharedFiles = useCallback((nextState) => {
    const normalizedFiles = (nextState.files || []).map(normalizeFile);
    const safeFiles = normalizedFiles.length ? normalizedFiles : getDefaultState().files;
    const hasFile = (fileId) => safeFiles.some((file) => file.id === fileId);

    setFiles(safeFiles);
    setActiveFileId((previousActiveFileId) => {
      if (hasFile(previousActiveFileId)) {
        return previousActiveFileId;
      }

      return safeFiles[0].id;
    });
    setOpenTabs((previousOpenTabs) => {
      const safeOpenTabs = previousOpenTabs.filter(hasFile);
      return safeOpenTabs.length ? safeOpenTabs : [safeFiles[0].id];
    });
  }, []);

  const createFile = useCallback((name, parentId = null) => {
    const id = `file-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const language = getLanguageByExtension(name);
    
    setFiles((prev) => {
      const order = prev.filter(f => f.parentId === parentId).length;
      const newFile = normalizeFile({
        id,
        name,
        type: 'file',
        parentId,
        order,
        content: language.template,
        updatedAt: Date.now(),
      });
      return [...prev, newFile];
    });
    
    setOpenTabs((prev) => [...prev, id]);
    setActiveFileId(id);
    return id; // Return ID instead of object since state update is async
  }, []);

  const createFolder = useCallback((name, parentId = null) => {
    const id = `folder-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    
    setFiles((prev) => {
      const order = prev.filter(f => f.parentId === parentId).length;
      const newFolder = normalizeFile({
        id,
        name,
        type: 'folder',
        parentId,
        order,
        isOpen: true,
        updatedAt: Date.now(),
      });
      return [...prev, newFolder];
    });
    return id;
  }, []);

  const toggleFolder = useCallback((id) => {
    setFiles((prev) => 
      prev.map(f => f.id === id && f.type === 'folder' ? { ...f, isOpen: !f.isOpen } : f)
    );
  }, []);

  const moveItem = useCallback((id, newParentId, newOrder) => {
    setFiles((prev) => {
      // Prevent nesting folder inside itself or its children
      if (newParentId) {
        let currentParent = prev.find(f => f.id === newParentId);
        while (currentParent) {
          if (currentParent.id === id) return prev; // Invalid move
          currentParent = prev.find(f => f.id === currentParent.parentId);
        }
      }

      // Also prevent dropping a folder into itself
      if (newParentId === id) return prev;

      const updated = prev.map(f => f.id === id ? { ...f, parentId: newParentId } : f);
      
      // Sort children to re-apply order sequentially
      const siblings = updated.filter(f => f.parentId === newParentId && f.id !== id).sort((a, b) => a.order - b.order);
      const movingItem = updated.find(f => f.id === id);
      
      const clampedOrder = Math.max(0, Math.min(newOrder, siblings.length));
      siblings.splice(clampedOrder, 0, movingItem);
      
      // Build a map of id -> new order (immutable)
      const orderMap = new Map();
      siblings.forEach((sib, index) => {
        orderMap.set(sib.id, index);
      });
      
      // Return new array with updated orders (immutable)
      return updated.map(f => {
        if (orderMap.has(f.id)) {
          return { ...f, order: orderMap.get(f.id) };
        }
        return f;
      });
    });
  }, []);

  const renameFile = useCallback((id, newName) => {
    setFiles((prev) =>
      prev.map((file) =>
        file.id === id
          ? normalizeFile({
              ...file,
              name: newName,
              updatedAt: Date.now(),
            })
          : file
      )
    );
  }, []);

  const deleteFile = useCallback((id) => {
    // We need to compute deletedIds synchronously from the latest state,
    // then update all three pieces of state consistently.
    setFiles((prevFiles) => {
      const deletedIds = new Set(getSubTreeIds(prevFiles, id));
      const remaining = prevFiles.filter((file) => !deletedIds.has(file.id));
      const safeFiles = remaining.length ? remaining : getDefaultState().files;

      // Update tabs — remove any deleted file tabs
      setOpenTabs((prevTabs) => {
        const remainingTabs = prevTabs.filter((tabId) => !deletedIds.has(tabId));
        return remainingTabs.length ? remainingTabs : [safeFiles.find(f => f.type === 'file')?.id || safeFiles[0].id];
      });

      // Update active file — if the active file was deleted, pick the next available file
      setActiveFileId((prevActiveId) => {
        if (!deletedIds.has(prevActiveId)) {
          return prevActiveId;
        }
        const nextFile = safeFiles.find((f) => f.type === 'file') || safeFiles[0];
        return nextFile.id;
      });

      return safeFiles;
    });
  }, []);

  const updateContent = useCallback((id, content, options = {}) => {
    setFiles((prev) =>
      prev.map((file) =>
        file.id === id
          ? {
              ...file,
              content,
              updatedAt: options.updatedAt ?? Date.now(),
            }
          : file
      )
    );
  }, []);

  const openTab = useCallback((id) => {
    setOpenTabs((prev) => (prev.includes(id) ? prev : [...prev, id]));
    setActiveFileId(id);
  }, []);

  const closeTab = useCallback((id) => {
    setOpenTabs((prev) => {
      const remaining = prev.filter((tabId) => tabId !== id);
      if (!remaining.length) {
        return prev;
      }

      if (activeFileId === id) {
        const currentIndex = prev.indexOf(id);
        const nextActiveFileId = remaining[Math.min(currentIndex, remaining.length - 1)];
        setActiveFileId(nextActiveFileId);
      }

      return remaining;
    });
  }, [activeFileId]);

  const jumpToFileLine = useCallback((id, line) => {
    setJumpTarget({ fileId: id, line, ts: Date.now() });
    openTab(id);
  }, [openTab]);

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
        updateContent,
        openTab,
        closeTab,
        replaceState,
        replaceSharedFiles,
        setActiveFileId,
        jumpTarget,
        jumpToFileLine,
      }}
    >
      {children}
    </FileContext.Provider>
  );
}

export function useFiles() {
  const context = useContext(FileContext);
  if (!context) {
    throw new Error('useFiles must be used within a FileProvider');
  }
  return context;
}
