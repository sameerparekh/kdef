const KEY = 'kdef.lastPlayerId';
const CHANGED = 'kdef:last-player-changed';

function notify(): void {
  window.dispatchEvent(new Event(CHANGED));
}

/** For useSyncExternalStore: lets the nav react when the remembered player changes. */
export function subscribeLastPlayer(onChange: () => void): () => void {
  window.addEventListener(CHANGED, onChange);
  return () => window.removeEventListener(CHANGED, onChange);
}

/** Remembers who played last so the nav can link to their stats. Storage may be unavailable. */
export function getLastPlayerId(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

/** Forget the remembered player if it is the one given (e.g. they were just deleted). */
export function clearLastPlayerId(id: string): void {
  try {
    if (localStorage.getItem(KEY) === id) {
      localStorage.removeItem(KEY);
      notify();
    }
  } catch {
    /* storage unavailable */
  }
}

export function setLastPlayerId(id: string): void {
  try {
    localStorage.setItem(KEY, id);
    notify();
  } catch {
    /* storage unavailable; the nav just won't show the stats link */
  }
}
