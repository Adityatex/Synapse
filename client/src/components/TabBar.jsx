import { useFiles } from '../contexts/FileContext';
import { X, FileCode2 } from 'lucide-react';
import { getLanguageByExtension } from '../utils/languageMap';

export default function TabBar() {
  const { files, openTabs, activeFileId, openTab, closeTab } = useFiles();

  const tabFiles = openTabs
    .map(id => files.find(f => f.id === id))
    .filter(Boolean);

  return (
    <div
      className="flex items-center overflow-x-auto"
      style={{
        height: 'var(--tabbar-height)',
        background: 'var(--bg-secondary)',
        borderBottom: '1px solid var(--border-primary)',
      }}
    >
      {tabFiles.map((file) => {
        const isActive = file.id === activeFileId;
        return (
          <div
            key={file.id}
            className="flex items-center gap-2.5 px-5 cursor-pointer transition-all duration-300 shrink-0 group"
            style={{
              height: '100%',
              background: isActive ? 'var(--bg-primary)' : 'transparent',
              borderRight: '1px solid var(--border-primary)',
              borderBottom: isActive ? '2px solid var(--accent-blue)' : '2px solid transparent',
              color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
            }}
            onClick={() => openTab(file.id)}
            onMouseEnter={(e) => {
              if (!isActive) e.currentTarget.style.background = 'var(--bg-hover)';
            }}
            onMouseLeave={(e) => {
              if (!isActive) e.currentTarget.style.background = 'transparent';
            }}
          >
            <span className="text-[13px] shrink-0">{getLanguageByExtension(file.name).icon}</span>
            <span className="text-[13px] font-medium whitespace-nowrap overflow-hidden text-ellipsis max-w-[150px] tracking-wide">{file.name}</span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                closeTab(file.id);
              }}
              className="p-0.5 rounded transition-all duration-300 cursor-pointer shrink-0"
              style={{
                color: 'var(--text-muted)',
                opacity: 0,
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = 'var(--accent-red)';
                e.currentTarget.style.background = 'var(--bg-hover)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = 'var(--text-muted)';
                e.currentTarget.style.background = 'transparent';
              }}
              ref={(el) => {
                // Show close button on group hover via JS since we use inline styles
                const parent = el?.parentElement;
                if (parent) {
                  parent.addEventListener('mouseenter', () => el.style.opacity = '1');
                  parent.addEventListener('mouseleave', () => el.style.opacity = '0');
                }
              }}
              title="Close tab"
            >
              <X size={12} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
