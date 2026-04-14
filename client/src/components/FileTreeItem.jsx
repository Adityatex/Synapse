import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { FileCode, Folder, FolderOpen, Lock, Trash2 } from 'lucide-react';
import { useState } from 'react';

export default function FileTreeItem({ 
  item, 
  depth, 
  activeFileId, 
  fileLock,
  currentUserId,
  onOpenTempFile, 
  onDeleteFile, 
  onToggleFolder,
  themeClasses: t
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id, data: { ...item } });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    paddingLeft: `${depth * 16 + 16}px`, // 16px indent per level
    opacity: isDragging ? 0.4 : 1,
  };

  const isFolder = item.type === 'folder';
  const isActive = activeFileId === item.id;
  const isLockedByOther = Boolean(fileLock?.userId && fileLock.userId !== currentUserId);
  
  const [confirmDelete, setConfirmDelete] = useState(false);

  const handleClick = (e) => {
    e.stopPropagation();
    if (isFolder) {
      onToggleFolder(item.id);
    } else {
      onOpenTempFile(item.id);
    }
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center justify-between group py-1.5 pr-4 text-xs transition-colors cursor-pointer select-none border-y border-transparent hover:border-indigo-500/20 ${
        isActive 
          ? 'bg-indigo-500/10 text-indigo-500 border-r-2 border-indigo-500/50' 
          : `hover:bg-black/5 ${t.text} hover:text-indigo-500`
      }`}
      onClick={handleClick}
      {...attributes}
      {...listeners}
    >
      {confirmDelete ? (
        <div className="flex items-center justify-between w-full">
          <span className="text-red-400 font-medium">Delete {isFolder ? 'folder' : 'file'}?</span>
          <div className="flex gap-3 ml-2">
            <span 
              className="text-red-500 hover:text-red-400 font-bold"
              onPointerDown={(e) => { 
                e.stopPropagation(); 
                onDeleteFile(item.id); 
              }}
            >
              Yes
            </span>
            <span 
              className={t.textMuted}
              onPointerDown={(e) => { 
                e.stopPropagation(); 
                setConfirmDelete(false); 
              }}
            >
              No
            </span>
          </div>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-2 truncate">
            {isFolder ? (
              item.isOpen 
                ? <FolderOpen size={14} className={isActive ? 'text-indigo-400' : t.textMuted} />
                : <Folder size={14} className={isActive ? 'text-indigo-400' : t.textMuted} />
            ) : (
              <FileCode size={14} className={isActive ? 'text-indigo-500' : t.textMuted} />
            )}
            <span className="truncate">{item.name}</span>
            {!isFolder && fileLock && (
              <span
                className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-semibold ${
                  isLockedByOther ? 'bg-amber-500/15 text-amber-400' : 'bg-emerald-500/15 text-emerald-400'
                }`}
                title={isLockedByOther ? `${fileLock.username || 'Someone'} is editing` : 'You are editing'}
              >
                <Lock size={9} />
                <span>{isLockedByOther ? fileLock.username || 'Busy' : 'You'}</span>
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Trash2 
              size={12} 
              className="opacity-0 group-hover:opacity-100 hover:text-red-500 transition-all text-slate-400" 
              onClick={(e) => {
                e.stopPropagation();
                setConfirmDelete(true);
              }}
              onPointerDown={(e) => e.stopPropagation()}
            />
          </div>
        </>
      )}
    </div>
  );
}
