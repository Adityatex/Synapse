import { useState, useRef, useEffect } from 'react';
import { useFiles } from '../contexts/FileContext';
import { LANGUAGES, getLanguageByExtension } from '../utils/languageMap';
import {
  FilePlus,
  FileCode2,
  Trash2,
  Pencil,
  ChevronDown,
  ChevronRight,
  FolderOpen,
} from 'lucide-react';

export default function Sidebar() {
  const { files, activeFileId, openTab, createFile, renameFile, deleteFile } = useFiles();
  const [isCreating, setIsCreating] = useState(false);
  const [newFileName, setNewFileName] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState('');
  const [hoveredId, setHoveredId] = useState(null);
  const inputRef = useRef(null);
  const editRef = useRef(null);

  useEffect(() => {
    if (isCreating && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isCreating]);

  useEffect(() => {
    if (editingId && editRef.current) {
      editRef.current.focus();
      editRef.current.select();
    }
  }, [editingId]);

  const handleCreate = () => {
    setIsCreating(true);
    setNewFileName('untitled.py');
  };

  const submitCreate = () => {
    const name = newFileName.trim();
    if (name) {
      createFile(name);
    }
    setIsCreating(false);
    setNewFileName('');
  };

  const startRename = (file) => {
    setEditingId(file.id);
    setEditName(file.name);
  };

  const submitRename = () => {
    const name = editName.trim();
    if (name && editingId) {
      renameFile(editingId, name);
    }
    setEditingId(null);
    setEditName('');
  };

  const getFileIcon = (filename) => {
    const lang = getLanguageByExtension(filename);
    return lang.icon;
  };

  return (
    <div
      className="flex flex-col h-full"
      style={{
        width: 'var(--sidebar-width)',
        background: 'var(--bg-secondary)',
        borderRight: '1px solid var(--border-primary)',
      }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-5 py-4"
        style={{ borderBottom: '1px solid var(--border-primary)' }}
      >
        <div className="flex items-center gap-2">
          <FolderOpen size={16} style={{ color: 'var(--accent-blue)' }} />
          <span
            className="text-xs font-semibold uppercase tracking-wider"
            style={{ color: 'var(--text-secondary)' }}
          >
            Explorer
          </span>
        </div>
        <button
          onClick={handleCreate}
          className="p-2 rounded-md transition-all duration-300 cursor-pointer shrink-0"
          style={{ color: 'var(--text-secondary)' }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'var(--bg-hover)';
            e.currentTarget.style.color = 'var(--accent-blue)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent';
            e.currentTarget.style.color = 'var(--text-secondary)';
          }}
          title="New File"
        >
          <FilePlus size={16} />
        </button>
      </div>

      {/* File List */}
      <div className="flex-1 overflow-y-auto py-1">
        {files.map((file) => (
          <div
            key={file.id}
            className="group flex items-center gap-3 px-4 py-2 cursor-pointer transition-all duration-150"
            style={{
              background: file.id === activeFileId ? 'var(--bg-hover)' : 'transparent',
              borderLeft: file.id === activeFileId ? '2px solid var(--accent-blue)' : '2px solid transparent',
            }}
            onClick={() => openTab(file.id)}
            onMouseEnter={(e) => {
              setHoveredId(file.id);
              if (file.id !== activeFileId) {
                e.currentTarget.style.background = 'var(--bg-tertiary)';
              }
            }}
            onMouseLeave={(e) => {
              setHoveredId(null);
              if (file.id !== activeFileId) {
                e.currentTarget.style.background = 'transparent';
              }
            }}
          >
            <span className="text-[14px]">{getFileIcon(file.name)}</span>

            {editingId === file.id ? (
              <input
                ref={editRef}
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onBlur={submitRename}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') submitRename();
                  if (e.key === 'Escape') {
                    setEditingId(null);
                    setEditName('');
                  }
                }}
                className="flex-1 text-sm px-1.5 py-0.5 rounded outline-none transition-all duration-200"
                style={{
                  background: 'var(--bg-tertiary)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--accent-blue)',
                  boxShadow: 'var(--shadow-glow)',
                }}
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <span
                className="flex-1 text-[13px] truncate tracking-wide"
                style={{
                  color: file.id === activeFileId ? 'var(--text-primary)' : 'var(--text-secondary)',
                }}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  startRename(file);
                }}
              >
                {file.name}
              </span>
            )}

            {/* Action buttons */}
            <div
              className="flex items-center gap-0.5 transition-opacity duration-150"
              style={{ opacity: hoveredId === file.id ? 1 : 0 }}
            >
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  startRename(file);
                }}
                className="p-1 -ml-1 rounded transition-colors duration-300 cursor-pointer shrink-0"
                style={{ color: 'var(--text-muted)' }}
                onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--accent-blue)')}
                onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-muted)')}
                title="Rename"
              >
                <Pencil size={12} />
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  deleteFile(file.id);
                }}
                className="p-1 rounded transition-colors duration-300 cursor-pointer shrink-0"
                style={{ color: 'var(--text-muted)' }}
                onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--accent-red)')}
                onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-muted)')}
                title="Delete"
              >
                <Trash2 size={12} />
              </button>
            </div>
          </div>
        ))}

        {/* New file input */}
        {isCreating && (
          <div className="flex items-center gap-3 px-4 py-2">
            <FileCode2 size={15} style={{ color: 'var(--accent-green)' }} />
            <input
              ref={inputRef}
              value={newFileName}
              onChange={(e) => setNewFileName(e.target.value)}
              onBlur={submitCreate}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submitCreate();
                if (e.key === 'Escape') {
                  setIsCreating(false);
                  setNewFileName('');
                }
              }}
              className="flex-1 text-sm px-1.5 py-0.5 rounded outline-none transition-all duration-200"
              style={{
                background: 'var(--bg-tertiary)',
                color: 'var(--text-primary)',
                border: '1px solid var(--accent-green)',
                boxShadow: '0 0 10px rgba(16, 185, 129, 0.15)',
              }}
              placeholder="filename.py"
            />
          </div>
        )}
      </div>

      {/* Footer */}
      <div
        className="px-5 py-3 text-xs tracking-wider"
        style={{
          borderTop: '1px solid var(--border-primary)',
          color: 'var(--text-muted)',
        }}
      >
        {files.length} file{files.length !== 1 ? 's' : ''}
      </div>
    </div>
  );
}
