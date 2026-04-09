import { io } from 'socket.io-client';
import { getToken } from './authService';

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:5000';

export function createCollaborationSocket() {
  return io(SOCKET_URL, {
    autoConnect: false,
    transports: ['websocket'],
    auth: {
      token: getToken(),
    },
  });
}
