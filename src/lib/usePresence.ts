import { useEffect, useRef, useState } from 'react';

export interface PresenceRow<T> {
  key: string;
  item: T;
  leaving: boolean;
}

interface LeavingEntry<T> {
  key: string;
  item: T;
  index: number;
}

interface PresenceState<T> {
  signature: string;
  items: readonly T[];
  leaving: LeavingEntry<T>[];
}

/**
 * Keeps removed rows mounted for one exit transition so a list collapses
 * instead of snapping. Entry animation is pure CSS (`@starting-style` on
 * `.reveal`); this hook only owns the leaving rows.
 *
 * Rows keep their position from the render they were removed in, and the
 * removal is computed during render so the row never disappears for a frame.
 */
export function usePresenceList<T>(
  items: readonly T[],
  keyOf: (item: T) => string,
  durationMs = 380,
): PresenceRow<T>[] {
  const keys = items.map(keyOf);
  const signature = keys.join('\u0000');
  const [state, setState] = useState<PresenceState<T>>(() => ({ signature, items, leaving: [] }));
  const timersRef = useRef(new Map<string, number>());

  let active = state;
  if (state.signature !== signature) {
    const survivors = new Set(keys);
    const removed: LeavingEntry<T>[] = [];
    state.items.forEach((item, index) => {
      const key = keyOf(item);
      if (!survivors.has(key)) removed.push({ key, item, index });
    });
    const leaving: LeavingEntry<T>[] = [];
    const seen = new Set<string>();
    for (const entry of [...state.leaving, ...removed]) {
      if (survivors.has(entry.key) || seen.has(entry.key)) continue;
      seen.add(entry.key);
      leaving.push(entry);
    }
    active = { signature, items, leaving };
    setState(active);
  }

  useEffect(() => {
    const timers = timersRef.current;
    for (const entry of active.leaving) {
      if (timers.has(entry.key)) continue;
      timers.set(entry.key, window.setTimeout(() => {
        timers.delete(entry.key);
        setState((current) => (current.leaving.some((item) => item.key === entry.key)
          ? { ...current, leaving: current.leaving.filter((item) => item.key !== entry.key) }
          : current));
      }, durationMs));
    }
    for (const key of [...timers.keys()]) {
      if (active.leaving.some((entry) => entry.key === key)) continue;
      window.clearTimeout(timers.get(key));
      timers.delete(key);
    }
  }, [active, durationMs]);

  useEffect(() => () => {
    for (const timer of timersRef.current.values()) window.clearTimeout(timer);
    timersRef.current.clear();
  }, []);

  const rows: PresenceRow<T>[] = items.map((item) => ({ key: keyOf(item), item, leaving: false }));
  const present = new Set(rows.map((row) => row.key));
  for (const entry of active.leaving) {
    if (present.has(entry.key)) continue;
    rows.splice(Math.min(entry.index, rows.length), 0, { key: entry.key, item: entry.item, leaving: true });
  }
  return rows;
}
