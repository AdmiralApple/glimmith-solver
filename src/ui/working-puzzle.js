import { normalizePuzzle } from "../core/puzzle.js";

/** localStorage key for the puzzle currently on the board, restored on reload. */
export const WORKING_PUZZLE_KEY = "glimmith.workingPuzzle.v1";

/**
 * Writes the current puzzle. Returns false when storage is unavailable or full;
 * the in-memory editor keeps working either way.
 */
export function saveWorkingPuzzle(puzzle, storage = globalThis.localStorage, key = WORKING_PUZZLE_KEY) {
  try {
    storage?.setItem(key, JSON.stringify(puzzle));
    return true;
  } catch {
    return false;
  }
}

/** Returns the stored puzzle, normalized, or null when there is none or it is unreadable. */
export function loadWorkingPuzzle(storage = globalThis.localStorage, key = WORKING_PUZZLE_KEY) {
  try {
    const raw = storage?.getItem(key);
    if (!raw) return null;
    const puzzle = normalizePuzzle(JSON.parse(raw));
    return puzzle.width > 0 && puzzle.height > 0 ? puzzle : null;
  } catch {
    return null;
  }
}

export function clearWorkingPuzzle(storage = globalThis.localStorage, key = WORKING_PUZZLE_KEY) {
  try {
    storage?.removeItem(key);
  } catch {
    // Storage may be unavailable in private contexts.
  }
}
