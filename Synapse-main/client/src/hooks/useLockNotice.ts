// P1-10: lock-notice hook (auto-clearing toast message).
import { useCallback, useEffect, useRef } from 'react';
import { useRoomUiStore } from '../stores/roomUiStore';

export function useLockNotice(timeoutMs = 3500) {
  const lockNotice = useRoomUiStore((s) => s.lockNotice);
  const setLockNotice = useRoomUiStore((s) => s.setLockNotice);
  const timerRef = useRef<number | null>(null);

  const showLockNotice = useCallback(
    (message: string) => {
      setLockNotice(message);
      if (timerRef.current) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => setLockNotice(''), timeoutMs);
    },
    [setLockNotice, timeoutMs]
  );

  useEffect(
    () => () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    },
    []
  );

  return { lockNotice, showLockNotice };
}
