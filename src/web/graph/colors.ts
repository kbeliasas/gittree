/** Colors in the lane palette (`--lane-0` … in styles.css). */
export const PALETTE_SIZE = 10;
/** The default branch always gets the first color; other lines never use it. */
export const DEFAULT_COLOR = 0;

/** A stable color for a branch line, from its name (FNV-1a), never the default branch's. */
export function colorFor(name: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < name.length; i++) {
    hash ^= name.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return 1 + ((hash >>> 0) % (PALETTE_SIZE - 1));
}
