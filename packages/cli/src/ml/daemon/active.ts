import type { Socket } from 'bun';

let _conn: Socket | null = null;

export function setActiveConn(c: Socket | null) {
  _conn = c;
}

export function getActiveConn(): Socket | null {
  return _conn;
}
