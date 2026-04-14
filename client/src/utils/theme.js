export function getThemeClasses(theme) {
  return {
    bg: theme === 'dark' ? 'bg-[#0d1117]' : 'bg-slate-50',
    header: theme === 'dark' ? 'bg-[#161b22]' : 'bg-white',
    sidebar: theme === 'dark' ? 'bg-[#161b22]' : 'bg-slate-100',
    border: theme === 'dark' ? 'border-white/10' : 'border-slate-200',
    text: theme === 'dark' ? 'text-slate-300' : 'text-slate-600',
    textMuted: theme === 'dark' ? 'text-slate-500' : 'text-slate-400',
    tabActive: theme === 'dark' ? 'bg-[#0d1117] text-white' : 'bg-white text-slate-900',
    tabInactive: theme === 'dark' ? 'text-slate-500 hover:bg-white/5' : 'text-slate-400 hover:bg-slate-200',
    editorBg: theme === 'dark' ? 'bg-[#0d1117]' : 'bg-white',
    consoleHeader: theme === 'dark' ? 'bg-[#0d1117]' : 'bg-slate-200',
  };
}
