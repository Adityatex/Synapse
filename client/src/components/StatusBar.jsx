import { Lock, Users, Check } from 'lucide-react';
import { useFiles } from '../contexts/FileContext';
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
    <footer className="h-6 bg-indigo-600 flex items-center justify-between px-3 text-[10px] text-white font-medium shadow-2xl relative z-[60] shrink-0">
      <div className="flex items-center gap-4 h-full">
        <div className="flex items-center gap-1 hover:bg-white/10 px-2 h-full cursor-pointer transition-colors">
          <Lock size={10} />
          <span>Secure Tunnel</span>
        </div>
        <div className="flex items-center gap-1 hover:bg-white/10 px-2 h-full cursor-pointer transition-colors">
          <Users size={10} />
          <span>{peersCount} Peer{peersCount !== 1 ? 's' : ''} Online</span>
        </div>
        <div className="flex items-center gap-1 hover:bg-white/10 px-2 h-full cursor-pointer transition-colors">
          <Check size={10} />
          <span>{lockLabel}</span>
        </div>
      </div>
      <div className="flex items-center gap-4 h-full">
        <span className="font-mono">{currentLang.name} v{currentLang.version || '3.10'}</span>
        <span className="font-mono">Ln 1, Col 1</span>
        <div className="flex items-center gap-1.5 px-2 py-0.5 bg-emerald-500/20 rounded-sm">
          <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          <span className="font-bold uppercase tracking-wider text-[9px]">Live Sync Active</span>
        </div>
      </div>
    </footer>
  );
}
