import { useFiles } from '../contexts/FileContext';
import { getThemeClasses } from '../utils/theme';
import { X, FileCode, ChevronRight, Lock } from 'lucide-react';

export default function TabBar({ theme, roomId = 'Room', fileLocks = {}, currentUserId }) {
  const { files, openTabs, activeFileId, openTab, closeTab } = useFiles();
  const t = getThemeClasses(theme);

  const tabFiles = openTabs
    .map(id => files.find(f => f.id === id))
    .filter(Boolean);

  const activeFile = files.find(f => f.id === activeFileId);

  return (
    <>
      {/* Tabs */}
      <div className={`flex ${t.header} border-b ${t.border} h-9 overflow-x-auto scrollbar-hide`}>
        {tabFiles.map((file) => {
          const isActive = file.id === activeFileId;
          const fileLock = fileLocks[file.id];
          const isLockedByOther = Boolean(fileLock?.userId && fileLock.userId !== currentUserId);
          return (
            <div 
              key={file.id}
              onClick={() => openTab(file.id)}
              className={`flex items-center gap-2 px-4 py-2 text-[11px] border-r ${t.border} cursor-pointer min-w-[120px] relative transition-all group select-none ${isActive ? t.tabActive + ' shadow-[inset_0_2px_0_0_#6366f1]' : t.tabInactive}`}
            >
              <FileCode size={12} className={isActive ? 'text-indigo-500 shrink-0' : `${t.textMuted} shrink-0`} />
              <span className="truncate">{file.name}</span>
              {fileLock && (
                <span
                  className={`inline-flex items-center ${isLockedByOther ? 'text-amber-400' : 'text-emerald-400'}`}
                  title={isLockedByOther ? `${fileLock.username || 'Someone'} is editing` : 'You hold the lock'}
                >
                  <Lock size={10} />
                </span>
              )}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  closeTab(file.id);
                }}
                className={`ml-auto opacity-0 group-hover:opacity-100 ${t.textMuted} hover:text-indigo-500 transition-opacity cursor-pointer`}
              >
                <X size={12} />
              </button>
            </div>
          );
        })}
      </div>

      {/* Breadcrumbs */}
      <div className={`flex items-center gap-1 px-4 py-1.5 text-[10px] ${t.textMuted} ${t.bg} border-b ${t.border} shrink-0`}>
        <span className="hover:text-indigo-500 cursor-pointer">{roomId}</span>
        <ChevronRight size={10} />
        <span className="hover:text-indigo-500 cursor-pointer">src</span>
        {activeFile && (
          <>
            <ChevronRight size={10} />
            <span className="text-indigo-500 font-medium">{activeFile.name}</span>
          </>
        )}
      </div>
    </>
  );
}
