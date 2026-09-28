const KEY = 'kdef.lastPlayerId';

/** Remembers who played last so the nav can link to their stats. Storage may be unavailable. */
export function getLastPlayerId(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function setLastPlayerId(id: string): void {
  try {
    localStorage.setItem(KEY, id);
  } catch {
    /* storage unavailable; the nav just won't show the stats link */
  }
}
