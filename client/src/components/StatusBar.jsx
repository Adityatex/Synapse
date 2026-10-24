import { Lock, Users, Check } from 'lucide-react';
import { useFiles } from '../context/FileContext';
import { LANGUAGES, getLanguageByExtension } from '../utils/languageMap';

export default function StatusBar({ peersCount = 0, activeFileLock = null, currentUserId }) {
  const { activeFile } = useFiles();
  
  const currentLang = activeFile ? getLanguageByExtension(activeFile.name) : LANGUAGES[0];
  const isLockedByOther = Boolean(
    activeFileLock?.userId && activeFileLock.userId !== currentUserId
  );
  const lockLabel = activeFileLock
    ? isLockedByOther
      ? `Locked by ${activeFileLock.username || 'someone'}`
      : 'Edit lock held by you'
    : 'No file lock';

  return (
    <footer className="h-7 bg-surface-1 flex items-center justify-between px-4 text-[12px] text-ink-soft relative z-[60] shrink-0">
      <div className="flex items-center gap-5 h-full">
        <span className="flex items-center gap-1.5">
          <Users size={12} aria-hidden="true" />
          {peersCount} {peersCount === 1 ? 'person' : 'people'} here
        </span>
        <span className={`flex items-center gap-1.5 ${isLockedByOther ? 'text-accent-fg' : ''}`}>
          {activeFileLock ? <Lock size={12} aria-hidden="true" /> : <Check size={12} aria-hidden="true" />}
          {lockLabel}
        </span>
      </div>
      <span>
        {currentLang.name}
        {currentLang.version ? ` ${currentLang.version}` : ''}
      </span>
    </footer>
  );
}
