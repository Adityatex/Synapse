export function getThemeClasses(theme) {
  return {
    bg: theme === 'dark' ? 'bg-[#0d1712]' : 'bg-slate-50',
    header: theme === 'dark' ? 'bg-[#111c17]' : 'bg-white',
    sidebar: theme === 'dark' ? 'bg-[#111c17]' : 'bg-slate-100',
    border: theme === 'dark' ? 'border-white/10' : 'border-slate-200',
    text: theme === 'dark' ? 'text-slate-300' : 'text-slate-600',
    textMuted: theme === 'dark' ? 'text-slate-500' : 'text-slate-400',
    tabActive: theme === 'dark' ? 'bg-[#0d1712] text-white' : 'bg-white text-slate-900',
    tabInactive: theme === 'dark' ? 'text-slate-500 hover:bg-white/5' : 'text-slate-400 hover:bg-slate-200',
    editorBg: theme === 'dark' ? 'bg-[#0d1712]' : 'bg-white',
    consoleHeader: theme === 'dark' ? 'bg-[#0d1712]' : 'bg-slate-200',
  };
}
