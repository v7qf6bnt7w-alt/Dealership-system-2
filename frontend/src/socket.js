import { io } from 'socket.io-client';
import { getToken } from './api';

let socket = null;
const listeners = new Set();

export function initSocket() {
  const token = getToken();
  if (!token) {
    if (socket) {
      socket.disconnect();
      socket = null;
    }
    return null;
  }

  if (socket && socket.connected) {
    return socket;
  }

  // Connect to the Node realtime server on port 4000
  socket = io('http://127.0.0.1:4000', {
    auth: { token },
    transports: ['websocket', 'polling'],
    reconnectionDelay: 2000,
  });

  socket.on('connect', () => {
    console.log('[Socket] Connected to realtime hub on :4000');
  });

  socket.onAny((event, data) => {
    // Notify all registered UI listeners
    listeners.forEach((listener) => {
      try {
        listener(event, data);
      } catch (e) {
        console.error('Socket listener error:', e);
      }
    });
  });

  socket.on('disconnect', () => {
    console.log('[Socket] Disconnected from realtime hub');
  });

  return socket;
}

export function subscribeSocket(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}
