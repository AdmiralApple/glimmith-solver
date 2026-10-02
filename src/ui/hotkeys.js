import { edgeKey, idx } from "../core/geometry.js";
import { removeBorderEffects, setEdgeState } from "../core/puzzle.js";

/**
 * Hotkeys that mirror the in-game editor. Keys act on whatever is under the
 * mouse pointer (a vertex, a border between two cells, or a cell).
 */

export const HOTKEY_HELP = Object.freeze([
  ["Drag between corners", "Given borders (cut)"],
  ["Right-click", "Toggle cell"],
  ["W, then 1-5", "Rose Window symbol A-E"],
  ["D / G", "Delta / Gemini on hovered border"],
  ["P", "Polyomino (uses the drawn clue shape)"],
  ["#, then 0-4", "Palisade (press 2 again for opposite)"],
  ["0-9 over a cell", "Area Number (type two digits for 10+)"],
  ["Arrow keys over a border", "Inequality (arrow points at the smaller region)"],
  ["0-9 over a border", "Difference"],
  ["1-4 over a corner", "Watchtower"],
  ["X, then 0-9", "Compass (side nearest the pointer)"],
  ["Delete", "Remove clue under the pointer"],
  ["Esc", "Cancel W / # / X mode"]
]);

const MODE_KEYS = Object.freeze({ w: "rose", "#": "palisade", x: "compass" });
const MODE_DIGITS = Object.freeze({ rose: [1, 5], palisade: [0, 4], compass: [0, 9] });
const ROSE_SYMBOLS = ["A", "B", "C", "D", "E"];
const PALISADE_BY_COUNT = ["empty", "one_sided", "corner", "three_sided", "full"];

/** Distance from a grid corner, as a fraction of a tile, that selects the corner instead of a tile. */
export const CORNER_HOVER_FRACTION = 0.2;

/**
 * Finds what the board point is over: vertex first, then a border between two
 * active cells, then a cell. Returns null outside the board.
 */
export function locateBoardPoint(point, puzzle, options = {}) {
  const cellSize = options.cellSize ?? 46;
  const pad = options.pad ?? 10;
  const vertexThreshold = options.vertexThreshold ?? CORNER_HOVER_FRACTION * cellSize;
  const edgeThreshold = options.edgeThreshold ?? 8;
  const bx = Number(point?.x) - pad;
  const by = Number(point?.y) - pad;
  if (!Number.isFinite(bx) || !Number.isFinite(by)) return null;

  const vx = Math.round(bx / cellSize) + 0;
  const vy = Math.round(by / cellSize) + 0;
  if (vx >= 0 && vy >= 0 && vx <= puzzle.width && vy <= puzzle.height
    && Math.hypot(bx - vx * cellSize, by - vy * cellSize) <= vertexThreshold) {
    return { type: "vertex", x: vx, y: vy };
  }

  const x = Math.floor(bx / cellSize);
  const y = Math.floor(by / cellSize);
  if (x < 0 || y < 0 || x >= puzzle.width || y >= puzzle.height) return null;
  const cell = idx(x, y, puzzle.width);
  const localX = bx - x * cellSize;
  const localY = by - y * cellSize;

  const sides = [
    { side: "N", dist: localY, dx: 0, dy: -1 },
    { side: "S", dist: cellSize - localY, dx: 0, dy: 1 },
    { side: "W", dist: localX, dx: -1, dy: 0 },
    { side: "E", dist: cellSize - localX, dx: 1, dy: 0 }
  ].sort((a, b) => a.dist - b.dist);
  const nearest = sides[0];

  if (nearest.dist <= edgeThreshold && puzzle.active[cell]) {
    const nx = x + nearest.dx;
    const ny = y + nearest.dy;
    if (nx >= 0 && ny >= 0 && nx < puzzle.width && ny < puzzle.height) {
      const other = idx(nx, ny, puzzle.width);
      if (puzzle.active[other]) {
        const [a, b] = cell < other ? [cell, other] : [other, cell];
        return { type: "edge", a, b, cell, side: nearest.side };
      }
    }
  }
  return { type: "cell", cell, side: nearest.side };
}

/**
 * Corners the pointer enters while moving in a straight line from one board
 * point to another, in order. The path is sampled finely so a fast mouse move
 * does not skip a corner's hover radius.
 */
export function cornersCrossed(from, to, puzzle, options = {}) {
  const step = options.step ?? 3;
  const distance = Math.hypot(to.x - from.x, to.y - from.y);
  const samples = Math.max(1, Math.ceil(distance / step));
  const corners = [];
  for (let i = 1; i <= samples; i += 1) {
    const t = i / samples;
    const hit = locateBoardPoint({ x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t }, puzzle, options);
    if (hit?.type !== "vertex") continue;
    const last = corners[corners.length - 1];
    if (!last || last.x !== hit.x || last.y !== hit.y) corners.push({ x: hit.x, y: hit.y });
  }
  return corners;
}

/**
 * Applies one step of a wall stroke between two corners. The first real border
 * a stroke touches fixes its mode: starting on a wall erases, otherwise draws.
 * Returns the updated puzzle, the stroke mode, and whether anything changed.
 */
export function applyWallSegment(puzzle, from, to, mode = null) {
  let next = puzzle;
  let changed = false;
  for (const [a, b] of dragBorderEdges(from, to, puzzle)) {
    const isWall = next.edges?.[edgeKey(a, b)]?.state === "cut";
    if (!mode) mode = isWall ? "erase" : "draw";
    if (mode === "draw" && !isWall) {
      next = setEdgeState(next, a, b, "cut");
      changed = true;
    } else if (mode === "erase" && isWall) {
      // A border effect lives on its wall, so it goes with it.
      next = removeBorderEffects(setEdgeState(next, a, b, null), a, b);
      changed = true;
    }
  }
  return { puzzle: next, mode, changed };
}

/**
 * Edge pairs crossed by a straight drag between two vertices. Returns [] when
 * the drag is not axis-aligned. Only borders between two active cells count.
 */
export function dragBorderEdges(start, end, puzzle) {
  if (!start || !end) return [];
  const horizontal = start.y === end.y && start.x !== end.x;
  const vertical = start.x === end.x && start.y !== end.y;
  if (!horizontal && !vertical) return [];
  const pairs = [];
  if (horizontal) {
    const y = start.y;
    for (let x = Math.min(start.x, end.x); x < Math.max(start.x, end.x); x += 1) {
      pairs.push([y - 1, x, y, x]);
    }
  } else {
    const x = start.x;
    for (let y = Math.min(start.y, end.y); y < Math.max(start.y, end.y); y += 1) {
      pairs.push([y, x - 1, y, x]);
    }
  }
  const edges = [];
  for (const [y1, x1, y2, x2] of pairs) {
    if (x1 < 0 || y1 < 0 || x2 >= puzzle.width || y2 >= puzzle.height) continue;
    const a = idx(x1, y1, puzzle.width);
    const b = idx(x2, y2, puzzle.width);
    if (puzzle.active[a] && puzzle.active[b]) edges.push([a, b]);
  }
  return edges;
}

/**
 * Maps a key press to an editor action, or null if the key is not a hotkey here.
 * @param {string} key KeyboardEvent.key
 * @param {{target: object|null, mode: string|null, width: number, currentPalisade?: string}} context
 */
export function resolveHotkey(key, { target, mode = null, width, currentPalisade = null }) {
  const lower = key.length === 1 ? key.toLowerCase() : key;

  if (key === "Escape") return { type: "clearMode" };
  if (MODE_KEYS[lower]) return { type: "setMode", mode: MODE_KEYS[lower] };

  if (key === "Delete" || key === "Backspace") {
    return target ? { type: "delete", target } : null;
  }

  if (lower === "d" || lower === "g") {
    const ruleId = lower === "d" ? "delta" : "gemini";
    if (target?.type === "edge") return { type: "relation", ruleId, a: target.a, b: target.b };
    return { type: "selectRelation", ruleId };
  }

  if (lower === "p") return { type: "polyomino", cell: target?.type === "cell" ? target.cell : null };

  if (key.startsWith("Arrow")) {
    if (target?.type !== "edge") return null;
    const horizontalEdge = target.b - target.a === 1;
    const towardFirst = horizontalEdge ? key === "ArrowLeft" : key === "ArrowUp";
    const towardSecond = horizontalEdge ? key === "ArrowRight" : key === "ArrowDown";
    if (!towardFirst && !towardSecond) return null;
    return { type: "inequality", a: target.a, b: target.b, direction: towardFirst ? "lt" : "gt" };
  }

  if (/^[0-9]$/.test(key)) {
    const digit = Number(key);
    if (mode) {
      const [min, max] = MODE_DIGITS[mode];
      if (digit < min || digit > max || target?.type !== "cell" && target?.type !== "edge") return null;
      const cell = target.cell;
      if (mode === "rose") return { type: "rose", cell, symbol: ROSE_SYMBOLS[digit - 1] };
      if (mode === "compass") return { type: "compass", cell, side: target.side, value: digit };
      if (digit === 2 && currentPalisade === "corner") return { type: "palisade", cell, pattern: "opposite" };
      return { type: "palisade", cell, pattern: PALISADE_BY_COUNT[digit] };
    }
    if (target?.type === "vertex") {
      return digit >= 1 && digit <= 4 ? { type: "watchtower", vertex: { x: target.x, y: target.y }, value: digit } : null;
    }
    if (target?.type === "edge") return { type: "difference", a: target.a, b: target.b, value: digit };
    if (target?.type === "cell") return { type: "areaNumber", cell: target.cell, digit };
  }
  return null;
}
