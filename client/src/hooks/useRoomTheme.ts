// P1-10: theme hook backed by the room UI store (persisted).
import { useRoomUiStore } from '../stores/roomUiStore';

export function useRoomTheme() {
  const theme = useRoomUiStore((s) => s.theme);
  const toggleTheme = useRoomUiStore((s) => s.toggleTheme);
  return { theme, toggleTheme };
}
