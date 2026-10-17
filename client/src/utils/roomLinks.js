// Turn what someone pasted — an invite link or a bare room code — into the
// route to open. Returns null when it is neither.
export function parseRoomTarget(raw) {
  const pasted = String(raw || '').trim();
  if (!pasted) return null;
  const link = pasted.match(/\/room\/([A-Za-z0-9]+)(\?[^#\s]*)?/);
  if (link && /[?&]invite=/.test(link[2] || '')) {
    const roomId = link[1].toUpperCase();
    return { roomId, path: `/room/${roomId}${link[2]}`, hasInvite: true };
  }
  const code = (link ? link[1] : pasted).toUpperCase();
  if (!/^[A-Z0-9]{4,12}$/.test(code)) return null;
  return { roomId: code, path: `/room/${code}`, hasInvite: false };
}
