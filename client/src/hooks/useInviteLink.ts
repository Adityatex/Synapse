// P1-10: invite-link hook (copy + transient "copied" flag).
import { useCallback, useEffect, useRef, useState } from 'react';
import { copyText } from '../utils/clipboard';
import { createInviteLink } from '../services/roomService';
import { useRoomUiStore } from '../stores/roomUiStore';

export function useInviteLink(roomId: string) {
  const copied = useRoomUiStore((s) => s.copied);
  const setCopied = useRoomUiStore((s) => s.setCopied);
  const setError = useRoomUiStore((s) => s.setError);
  const [inviteError, setInviteError] = useState('');
  const timerRef = useRef<number | null>(null);

  const copyInvite = useCallback(async () => {
    const publicAppUrl = (import.meta.env.VITE_PUBLIC_APP_URL || window.location.origin).replace(/\/+$/, '');
    try {
      // Signed link: opening it makes the holder a room member (P0-16 guard).
      const { inviteToken } = await createInviteLink(roomId);
      const inviteLink = `${publicAppUrl}/room/${roomId}?invite=${encodeURIComponent(inviteToken)}`;
      const didCopy = await copyText(inviteLink);
      if (!didCopy) throw new Error('Copy failed');
      setCopied(true);
      setInviteError('');
      if (timerRef.current) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => setCopied(false), 1800);
    } catch (err) {
      const msg =
        err instanceof Error && err.message !== 'Copy failed'
          ? err.message
          : 'Could not copy the invite link from this browser.';
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
