/** Boards above this many cells (the old 14x14 cap) may make the solver slow. */
export const LARGE_BOARD_CELLS = 14 * 14;

/** Boards above this many cells may make the editor itself sluggish. */
export const HUGE_BOARD_CELLS = 50 * 50;

/** Parses a width/height field: a whole number of at least 1, or the fallback. */
export function parseBoardDimension(value, fallback) {
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) && parsed >= 1 ? parsed : fallback;
}

/** Returns a short warning for large boards, or "" when the size is comfortable. */
export function boardSizeWarning(width, height) {
  const cells = width * height;
  if (cells > HUGE_BOARD_CELLS) {
    return `${width}×${height} is very large (${cells} cells). The editor may become sluggish, and Solve is unlikely to finish.`;
  }
  if (cells > LARGE_BOARD_CELLS) {
    return `${width}×${height} is a large board (${cells} cells). Solve and Next step may be slow or hit the search limit.`;
  }
  return "";
}
