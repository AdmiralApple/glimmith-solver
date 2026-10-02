import { edgeKey, idx, normalizeShape } from "./geometry.js";
import { normalizePuzzle } from "./puzzle.js";

/**
 * Reader for The Artisan of Glimmith's puzzle files.
 *
 * The game stores every puzzle as a folder holding a plain-text `puzzle` file
 * and a small binary `metadata` file (title, description, author):
 *   - puzzles made in the in-game editor: %LOCALAPPDATA%\Geri\Saved\workshop\<id>\
 *   - subscribed Steam Workshop puzzles:  <Steam library>\steamapps\workshop\content\4160210\<id>\
 *
 * The `puzzle` text is a header of keyword lines followed by an ASCII grid of
 * 2 * height + 1 lines. Even lines hold corners ("+", or a Watchtower digit)
 * and 2-character horizontal borders; odd lines alternate a 1-character
 * vertical border with a cell token (usually 2 characters, longer for Compass).
 * An optional SOLUTION grid with the same layout marks the answer's walls.
 */

export const GAME_PUZZLE_PATHS = Object.freeze({
  local: "%LOCALAPPDATA%\\Geri\\Saved\\workshop",
  workshop: "<Steam library>\\steamapps\\workshop\\content\\4160210"
});

/** Header keywords with no parameters, and the editor rule each one turns on. */
const FLAG_RULES = Object.freeze({
  ALL_SHAPES_SAME: "match",
  ALL_SHAPES_DIFFERENT: "mismatch",
  ADJACENT_SHAPES_DIFFERENT: "mingle_shape",
  ADJACENT_SIZES_DIFFERENT: "size_separation",
  ONLY_RECTANGLES: "boxy",
  NO_RECTANGLES: "non_boxy",
  ONE_SYMBOL_PER_REGION: "solitude",
  NO_4_WAY_INTERSECTIONS: "bricky",
  NO_3_WAY_INTERSECTIONS: "loopy"
});

/** Palisade `F<n>` codes. Verified against the solutions of the game's own puzzles. */
const PALISADE_CODES = Object.freeze({
  0: "empty",
  1: "one_sided",
  2: "opposite",
  3: "three_sided",
  4: "full",
  7: "corner"
});

/** Rose Window `P<n>` clues become symbols A-E. */
const ROSE_SYMBOLS = "ABCDEFGHI";

/**
 * Parses the text of a game `puzzle` file.
 * @returns {{ puzzle: object, warnings: string[], difficulty: number|null, solutionWalls: Set<string>|null }}
 */
export function parseGamePuzzle(text, meta = {}) {
  const lines = String(text ?? "").replace(/\r/g, "").split("\n");
  const warnings = [];
  const rules = { area: 0 };
  const shapes = new Map();
  let shapeBankIds = [];
  let width = 0;
  let height = 0;
  let difficulty = null;
  let puzzleLine = -1;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!line) continue;
    if (line === "PUZZLE") {
      puzzleLine = i;
      break;
    }
    const [keyword, ...args] = line.split(/\s+/);
    const nums = args.map(Number);
    if (keyword === "VERSION" || keyword === "PUZZLE_VERSION" || keyword === "COMMENT") continue;
    if (keyword === "DIFFICULTY") difficulty = nums[0];
    else if (keyword === "DIMENSIONS") [width, height] = nums;
    else if (keyword === "AREA_EQUALS") rules.area = nums[0];
    else if (keyword === "AREA_AT_LEAST") rules.range = { ...rules.range, min: nums[0] };
    else if (keyword === "AREA_AT_MOST") rules.range = { ...rules.range, max: nums[0] };
    else if (keyword === "SHAPE_BANK") shapeBankIds = args;
    else if (keyword === "SHAPE") {
      const rows = lines.slice(i + 1, i + 1 + nums[1]);
      shapes.set(args[0], shapeCellsFromRows(rows));
      i += nums[1];
    } else if (FLAG_RULES[keyword]) rules[FLAG_RULES[keyword]] = {};
    else warnings.push(`Unknown rule "${line}" was skipped.`);
  }

  if (!(width > 0 && height > 0)) throw new Error("This doesn't look like a Glimmith puzzle file: no DIMENSIONS line.");
  if (puzzleLine < 0) throw new Error("This doesn't look like a Glimmith puzzle file: no PUZZLE grid.");

  const grid = readGrid(lines.slice(puzzleLine + 1), width, height);
  const activeCells = [];
  const symbols = {};
  const clues = [];
  const edgeConstraints = {};
  const unknownTokens = new Set();

  grid.cells.forEach((token, cell) => {
    if (token.trim() === "") return;
    activeCells.push(cell);
    const cellClue = cellClueFromToken(token, cell, shapes);
    if (cellClue === undefined) unknownTokens.add(token);
    else if (cellClue?.symbol) symbols[cell] = cellClue.symbol;
    else if (cellClue) clues.push(cellClue);
  });
  const active = new Set(activeCells);

  const addBorder = (a, b, token) => {
    if (!active.has(a) || !active.has(b)) return;
    const effect = borderEffectFromToken(token);
    if (effect === undefined) {
      unknownTokens.add(token);
      return;
    }
    if (!effect) return;
    // Every border effect in the game sits on a wall.
    edgeConstraints[edgeKey(a, b)] = { state: "cut", relation: null };
    if (effect.ruleId) clues.push(relationClue(effect, a, b));
  };
  for (let y = 0; y < height; y += 1) {
    for (let x = 1; x < width; x += 1) addBorder(idx(x - 1, y, width), idx(x, y, width), grid.vertical[y][x]);
  }
  for (let y = 1; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) addBorder(idx(x, y - 1, width), idx(x, y, width), grid.horizontal[y][x]);
  }
  for (let y = 0; y <= height; y += 1) {
    for (let x = 0; x <= width; x += 1) {
      const c = grid.corners[y][x];
      if (/^[1-4]$/.test(c)) {
        clues.push({ id: `watchtower:${x}:${y}`, type: "vertex", ruleId: "watchtower", location: { type: "vertex", x, y }, value: Number(c) });
      } else if (c !== "+" && c.trim() !== "") unknownTokens.add(c);
    }
  }
  if (unknownTokens.size) warnings.push(`Unrecognised grid marks were skipped: ${[...unknownTokens].map((t) => `"${t}"`).join(", ")}.`);

  // Rules implied by the clues that are present.
  for (const clue of clues) rules[clue.ruleId] = rules[clue.ruleId] ?? {};
  const roseDigits = [...new Set(Object.values(symbols))].sort();
  if (roseDigits.length) rules.roseLabels = roseDigits.join("");
  if (shapeBankIds.length) {
    const missing = shapeBankIds.filter((id) => !shapes.has(id));
    if (missing.length) warnings.push(`Shape bank refers to undefined shapes: ${missing.join(", ")}.`);
    rules.shapeBankText = shapeBankIds
      .filter((id) => shapes.has(id))
      .map((id) => `S${id}: ${shapes.get(id).map(([x, y]) => `${x},${y}`).join(" ")}`)
      .join("\n");
  }

  const solutionStart = lines.findIndex((line, i) => i > puzzleLine && line.trim() === "SOLUTION");
  const solutionWalls = solutionStart >= 0 ? wallsFromGrid(readGrid(lines.slice(solutionStart + 1), width, height), width, height) : null;

  const puzzle = normalizePuzzle({
    width,
    height,
    activeCells,
    symbols,
    clues,
    edgeConstraints,
    rules,
    metadata: {
      source: "The Artisan of Glimmith",
      ...(meta.title ? { title: meta.title } : {}),
      ...(meta.author ? { author: meta.author } : {}),
      ...(meta.id ? { gamePuzzleId: meta.id } : {}),
      ...(difficulty !== null ? { difficulty } : {})
    }
  });
  return { puzzle, warnings, difficulty, solutionWalls };
}

/**
 * Reads the binary `metadata` file next to a game puzzle: a version int, the
 * puzzle's 16-byte id, then length-prefixed title, description and author.
 * Returns null when the bytes don't fit that layout.
 */
export function parseGameMetadata(bytes) {
  try {
    const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    let offset = 4;
    // Unreal FGuid: four little-endian uint32s, printed in order; this matches the puzzle's folder name.
    const id = [0, 1, 2, 3].map((i) => view.getUint32(offset + i * 4, true).toString(16).padStart(8, "0")).join("").toUpperCase();
    offset += 16;
    const readString = () => {
      const length = view.getInt32(offset, true);
      offset += 4;
      if (length === 0) return "";
      if (length > 0) {
        if (length > 100000 || offset + length > data.length) throw new Error("bad string");
        const value = new TextDecoder("latin1").decode(data.slice(offset, offset + length - 1));
        offset += length;
        return value;
      }
      // Negative length: UTF-16 text of -length characters including the terminator.
      const chars = -length;
      if (chars > 100000 || offset + chars * 2 > data.length) throw new Error("bad string");
      const value = new TextDecoder("utf-16le").decode(data.slice(offset, offset + (chars - 1) * 2));
      offset += chars * 2;
      return value;
    };
    const title = readString();
    const description = readString();
    const author = readString();
    return { id, title, description, author };
  } catch {
    return null;
  }
}

function shapeCellsFromRows(rows) {
  const cells = [];
  rows.forEach((row, y) => {
    [...row].forEach((char, x) => {
      if (char === "#") cells.push([x, y]);
    });
  });
  return normalizeShape(cells);
}

/** Splits the ASCII grid into corner, border and cell tokens. Missing characters read as blank. */
function readGrid(lines, width, height) {
  const corners = [];
  const horizontal = [];
  const vertical = [];
  const cells = [];
  for (let row = 0; row <= 2 * height; row += 1) {
    const line = lines[row] ?? "";
    if (row % 2 === 0) {
      const y = row / 2;
      corners[y] = [];
      horizontal[y] = [];
      for (let x = 0; x <= width; x += 1) {
        corners[y][x] = line[3 * x] ?? " ";
        if (x < width) horizontal[y][x] = line.slice(3 * x + 1, 3 * x + 3).padEnd(2, " ");
      }
    } else {
      const y = (row - 1) / 2;
      vertical[y] = [];
      let pos = 0;
      for (let x = 0; x < width; x += 1) {
        vertical[y][x] = line[pos] ?? " ";
        pos += 1;
        // Compass tokens (U..D..L..R..) are wider than the usual 2 characters.
        const compass = line.slice(pos).match(/^U\d*D\d*L\d*R\d*/);
        const token = compass ? compass[0] : line.slice(pos, pos + 2).padEnd(2, " ");
        cells[y * width + x] = token;
        pos += token.length;
      }
      vertical[y][width] = line[pos] ?? " ";
    }
  }
  return { corners, horizontal, vertical, cells };
}

/** Returns a clue, `{ symbol }`, null for a plain cell, or undefined for an unknown token. */
function cellClueFromToken(token, cell, shapes) {
  const location = { type: "cell", cell };
  if (token === "..") return null;
  let match = token.match(/^(\d\d)$/);
  if (match) {
    const value = Number(match[1]);
    return { id: `area_number:${cell}`, type: "cell", ruleId: "area_number", location, value, params: { value } };
  }
  match = token.match(/^P(\d)$/);
  if (match) return { symbol: ROSE_SYMBOLS[Number(match[1]) - 1] ?? "A" };
  match = token.match(/^F(\d)$/);
  if (match && PALISADE_CODES[match[1]]) {
    return { id: `palisade:${cell}`, type: "cell", ruleId: "palisade", location, params: { pattern: PALISADE_CODES[match[1]] } };
  }
  match = token.match(/^S(\d+)$/);
  if (match && shapes.has(match[1])) {
    return {
      id: `polyomino:${cell}`,
      type: "cell",
      ruleId: "polyomino",
      location,
      params: { shape: shapes.get(match[1]), allowRotations: true, allowReflections: true }
    };
  }
  match = token.match(/^U(\d*)D(\d*)L(\d*)R(\d*)$/);
  if (match) {
    const params = {};
    [["N", match[1]], ["S", match[2]], ["W", match[3]], ["E", match[4]]].forEach(([direction, value]) => {
      if (value !== "") params[direction] = Number(value);
    });
    return { id: `compass:${cell}`, type: "cell", ruleId: "compass", location, params };
  }
  return undefined;
}

/**
 * Border tokens: vertical borders are 1 character, horizontal ones 2.
 * Returns a border effect, `{}` for a plain wall, null for no border, or undefined if unknown.
 * Inequality arrows point at the smaller region; "first" is the left/top cell.
 */
function borderEffectFromToken(raw) {
  const token = raw.trim();
  if (token === "" || token === "|" || token === "--" || token === "-" || token === "+") return null;
  if (token === "#" || token === "##") return {};
  if (token === "=" || token === "==") return { ruleId: "gemini" };
  if (token === "!" || token === "!!") return { ruleId: "delta" };
  if (token === "<" || token === "^^") return { ruleId: "inequality", direction: "lt" };
  if (token === ">" || token === "vv") return { ruleId: "inequality", direction: "gt" };
  const difference = token.match(/^-?(\d+)$/);
  if (difference) return { ruleId: "difference", value: Number(difference[1]) };
  return undefined;
}

function relationClue(effect, a, b) {
  const clue = {
    id: `relation:${effect.ruleId}:${edgeKey(a, b)}`,
    type: "relation",
    ruleId: effect.ruleId,
    location: { type: "edge", cells: [a, b] },
    regionRefs: [{ cell: a }, { cell: b }]
  };
  if (effect.ruleId === "difference") {
    clue.value = effect.value;
    clue.params = { difference: effect.value };
  }
  if (effect.ruleId === "inequality") clue.params = { direction: effect.direction };
  return clue;
}

/** Wall edge keys ("a-b") in a SOLUTION grid. */
function wallsFromGrid(grid, width, height) {
  const walls = new Set();
  for (let y = 0; y < height; y += 1) {
    for (let x = 1; x < width; x += 1) {
      if (grid.vertical[y][x] === "#") walls.add(edgeKey(idx(x - 1, y, width), idx(x, y, width)));
    }
  }
  for (let y = 1; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (grid.horizontal[y][x] === "##") walls.add(edgeKey(idx(x, y - 1, width), idx(x, y, width)));
    }
  }
  return walls;
}
