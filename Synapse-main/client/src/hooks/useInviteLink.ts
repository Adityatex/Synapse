// P1-10: invite-link hook (copy + transient "copied" flag).
import { useCallback, useEffect, useRef, useState } from 'react';
import { copyText } from '../utils/clipboard';
import { useRoomUiStore } from '../stores/roomUiStore';

export function useInviteLink(roomId: string) {
  const copied = useRoomUiStore((s) => s.copied);
  const setCopied = useRoomUiStore((s) => s.setCopied);
  const setError = useRoomUiStore((s) => s.setError);
  const [inviteError, setInviteError] = useState('');
  const timerRef = useRef<number | null>(null);

  const copyInvite = useCallback(async () => {
    const publicAppUrl = (import.meta.env.VITE_PUBLIC_APP_URL || window.location.origin).replace(/\/+$/, '');
    const inviteLink = `${publicAppUrl}/room/${roomId}`;
    try {
      const didCopy = await copyText(inviteLink);
      if (!didCopy) throw new Error('Copy failed');
      setCopied(true);
      setInviteError('');
      if (timerRef.current) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => setCopied(false), 1800);
    } catch {
      const msg = 'Could not copy the invite link from this browser.';
      setInviteError(msg);
      setError(msg);
    }
  }, [roomId, setCopied, setError]);

  useEffect(
    () => () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    },
    []
  );

  return { copied, copyInvite, inviteError };
}
