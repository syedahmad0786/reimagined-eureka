/**
 * Keeps the work in progress across a reload: which screen is open, the colours being checked, and
 * the photos taken so far. Photos are large, so each one is stored on its own in IndexedDB. Every
 * call is best effort: in private mode or with a full store the app still works, it just starts
 * from the home screen after a reload.
 */
import type { CubeData } from './model';

export interface Session {
  screen: 'capture' | 'corners' | 'review' | 'solve';
  /** Photos taken so far in a scan that is still going. */
  captureIndex?: number;
  /** The colours being checked, without the photos. */
  data?: Omit<CubeData, 'photos'>;
  hasPhotos?: boolean;
}

const NAME = 'cube6';
const STORE = 'kv';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest | null): Promise<T | undefined> {
  try {
    const db = await open();
    return await new Promise<T | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const request = work(tx.objectStore(STORE));
      tx.oncomplete = () => {
        db.close();
        resolve(request?.result as T | undefined);
      };
      tx.onabort = tx.onerror = () => {
        db.close();
        reject(tx.error);
      };
    });
  } catch {
    return undefined;
  }
}

export function saveSession(session: Session | null): Promise<unknown> {
  return run('readwrite', (s) => (session ? s.put(session, 'session') : s.delete('session')));
}

export async function loadSession(): Promise<Session | null> {
  return (await run<Session>('readonly', (s) => s.get('session'))) ?? null;
}

/** Store one item of a group (for example photo 3 of a scan), or remove it with null. */
export function saveItem(group: string, index: number, value: unknown): Promise<unknown> {
  return run('readwrite', (s) => (value === null ? s.delete(group + ':' + index) : s.put(value, group + ':' + index)));
}

export async function loadItems<T>(group: string, count: number): Promise<(T | null)[]> {
  const out: (T | null)[] = [];
  for (let i = 0; i < count; i++) out.push((await run<T>('readonly', (s) => s.get(group + ':' + i))) ?? null);
  return out;
}

export async function clearItems(group: string, count: number): Promise<void> {
  await run('readwrite', (s) => {
    for (let i = 0; i < count; i++) s.delete(group + ':' + i);
    return null;
  });
}
