import { io } from 'socket.io-client';
import { getToken } from './authService';
import { SOCKET_URL } from '../config/apiConfig';

export function createCollaborationSocket() {
  return io(SOCKET_URL, {
    autoConnect: false,
    transports: ['websocket'],
    auth: {
      token: getToken(),
    },
  });
}
