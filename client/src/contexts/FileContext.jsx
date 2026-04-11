/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { LANGUAGES, getLanguageByExtension } from '../utils/languageMap';

const FileContext = createContext();

const DEFAULT_FILE = {
  id: 'welcome-py',
  name: 'main.py',
  content: LANGUAGES[0].template,
  language: LANGUAGES[0],
  updatedAt: Date.now(),
};

const STORAGE_KEY = 'synapse-files';

function normalizeFile(file) {
  return {
    ...file,
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

  useEffect(() => {
    if (!storageKey) {
      return;
    }

    try {
      const toSave = files.map(({ id, name, content, updatedAt }) => ({
        id,
        name,
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

  const createFile = useCallback((name) => {
    const id = `file-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const language = getLanguageByExtension(name);
    const newFile = normalizeFile({
      id,
      name,
      content: language.template,
      updatedAt: Date.now(),
    });

    setFiles((prev) => [...prev, newFile]);
    setOpenTabs((prev) => [...prev, id]);
    setActiveFileId(id);
    return newFile;
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
    setFiles((prev) => {
      const remaining = prev.filter((file) => file.id !== id);
      return remaining.length ? remaining : getDefaultState().files;
    });

    setOpenTabs((prev) => {
      const remaining = prev.filter((tabId) => tabId !== id);
      return remaining.length ? remaining : [getDefaultState().files[0].id];
    });

    setActiveFileId((prevActiveFileId) => {
      if (prevActiveFileId !== id) {
        return prevActiveFileId;
      }

      const nextFile = files.find((file) => file.id !== id);
      return nextFile?.id || getDefaultState().files[0].id;
    });
  }, [files]);

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

  return (
    <FileContext.Provider
      value={{
        files,
        activeFile,
        activeFileId,
        openTabs,
        createFile,
        renameFile,
        deleteFile,
        updateContent,
        openTab,
        closeTab,
        replaceState,
        replaceSharedFiles,
        setActiveFileId,
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
