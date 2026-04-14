import { useState } from 'react';
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
  ChevronDown
} from 'lucide-react';
import { 
  DndContext, 
  closestCenter, 
  KeyboardSensor, 
  PointerSensor, 
  useSensor, 
  useSensors 
} from '@dnd-kit/core';
import { 
  SortableContext, 
  sortableKeyboardCoordinates,
  verticalListSortingStrategy 
} from '@dnd-kit/sortable';
import FileTreeItem from './FileTreeItem';
import ChatPanel from './ChatPanel';

export default function Sidebar({ theme, collaborators = [], chatMessages, typingUsers, getSocket, roomId, currentUser, fileLocks = {} }) {
  const { files, activeFileId, openTab, createFile, createFolder, moveItem, deleteFile, toggleFolder, jumpToFileLine } = useFiles();
  const [activeSidebar, setActiveSidebar] = useState('explorer');
  const [isCreatingFile, setIsCreatingFile] = useState(false);
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [newFileName, setNewFileName] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const t = getThemeClasses(theme);

  const handleCreateFile = () => {
    if (activeSidebar === 'explorer') {
      setIsCreatingFile(true);
      setIsCreatingFolder(false);
      setNewFileName('');
    }
  };

  const handleCreateFolder = () => {
    if (activeSidebar === 'explorer') {
      setIsCreatingFolder(true);
      setIsCreatingFile(false);
      setNewFileName('');
    }
  };

  // Flatten tree for list rendering based on isOpen state
  const getVisibleFiles = () => {
    const visible = [];
    const pushChildren = (parentId, depth) => {
      const children = files
        .filter(f => f.parentId === parentId)
        .sort((a, b) => {
          // Folders top, then sort by order
          if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
          return a.order - b.order;
        });

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

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = (event) => {
    const { active, over } = event;
    
    if (!over || active.id === over.id) return;

    const activeItem = files.find(f => f.id === active.id);
    const overItem = files.find(f => f.id === over.id);

    if (!activeItem || !overItem) return;

    // Determine target parent and order
    let newParentId = overItem.parentId;
    let newOrder = overItem.order;

    if (overItem.type === 'folder') {
      // Dropping ON a folder puts it INSIDE that folder at position 0
      newParentId = overItem.id;
      newOrder = 0;
    } else {
      // Dropping on a file slots it next to the file
      if (activeItem.parentId === overItem.parentId) {
        // Reordering in current directory level
        if (activeItem.order < overItem.order) {
          // moving down, take its exact spot minus shift
          newOrder = overItem.order; 
        }
      }
    }

    moveItem(active.id, newParentId, newOrder);
  };

  // Process search results across all files locally
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
          matches.push({
            lineNumber: index + 1,
            content: line.trim()
          });
        }
      });
      
      if (matches.length > 0) {
        results.push({
          file: file,
          matches: matches
        });
      }
    });
    
    return results;
  })();

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
              <Plus size={14} className="cursor-pointer hover:text-indigo-500 transition-colors" title="New File" onClick={handleCreateFile} />
              <FolderPlus size={14} className="cursor-pointer hover:text-indigo-500 transition-colors" title="New Folder" onClick={handleCreateFolder} />
            </div>
          )}
        </div>
        
        <div className="flex-1 overflow-y-auto custom-scrollbar">
          {activeSidebar === 'explorer' && (
            <div className="flex flex-col">
              <div className={`flex items-center gap-1 px-3 py-1 text-xs ${theme === 'dark' ? 'text-white bg-white/5' : 'text-slate-800 bg-slate-200'} border-l-2 border-indigo-500 cursor-default select-none`}>
                <ChevronRight size={14} className="rotate-90" />
                <span className={`font-semibold uppercase tracking-tight text-[10px] ${t.textMuted}`}>Project Files</span>
              </div>
              {(isCreatingFile || isCreatingFolder) && (
                <div className={`flex items-center gap-2 px-4 py-1.5 text-xs ${theme === 'dark' ? 'bg-white/5' : 'bg-slate-200'}`}>
                  {isCreatingFolder ? <FolderPlus size={14} className={t.textMuted} /> : <FileCode size={14} className={t.textMuted} />}
                  <input
                    autoFocus
                    type="text"
                    value={newFileName}
                    onChange={(e) => setNewFileName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && newFileName.trim()) {
                        if (isCreatingFolder) {
                          createFolder(newFileName.trim(), null);
                        } else {
                          createFile(newFileName.trim(), null);
                        }
                        setIsCreatingFile(false);
                        setIsCreatingFolder(false);
                      }
                      if (e.key === 'Escape') {
                        setIsCreatingFile(false);
                        setIsCreatingFolder(false);
                      }
                    }}
                    onBlur={() => { setIsCreatingFile(false); setIsCreatingFolder(false); }}
                    placeholder={isCreatingFolder ? "folderName" : "filename.ext"}
                    className="w-full bg-transparent text-xs outline-none text-indigo-500 placeholder:text-slate-500"
                  />
                </div>
              )}
              
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
              >
                <SortableContext items={visibleFiles.map(f => f.id)} strategy={verticalListSortingStrategy}>
                  <div className="flex flex-col">
                    {visibleFiles.map(file => (
                      <FileTreeItem
                        key={file.id}
                        item={file}
                        depth={file.depth}
                        activeFileId={activeFileId}
                        fileLock={fileLocks[file.id]}
                        currentUserId={currentUser?.userId}
                        onOpenTempFile={openTab}
                        onDeleteFile={deleteFile}
                        onToggleFolder={toggleFolder}
                        themeClasses={t}
                      />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
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
    </>
  );
}
