import { useState, useRef, useCallback, useEffect } from 'react';
import { useFiles } from '../contexts/FileContext';
import { getThemeClasses } from '../utils/theme';
import {
  Files,
  Search,
  Users,
  MessageSquare,
  ChevronRight,
  FileCode,
  Plus,
  Trash2,
  FolderPlus,
  X,
  ChevronDown,
  Pencil,
  FilePlus,
  Copy,
} from 'lucide-react';
import { 
  DndContext, 
  closestCenter, 
  KeyboardSensor, 
  PointerSensor, 
  useSensor, 
  useSensors,
  DragOverlay,
} from '@dnd-kit/core';
import { 
  SortableContext, 
  sortableKeyboardCoordinates,
  verticalListSortingStrategy 
} from '@dnd-kit/sortable';
import FileTreeItem from './FileTreeItem';
import ChatPanel from './ChatPanel';

// ─── Context Menu Component ─────────────────────────────────────────────────
function ContextMenu({ x, y, items, onClose, theme }) {
  const menuRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        onClose();
      }
    };
    const handleEsc = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEsc);
    };
  }, [onClose]);

  // Adjust position if menu would overflow viewport
  useEffect(() => {
    if (menuRef.current) {
      const rect = menuRef.current.getBoundingClientRect();
      if (rect.right > window.innerWidth) {
        menuRef.current.style.left = `${x - rect.width}px`;
      }
      if (rect.bottom > window.innerHeight) {
        menuRef.current.style.top = `${y - rect.height}px`;
      }
    }
  }, [x, y]);

  return (
    <div
      ref={menuRef}
      className={`fixed z-[9999] py-1 min-w-[180px] rounded-lg shadow-xl border backdrop-blur-sm ${
        theme === 'dark'
          ? 'bg-[#1e2030]/95 border-white/10 shadow-black/60'
          : 'bg-white/95 border-slate-200 shadow-slate-300/60'
      }`}
      style={{ left: x, top: y }}
    >
      {items.map((item, i) => {
        if (item.type === 'separator') {
          return <div key={i} className={`my-1 border-t ${theme === 'dark' ? 'border-white/8' : 'border-slate-200'}`} />;
        }
        return (
          <button
            key={i}
            className={`w-full flex items-center gap-3 px-3 py-1.5 text-xs text-left transition-colors ${
              theme === 'dark'
                ? 'text-slate-300 hover:bg-indigo-500/15 hover:text-indigo-300'
                : 'text-slate-700 hover:bg-indigo-50 hover:text-indigo-600'
            }`}
            onClick={() => {
              item.action();
              onClose();
            }}
          >
            {item.icon && <item.icon size={13} className={item.iconColor || ''} />}
            <span className="flex-1">{item.label}</span>
            {item.shortcut && (
              <span className={`text-[10px] ${theme === 'dark' ? 'text-slate-500' : 'text-slate-400'}`}>
                {item.shortcut}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ─── Main Sidebar ───────────────────────────────────────────────────────────
export default function Sidebar({ theme, collaborators = [], chatMessages, typingUsers, getSocket, roomId, currentUser, fileLocks = {} }) {
  const { files, activeFileId, openTab, createFile, createFolder, moveItem, renameFile, deleteFile, toggleFolder, jumpToFileLine } = useFiles();
  const [activeSidebar, setActiveSidebar] = useState('explorer');
  const [selectedItemId, setSelectedItemId] = useState(null);
  const [creatingType, setCreatingType] = useState(null);
  const [createParentId, setCreateParentId] = useState(null);
  const [newItemName, setNewItemName] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [activeDragId, setActiveDragId] = useState(null);
  const [contextMenu, setContextMenu] = useState(null); // { x, y, item }
  const [renameTargetId, setRenameTargetId] = useState(null);
  const t = getThemeClasses(theme);

  const createCommittedRef = useRef(false);
  const createInputRef = useRef(null);

  // Keep selectedItemId in sync with activeFileId
  useEffect(() => {
    if (activeFileId && !selectedItemId) {
      setSelectedItemId(activeFileId);
    }
  }, [activeFileId]);

  // ─── Target folder logic ────────────────────────────────────────────
  const getTargetParentId = (itemOrId) => {
    const refId = itemOrId || selectedItemId || activeFileId;
    if (!refId) return null;
    const item = files.find(f => f.id === refId);
    if (!item) return null;
    if (item.type === 'folder') return item.id;
    return item.parentId || null;
  };

  const startCreate = (type, contextItemId) => {
    createCommittedRef.current = false;
    const parentId = getTargetParentId(contextItemId);
    setCreateParentId(parentId);
    setCreatingType(type);
    setNewItemName('');
    if (parentId) {
      const parentFolder = files.find(f => f.id === parentId);
      if (parentFolder && !parentFolder.isOpen) {
        toggleFolder(parentId);
      }
    }
  };

  const handleCreateFile = () => {
    if (activeSidebar !== 'explorer') return;
    startCreate('file');
  };
  const handleCreateFolder = () => {
    if (activeSidebar !== 'explorer') return;
    startCreate('folder');
  };

  const commitCreate = useCallback(() => {
    if (createCommittedRef.current) return;
    createCommittedRef.current = true;
    const trimmed = newItemName.trim();
    if (trimmed && creatingType === 'folder') {
      createFolder(trimmed, createParentId);
    } else if (trimmed && creatingType === 'file') {
      createFile(trimmed, createParentId);
    }
    setCreatingType(null);
    setCreateParentId(null);
    setNewItemName('');
  }, [newItemName, creatingType, createParentId, createFile, createFolder]);

  const cancelCreate = useCallback(() => {
    createCommittedRef.current = true;
    setCreatingType(null);
    setCreateParentId(null);
    setNewItemName('');
  }, []);

  // ─── Context menu handler ──────────────────────────────────────────
  const handleItemContextMenu = useCallback((e, item) => {
    const isFolder = item.type === 'folder';
    const menuItems = [];

    if (isFolder) {
      menuItems.push({
        label: 'New File',
        icon: FilePlus,
        iconColor: 'text-indigo-400',
        action: () => startCreate('file', item.id),
      });
      menuItems.push({
        label: 'New Folder',
        icon: FolderPlus,
        iconColor: 'text-amber-400',
        action: () => startCreate('folder', item.id),
      });
      menuItems.push({ type: 'separator' });
    }

    menuItems.push({
      label: 'Rename',
      icon: Pencil,
      iconColor: 'text-indigo-400',
      shortcut: 'F2',
      action: () => setRenameTargetId(item.id),
    });
    menuItems.push({
      label: 'Delete',
      icon: Trash2,
      iconColor: 'text-red-400',
      shortcut: 'Del',
      action: () => deleteFile(item.id),
    });

    menuItems.push({ type: 'separator' });

    if (!isFolder) {
      menuItems.push({
        label: 'New File Here',
        icon: FilePlus,
        iconColor: 'text-indigo-400',
        action: () => startCreate('file', item.id),
      });
      menuItems.push({
        label: 'New Folder Here',
        icon: FolderPlus,
        iconColor: 'text-amber-400',
        action: () => startCreate('folder', item.id),
      });
      menuItems.push({ type: 'separator' });
    }

    menuItems.push({
      label: 'Copy Name',
      icon: Copy,
      action: () => navigator.clipboard?.writeText(item.name),
    });

    setContextMenu({ x: e.clientX, y: e.clientY, items: menuItems });
  }, [files, deleteFile]);

  // ─── Rename trigger handling ───────────────────────────────────────
  // When renameTargetId is set by context menu, we pass it down to the matching FileTreeItem
  // and then clear it after the render
  useEffect(() => {
    if (renameTargetId) {
      const timer = setTimeout(() => setRenameTargetId(null), 100);
      return () => clearTimeout(timer);
    }
  }, [renameTargetId]);

  // ─── Flatten tree ──────────────────────────────────────────────────
  const getVisibleFiles = () => {
    const visible = [];
    const pushChildren = (parentId, depth) => {
      const children = files
        .filter(f => f.parentId === parentId)
        .sort((a, b) => {
          if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
          return a.order - b.order;
        });

      if (creatingType && createParentId === parentId) {
        visible.push({ id: '__creating__', type: '__creating__', depth, parentId });
      }

      for (const child of children) {
        visible.push({ ...child, depth });
        if (child.type === 'folder' && child.isOpen) {
          pushChildren(child.id, depth + 1);
        }
      }
    };
    pushChildren(null, 0);
    return visible;
  };

  const visibleFiles = getVisibleFiles();

  // ─── DnD ──────────────────────────────────────────────────────────
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleDragStart = (event) => setActiveDragId(event.active.id);
  const handleDragCancel = () => setActiveDragId(null);

  const handleDragEnd = (event) => {
    setActiveDragId(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const activeItem = files.find(f => f.id === active.id);
    const overItem = files.find(f => f.id === over.id);
    if (!activeItem || !overItem) return;

    let newParentId = overItem.parentId;
    let newOrder = overItem.order;

    if (overItem.type === 'folder') {
      newParentId = overItem.id;
      newOrder = 0;
      if (!overItem.isOpen) toggleFolder(overItem.id);
    } else {
      newParentId = overItem.parentId;
      if (activeItem.parentId === overItem.parentId) {
        if (activeItem.order < overItem.order) newOrder = overItem.order;
      } else {
        newOrder = overItem.order + 1;
      }
    }
    moveItem(active.id, newParentId, newOrder);
  };

  const draggedItem = activeDragId ? visibleFiles.find(f => f.id === activeDragId) : null;

  // ─── Search ───────────────────────────────────────────────────────
  const searchResults = (() => {
    if (!searchQuery.trim()) return [];
    const query = searchQuery.toLowerCase();
    const results = [];
    files.forEach(file => {
      if (file.type === 'folder' || !file.content) return;
      const lines = file.content.split('\n');
      const matches = [];
      lines.forEach((line, index) => {
        if (line.toLowerCase().includes(query)) {
          matches.push({ lineNumber: index + 1, content: line.trim() });
        }
      });
      if (matches.length > 0) {
        results.push({ file, matches });
      }
    });
    return results;
  })();

  // ─── Right-click on empty area of explorer ────────────────────────
  const handleExplorerContextMenu = (e) => {
    e.preventDefault();
    const menuItems = [
      {
        label: 'New File',
        icon: FilePlus,
        iconColor: 'text-indigo-400',
        action: () => startCreate('file', null),
      },
      {
        label: 'New Folder',
        icon: FolderPlus,
        iconColor: 'text-amber-400',
        action: () => startCreate('folder', null),
      },
    ];
    setContextMenu({ x: e.clientX, y: e.clientY, items: menuItems });
  };

  // Click on empty space deselects
  const handleExplorerBgClick = () => {
    setSelectedItemId(null);
  };

  return (
    <>
      {/* Activity Bar */}
      <nav className={`w-12 ${theme === 'dark' ? 'bg-[#0d1117] border-white/10 shadow-black/50' : 'bg-slate-200/80 border-slate-300 shadow-slate-200/50'} border rounded-xl shadow-lg flex flex-col items-center py-4 gap-4 shrink-0 overflow-hidden`}>
        {(roomId ? ['explorer', 'search', 'users', 'chat'] : ['explorer', 'search']).map((type) => (
          <button 
            key={type}
            onClick={() => setActiveSidebar(type)}
            className={`p-2 rounded-lg transition-all cursor-pointer ${activeSidebar === type ? 'text-indigo-500 bg-indigo-500/10' : theme === 'dark' ? 'text-slate-500 hover:text-slate-300 hover:bg-white/5' : 'text-slate-500 hover:text-slate-800 hover:bg-black/5'}`}
            title={type.charAt(0).toUpperCase() + type.slice(1)}
          >
            {type === 'explorer' && <Files size={20} />}
            {type === 'search' && <Search size={20} />}
            {type === 'users' && <Users size={20} />}
            {type === 'chat' && <MessageSquare size={20} />}
          </button>
        ))}
        <div className="flex-1" />
      </nav>

      {/* Primary Sidebar */}
      <aside className={`w-64 ${t.sidebar} border rounded-xl shadow-lg flex flex-col transition-colors duration-300 shrink-0 overflow-hidden ${theme === 'dark' ? 'border-white/10 shadow-black/50' : 'border-slate-300 shadow-slate-200/50'}`}>
        <div className={`p-3 text-[10px] font-bold ${t.textMuted} uppercase tracking-widest flex justify-between items-center bg-black/10`}>
          {activeSidebar === 'explorer' && "Explorer"}
          {activeSidebar === 'search' && "Search"}
          {activeSidebar === 'users' && "Collaborators"}
          {activeSidebar === 'chat' && "Room Chat"}
          {activeSidebar === 'explorer' && (
            <div className="flex gap-3">
              <FilePlus size={14} className="cursor-pointer hover:text-indigo-500 transition-colors" title="New File" onClick={handleCreateFile} />
              <FolderPlus size={14} className="cursor-pointer hover:text-indigo-500 transition-colors" title="New Folder" onClick={handleCreateFolder} />
            </div>
          )}
        </div>
        
        <div className="flex-1 overflow-y-auto custom-scrollbar">
          {activeSidebar === 'explorer' && (
            <div 
              className="flex flex-col min-h-full"
              onClick={handleExplorerBgClick}
              onContextMenu={handleExplorerContextMenu}
            >
              <div className={`flex items-center gap-1 px-3 py-1 text-xs ${theme === 'dark' ? 'text-white bg-white/5' : 'text-slate-800 bg-slate-200'} border-l-2 border-indigo-500 cursor-default select-none`}>
                <ChevronRight size={14} className="rotate-90" />
                <span className={`font-semibold uppercase tracking-tight text-[10px] ${t.textMuted}`}>Project Files</span>
              </div>

              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragStart={handleDragStart}
                onDragEnd={handleDragEnd}
                onDragCancel={handleDragCancel}
              >
                <SortableContext items={visibleFiles.filter(f => f.id !== '__creating__').map(f => f.id)} strategy={verticalListSortingStrategy}>
                  <div className="flex flex-col">
                    {visibleFiles.map(file => {
                      if (file.id === '__creating__') {
                        const inputDepth = file.depth;
                        return (
                          <div
                            key="__creating__"
                            className={`relative flex items-center gap-1.5 py-[3px] text-xs ${theme === 'dark' ? 'bg-indigo-500/10' : 'bg-indigo-50'}`}
                            style={{ paddingLeft: `${inputDepth * 16 + 12}px` }}
                            onClick={(e) => e.stopPropagation()}
                          >
                            <span className="w-3 shrink-0" />
                            {creatingType === 'folder'
                              ? <FolderPlus size={14} className="text-amber-400/80 shrink-0" />
                              : <FileCode size={14} className="text-indigo-400 shrink-0" />
                            }
                            <input
                              ref={createInputRef}
                              autoFocus
                              type="text"
                              value={newItemName}
                              onChange={(e) => setNewItemName(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') { e.preventDefault(); commitCreate(); }
                                if (e.key === 'Escape') { e.preventDefault(); cancelCreate(); }
                              }}
                              onBlur={() => setTimeout(() => commitCreate(), 50)}
                              placeholder={creatingType === 'folder' ? "folder name..." : "filename.ext"}
                              className={`flex-1 min-w-0 text-xs outline-none py-0.5 px-1 rounded ${theme === 'dark' ? 'bg-[#1a1f2e] text-indigo-400 border border-indigo-500/50' : 'bg-white text-indigo-600 border border-indigo-500/50'}`}
                            />
                          </div>
                        );
                      }

                      return (
                        <FileTreeItem
                          key={file.id}
                          item={{ ...file, _triggerRename: renameTargetId === file.id }}
                          depth={file.depth}
                          activeFileId={activeFileId}
                          selectedItemId={selectedItemId}
                          fileLock={fileLocks[file.id]}
                          currentUserId={currentUser?.userId}
                          onOpenTempFile={openTab}
                          onDeleteFile={deleteFile}
                          onToggleFolder={toggleFolder}
                          onRenameFile={renameFile}
                          onSelect={setSelectedItemId}
                          onContextMenu={handleItemContextMenu}
                          themeClasses={t}
                          theme={theme}
                        />
                      );
                    })}
                  </div>
                </SortableContext>
                <DragOverlay dropAnimation={null}>
                  {draggedItem ? (
                    <div className={`text-xs flex items-center gap-2 px-4 py-1.5 rounded-md shadow-lg border ${
                      theme === 'dark' 
                        ? 'bg-[#1a1f2e] border-indigo-500/40 text-slate-200' 
                        : 'bg-white border-indigo-500/40 text-slate-700'
                    }`}>
                      {draggedItem.type === 'folder' 
                        ? <FolderPlus size={14} className="text-amber-400" />
                        : <FileCode size={14} className="text-indigo-400" />
                      }
                      <span>{draggedItem.name}</span>
                    </div>
                  ) : null}
                </DragOverlay>
              </DndContext>

              {/* Empty space fill for right-click */}
              <div className="flex-1 min-h-[40px]" />
            </div>
          )}

          {activeSidebar === 'search' && (
            <div className="flex flex-col h-full">
              <div className="px-4 py-3 border-b border-white/5 shrink-0">
                <div className={`flex items-center gap-2 px-3 py-1.5 rounded bg-black/10 border ${theme === 'dark' ? 'border-white/10 text-white' : 'border-slate-300 bg-white text-slate-800'}`}>
                  <Search size={14} className={t.textMuted} />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search codebase..."
                    className="w-full bg-transparent text-xs outline-none"
                    autoFocus
                  />
                  {searchQuery && (
                    <X size={14} className={`cursor-pointer hover:text-indigo-500 ${t.textMuted}`} onClick={() => setSearchQuery('')} />
                  )}
                </div>
              </div>

              <div className="flex-1 overflow-y-auto custom-scrollbar p-2">
                {!searchQuery.trim() ? (
                  <div className={`text-xs ${t.textMuted} text-center py-8`}>
                    Type to search across all files
                  </div>
                ) : searchResults.length === 0 ? (
                  <div className={`text-xs ${t.textMuted} text-center py-8`}>
                    No results found for "{searchQuery}"
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="text-[10px] font-bold text-indigo-500 uppercase px-2">
                      {searchResults.reduce((acc, curr) => acc + curr.matches.length, 0)} results in {searchResults.length} files
                    </div>
                    {searchResults.map(({ file, matches }) => (
                      <div key={file.id} className="flex flex-col">
                        <div 
                          className={`flex items-center gap-2 px-2 py-1.5 text-xs font-semibold ${t.text} cursor-pointer hover:text-indigo-500 transition-colors`}
                          onClick={() => openTab(file.id)}
                        >
                          <ChevronDown size={14} className={t.textMuted} />
                          <FileCode size={14} className={activeFileId === file.id ? 'text-indigo-500' : t.textMuted} />
                          <span className="truncate">{file.name}</span>
                        </div>
                        <div className="flex flex-col pl-6">
                          {matches.map((match, i) => (
                            <div 
                              key={i}
                              className={`group flex items-start gap-3 px-2 py-1 cursor-pointer rounded transition-colors ${theme === 'dark' ? 'hover:bg-white/5' : 'hover:bg-slate-200'} text-xs`}
                              onClick={() => jumpToFileLine(file.id, match.lineNumber)}
                            >
                              <span className={`text-[10px] tabular-nums shrink-0 mt-0.5 ${theme === 'dark' ? 'text-slate-500 group-hover:text-slate-400' : 'text-slate-400 group-hover:text-slate-600'}`}>
                                {match.lineNumber}
                              </span>
                              <span className={`font-mono truncate opacity-80 ${theme === 'dark' ? 'text-slate-300 group-hover:text-white' : 'text-slate-700 group-hover:text-black'}`}>
                                {match.content}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {activeSidebar === 'users' && (
            <div className="px-2 space-y-1 py-1">
              {collaborators.map(user => {
                const isOnline = user.status !== 'offline';
                const userGlyph = user.avatarGlyph || (user.username ? user.username[0].toUpperCase() : 'A');
                return (
                  <div key={user.userId || user.id} className={`flex items-center gap-3 p-2 ${theme === 'dark' ? 'hover:bg-white/5' : 'hover:bg-slate-200'} rounded-md group cursor-pointer transition-colors`}>
                    <div className="relative shrink-0">
                      <div 
                        className="w-8 h-8 rounded-full flex items-center justify-center text-[10px] font-bold text-white shadow-sm"
                        style={{ backgroundColor: user.cursorColor || user.color || '#3b82f6' }}
                      >
                        {userGlyph}
                      </div>
                      <div className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 ${t.sidebar} ${isOnline ? 'bg-emerald-500' : 'bg-slate-400'}`} />
                    </div>
                    <div className="flex flex-col min-w-0">
                      <span className={`text-[11px] font-medium ${theme === 'dark' ? 'text-slate-200' : 'text-slate-800'} truncate`}>
                        {user.username || user.name} {user.isYou && <span className="text-indigo-500 font-normal">(You)</span>}
                      </span>
                      <span className={`text-[10px] ${t.textMuted}`}>{isOnline ? 'Online' : 'Offline'}</span>
                    </div>
                  </div>
                );
              })}
              {collaborators.length === 0 && (
                <div className={`text-xs ${t.textMuted} text-center py-4`}>
                  No peers connected
                </div>
              )}
            </div>
          )}

          {activeSidebar === 'chat' && (
            <ChatPanel 
              theme={theme}
              themeClasses={t}
              chatMessages={chatMessages}
              typingUsers={typingUsers}
              getSocket={getSocket}
              roomId={roomId}
              currentUser={currentUser}
              collaborators={collaborators}
            />
          )}
        </div>
      </aside>

      {/* Context Menu Portal */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenu.items}
          onClose={() => setContextMenu(null)}
          theme={theme}
        />
      )}
    </>
  );
}
