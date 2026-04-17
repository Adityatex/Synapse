import { useState, useRef, useEffect } from 'react';
import { useFiles } from '../contexts/FileContext';
import { getThemeClasses } from '../utils/theme';
import { readStorage, writeStorage } from '../utils/storage';
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
import { copyText } from '../utils/clipboard';
import { getAvatarStyle, getUserInitial } from '../utils/avatar';

const SIDEBAR_WIDTH_KEY = 'synapse-primary-sidebar-width';
const MIN_SIDEBAR_WIDTH = 280;
const MAX_SIDEBAR_WIDTH = 720;

function clampSidebarWidth(value) {
  return Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, value));
}

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
export default function Sidebar({
  theme,
  collaborators = [],
  chatMessages = [],
  typingUsers = [],
  getSocket = () => null,
  roomId,
  currentUser,
  fileLocks = {},
}) {
  const { files, activeFileId, openTab, createFile, createFolder, moveItem, renameFile, deleteFile, toggleFolder, jumpToFileLine } = useFiles();
  const [activeSidebar, setActiveSidebar] = useState('explorer');
  const [selectedItemId, setSelectedItemId] = useState(null);
  const [creatingType, setCreatingType] = useState(null);
  const [createParentId, setCreateParentId] = useState(null);
  const [newItemName, setNewItemName] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [activeDragId, setActiveDragId] = useState(null);
  const [overDragId, setOverDragId] = useState(null);
  const [dragOffset, setDragOffset] = useState(0);
  const [contextMenu, setContextMenu] = useState(null); // { x, y, item }
  const [renameTargetId, setRenameTargetId] = useState(null);
  const [seenChatCount, setSeenChatCount] = useState(chatMessages.length);
  const [seenUserCount, setSeenUserCount] = useState(collaborators.length);
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const savedWidth = Number(readStorage(SIDEBAR_WIDTH_KEY));
    if (Number.isFinite(savedWidth)) {
      return clampSidebarWidth(savedWidth);
    }
    return 320;
  });
  const t = getThemeClasses(theme);

  const createCommittedRef = useRef(false);
  const createInputRef = useRef(null);
  const resizeStateRef = useRef(null);

  useEffect(() => {
    writeStorage(SIDEBAR_WIDTH_KEY, String(sidebarWidth));
  }, [sidebarWidth]);

  useEffect(() => {
    const handlePointerMove = (event) => {
      const resizeState = resizeStateRef.current;
      if (!resizeState) return;

      const nextWidth = resizeState.startWidth + (event.clientX - resizeState.startX);
      setSidebarWidth(clampSidebarWidth(nextWidth));
    };

    const stopResizing = () => {
      resizeStateRef.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', stopResizing);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', stopResizing);
    };
  }, []);

  const effectiveSelectedItemId = selectedItemId || activeFileId || null;

  const hasNewUser = activeSidebar !== 'users' && collaborators.length > seenUserCount;
  const unreadMessages = Math.max(0, chatMessages.length - seenChatCount);
  const recentMessages = chatMessages.slice(Math.max(0, seenChatCount));
  const myName = (currentUser?.username || currentUser?.name || '').toLowerCase();
  const hasUnreadMention = activeSidebar !== 'chat' && recentMessages.some((msg) => {
    if (msg.type === 'system' || msg.senderId === currentUser?.userId) return false;
    return myName && msg.content?.toLowerCase().includes(`@${myName}`);
  });
  const hasUnreadMsgs = activeSidebar !== 'chat' && unreadMessages > 0 && !hasUnreadMention;

  // ─── Target folder logic ────────────────────────────────────────────
  const getTargetParentId = (itemOrId) => {
    const refId = itemOrId || effectiveSelectedItemId;
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

  const commitCreate = () => {
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
  };

  const cancelCreate = () => {
    createCommittedRef.current = true;
    setCreatingType(null);
    setCreateParentId(null);
    setNewItemName('');
  };

  // ─── Context menu handler ──────────────────────────────────────────
  const handleItemContextMenu = (e, item) => {
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
      action: () => copyText(item.name),
    });

    setContextMenu({ x: e.clientX, y: e.clientY, items: menuItems });
  };

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
          // 1. Folders always come before files
          if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
          // 2. Within the same type, respect the manual order
          if (a.order !== b.order) return a.order - b.order;
          // 3. Fallback to name (alphabetic) if orders are identical
          return a.name.localeCompare(b.name);
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

  function getProjectedState(visibleItems, activeId, overId, deltaX) {
    const activeIndex = visibleItems.findIndex(f => f.id === activeId);
    let overIndex = visibleItems.findIndex(f => f.id === overId);
    
    if (activeIndex === -1) return null;
    if (overIndex === -1) overIndex = activeIndex;
    
    const activeItem = visibleItems[activeIndex];
    const depthOffset = Math.round(deltaX / 16);
    let projectedDepth = Math.max(0, activeItem.depth + depthOffset);
    
    const previousItemIndex = overIndex > activeIndex ? overIndex : overIndex - 1;
    const previousItem = previousItemIndex >= 0 ? visibleItems[previousItemIndex] : null;

    let maxDepth = 0;
    if (previousItem) {
      maxDepth = previousItem.depth;
      if (previousItem.type === 'folder' && previousItem.id !== activeId) {
        maxDepth += 1;
      }
    }
    
    projectedDepth = Math.min(projectedDepth, maxDepth);

    let projectedParentId = null;
    for (let i = previousItemIndex; i >= 0; i--) {
      const item = visibleItems[i];
      if (item.depth === projectedDepth - 1 && item.type === 'folder') {
        projectedParentId = item.id;
        break;
      }
    }

    if (projectedDepth === 0) projectedParentId = null;

    return { projectedDepth, projectedParentId, insertIndex: overIndex };
  }

  const handleDragStart = (event) => {
    setActiveDragId(event.active.id);
    setOverDragId(event.active.id);
    setDragOffset(0);
  };
  
  const handleDragMove = (event) => {
    setDragOffset(event.delta.x);
    if (event.over) setOverDragId(event.over.id);
  };

  const handleDragCancel = () => {
    setActiveDragId(null);
    setOverDragId(null);
    setDragOffset(0);
  };

  const handleDragEnd = (event) => {
    const activeId = activeDragId;
    setActiveDragId(null);
    setOverDragId(null);
    setDragOffset(0);
    
    const { active, over } = event;
    if (!over || !activeId) return;

    if (active.id === over.id && dragOffset < 8 && dragOffset > -8) return;

    const projectedState = getProjectedState(visibleFiles, active.id, over.id, dragOffset);
    if (!projectedState) return;

    const { projectedParentId, insertIndex } = projectedState;

    // Calculate position among siblings of the projected parent.
    // To correctly "insert between", we find items in the visible flat list
    // that belong to our projected parent and count how many are BEFORE the overIndex.
    let siblingOrder = 0;
    for (let i = 0; i < insertIndex; i++) {
        if (visibleFiles[i].id === activeId) continue;
        if (visibleFiles[i].parentId === projectedParentId) {
            siblingOrder++;
        }
    }

    // If we are dropping on ourself, do nothing
    if (activeId === (over?.id || null) && siblingOrder === visibleFiles.findIndex(f => f.id === activeId)) return;

    // It's possible the drop zone implies inserting *before* a folder that is currently overIndex
    // But since the siblingOrder just increments, this loosely aligns it to the right position.

    moveItem(active.id, projectedParentId, siblingOrder);
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

  const handleSidebarToggle = (type) => {
    setActiveSidebar((prev) => {
      const next = prev === type ? null : type;

      if (next === 'users') {
        setSeenUserCount(collaborators.length);
      }

      if (next === 'chat') {
        setSeenChatCount(chatMessages.length);
      }

      return next;
    });
  };

  const startResizing = (event) => {
    event.preventDefault();
    resizeStateRef.current = {
      startX: event.clientX,
      startWidth: sidebarWidth,
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  return (
    <>
      {/* Activity Bar */}
      <nav className={`w-12 ${theme === 'dark' ? 'bg-[#0d1117] border-white/10 shadow-black/50' : 'bg-slate-200/80 border-slate-300 shadow-slate-200/50'} border rounded-xl shadow-lg flex flex-col items-center py-4 gap-4 shrink-0 overflow-hidden`}>
        {(roomId ? ['explorer', 'search', 'users', 'chat'] : ['explorer', 'search']).map((type) => (
          <button 
            key={type}
            onClick={() => handleSidebarToggle(type)}
            className={`p-2 rounded-lg transition-all cursor-pointer ${activeSidebar === type ? 'text-indigo-500 bg-indigo-500/10' : theme === 'dark' ? 'text-slate-500 hover:text-slate-300 hover:bg-white/5' : 'text-slate-500 hover:text-slate-800 hover:bg-black/5'}`}
            title={type.charAt(0).toUpperCase() + type.slice(1)}
          >
            {type === 'explorer' && <Files size={20} />}
            {type === 'search' && <Search size={20} />}
            {type === 'users' && (
              <div className="relative">
                <Users size={20} />
                {hasNewUser && (
                  <div className={`absolute -top-1 -right-1 w-2.5 h-2.5 bg-emerald-500 rounded-full border-2 ${theme === 'dark' ? 'border-[#0d1117]' : 'border-slate-200'} shadow-[0_0_5px_rgba(16,185,129,0.5)] z-10`} />
                )}
              </div>
            )}
            {type === 'chat' && (
              <div className="relative">
                <MessageSquare size={20} />
                {hasUnreadMention && (
                  <div className={`absolute -top-2.5 -left-2.5 w-5 h-5 min-w-5 min-h-5 bg-indigo-500 text-white text-[11px] font-black rounded-full flex items-center justify-center border-2 ${theme === 'dark' ? 'border-white/20' : 'border-indigo-100'} shadow-[0_0_8px_rgba(99,102,241,0.5)] animate-pulse z-20`}>
                    @
                  </div>
                )}
                {hasUnreadMsgs && (
                  <div className={`absolute -top-1 -right-1 w-2.5 h-2.5 bg-rose-500 rounded-full border-2 ${theme === 'dark' ? 'border-[#0d1117]' : 'border-slate-200'} shadow-sm z-10`} />
                )}
              </div>
            )}
          </button>
        ))}
        <div className="flex-1" />
      </nav>

      {/* Primary Sidebar */}
      {activeSidebar && (
        <aside
          style={{ width: `${sidebarWidth}px` }}
          className={`relative ${t.sidebar} border rounded-xl shadow-lg flex flex-col transition-[width] duration-200 shrink-0 overflow-hidden min-w-0 ${theme === 'dark' ? 'border-white/10 shadow-black/50' : 'border-slate-300 shadow-slate-200/50'}`}
        >
          <button
            type="button"
            aria-label="Resize sidebar"
            onPointerDown={startResizing}
            className="absolute right-0 top-0 z-20 h-full w-3 translate-x-1/2 cursor-col-resize hover:bg-white/5"
          >
            <span className="sr-only">Resize</span>
          </button>
          <div className={`p-3 text-[11px] font-bold ${t.textMuted} uppercase tracking-[0.12em] flex justify-between items-center bg-black/10`}>
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
                <div className={`flex items-center gap-1 px-3 py-1.5 text-xs ${theme === 'dark' ? 'text-white bg-white/5' : 'text-slate-800 bg-slate-200'} border-l-2 border-indigo-500 cursor-default select-none`}>
                  <ChevronRight size={14} className="rotate-90" />
                  <span className={`font-semibold uppercase tracking-tight text-[11px] ${t.textMuted}`}>Project Files</span>
                </div>

                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  onDragStart={handleDragStart}
                  onDragMove={handleDragMove}
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
                              className={`relative flex items-center gap-1.5 py-0.75 text-xs ${theme === 'dark' ? 'bg-indigo-500/10' : 'bg-indigo-50'}`}
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

                        const isDragged = file.id === activeDragId;
                        let displayDepth = file.depth;
                        if (isDragged && overDragId) {
                          const proj = getProjectedState(visibleFiles, activeDragId, overDragId, dragOffset);
                          if (proj) displayDepth = proj.projectedDepth;
                        }

                        return (
                          <FileTreeItem
                            key={file.id}
                            item={{ ...file, _triggerRename: renameTargetId === file.id }}
                            depth={displayDepth}
                            activeFileId={activeFileId}
                            selectedItemId={effectiveSelectedItemId}
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
                <div className="flex-1 min-h-10" />
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
                      <div className="text-[11px] font-bold text-indigo-500 uppercase px-2 tracking-wide">
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
                                <span className={`text-[11px] tabular-nums shrink-0 mt-0.5 ${theme === 'dark' ? 'text-slate-500 group-hover:text-slate-400' : 'text-slate-400 group-hover:text-slate-600'}`}>
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
                  const userGlyph = getUserInitial(user);
                  const avatarStyle = getAvatarStyle(user, user.cursorColor || user.color);
                  return (
                    <div key={user.userId || user.id} className={`flex items-center gap-3 p-2 ${theme === 'dark' ? 'hover:bg-white/5' : 'hover:bg-slate-200'} rounded-md group cursor-pointer transition-colors`}>
                      <div className="relative shrink-0">
                        <div 
                          className="w-8 h-8 rounded-full flex items-center justify-center text-[10px] font-bold shadow-sm"
                          style={avatarStyle}
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
      )}

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
