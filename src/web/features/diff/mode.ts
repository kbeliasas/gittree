import { useState } from 'react';

export type DiffMode = 'split' | 'unified';

const KEY = 'gittree.diffMode';

/** PLAN §14: split on wide screens, unified on narrow ones; a choice made with the toggle is remembered. */
export function useDiffMode(): [DiffMode, (mode: DiffMode) => void] {
  const [mode, setMode] = useState<DiffMode>(() => stored() ?? (window.matchMedia?.('(min-width: 1280px)').matches ? 'split' : 'unified'));
  const update = (next: DiffMode) => {
    setMode(next);
    try {
      localStorage.setItem(KEY, next);
    } catch {
      // storage unavailable (private window, blocked): the choice lasts until reload
    }
  };
  return [mode, update];
}

function stored(): DiffMode | null {
  try {
    const value = localStorage.getItem(KEY);
    return value === 'split' || value === 'unified' ? value : null;
  } catch {
    return null;
  }
}
