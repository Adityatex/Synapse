// P1-10: RoomPage UI slice migrated from scattered useState to Zustand.
// High-frequency collaboration state (presence, yjs, file locks) stays local
// to RoomSession; this store owns session chrome: theme, output, connection,
// load/error flags, room name, invite-copy + lock notices.
import { create } from 'zustand';
import { readStorage, writeStorage } from '../utils/storage';

export interface OutputState {
  stdout: string;
  stderr: string;
  compile_output: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  status: any;
  error: string | null;
  running: boolean;
}

export const INITIAL_OUTPUT: OutputState = {
  stdout: '',
  stderr: '',
  compile_output: '',
  status: null,
  error: null,
  running: false,
};

interface RoomUiState {
  theme: string;
  toggleTheme: () => void;
  output: OutputState;
  setOutput: (next: OutputState | ((prev: OutputState) => OutputState)) => void;
  patchOutput: (patch: Partial<OutputState>) => void;
  connectionState: string;
  setConnectionState: (s: string) => void;
  loadingRoom: boolean;
  setLoadingRoom: (v: boolean) => void;
  roomReady: boolean;
  setRoomReady: (v: boolean) => void;
  error: string;
  setError: (msg: string) => void;
  roomName: string;
  setRoomName: (name: string) => void;
  copied: boolean;
  setCopied: (v: boolean) => void;
  lockNotice: string;
  setLockNotice: (msg: string) => void;
}

export const useRoomUiStore = create<RoomUiState>()((set) => ({
  theme: readStorage('synapse-theme') || 'dark',
  toggleTheme: () =>
    set((s) => {
      const next = s.theme === 'dark' ? 'light' : 'dark';
      writeStorage('synapse-theme', next);
      return { theme: next };
    }),
  output: INITIAL_OUTPUT,
  setOutput: (next) =>
    set((s) => ({
      output: typeof next === 'function' ? (next as (p: OutputState) => OutputState)(s.output) : next,
    })),
  patchOutput: (patch) => set((s) => ({ output: { ...s.output, ...patch } })),
  connectionState: 'connecting',
  setConnectionState: (connectionState) => set({ connectionState }),
  loadingRoom: true,
  setLoadingRoom: (loadingRoom) => set({ loadingRoom }),
  roomReady: false,
  setRoomReady: (roomReady) => set({ roomReady }),
  error: '',
  setError: (error) => set({ error }),
  roomName: '',
  setRoomName: (roomName) => set({ roomName }),
  copied: false,
  setCopied: (copied) => set({ copied }),
  lockNotice: '',
  setLockNotice: (lockNotice) => set({ lockNotice }),
}));
