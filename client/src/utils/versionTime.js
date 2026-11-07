// How a version's time is shown in the history (P2-15): the clock time, with the day when it is not
// today, and how long ago it was.

const clock = (date) => date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** "10:42 AM", "Yesterday 4:05 PM", or "Oct 28, 4:05 PM". */
export function versionTime(iso, now = new Date()) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  if (sameDay(date, now)) return clock(date);
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(date, yesterday)) return `Yesterday ${clock(date)}`;
  return `${date.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${clock(date)}`;
}

/** "just now", "3 min ago", "2 h ago", "5 days ago". */
export function timeAgo(iso, now = Date.now()) {
  const ms = now - new Date(iso).getTime();
  if (Number.isNaN(ms)) return '';
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  return `${days} ${days === 1 ? 'day' : 'days'} ago`;
}
