import { edgeKey, idx, normalizeShape, parseEdgeKey } from "./geometry.js";
import { relationReferenceCells } from "./rules/relations.js";

export const EDGE_STATES = [null, "cut", "join"];
export const EDGE_RELATIONS = [null, "sameShape", "differentShape"];

const LEGACY_RULE_FIELDS = new Set([
  "area",
  "roseLabels",
  "shapeBankText",
  "allowRotations",
  "allowReflections",
  "shapeEquivalenceAllowRotations",
  "shapeEquivalenceAllowReflections"
]);

const RELATION_RULE_BY_EDGE_RELATION = {
  sameShape: "gemini",
  differentShape: "delta"
};

export function createPuzzle(width = 6, height = 6) {
  const size = width * height;
  return normalizePuzzle({
    version: 2,
    width,
    height,
    activeCells: Array.from({ length: size }, (_, index) => index),
    symbols: {},
    clues: [],
    edgeConstraints: {},
    rules: {
      area: 4,
      roseLabels: "",
      shapeBankText: "",
      allowRotations: true,
      allowReflections: true,
      shapeEquivalenceAllowRotations: true,
      shapeEquivalenceAllowReflections: true
    },
    shapeBank: {
      text: ""
    },
    metadata: {}
  });
}

export function clonePuzzle(puzzle) {
  return JSON.parse(JSON.stringify(puzzle));
}

export function normalizePuzzle(raw = {}) {
  const width = Math.max(1, Number(raw.width) || 1);
  const height = Math.max(1, Number(raw.height) || 1);
  const size = width * height;
  const activeCells = normalizeActiveCells(raw, size);
  const activeSet = new Set(activeCells);
  const active = Array.from({ length: size }, (_, index) => activeSet.has(index));
  const rules = normalizeRules(raw);
  const shapeBank = normalizeShapeBank(raw, rules);
  const symbols = normalizeSymbols(raw.symbols, size, activeSet);
  const edgeConstraints = normalizeEdgeConstraints(raw.edgeConstraints ?? raw.edges, size, activeSet);
  const clues = normalizeClues(raw.clues, size, activeSet);

  addLegacyRelationClues(clues, edgeConstraints);
  inferRelationRules(rules, clues);

  const puzzle = {
    version: 2,
    width,
    height,
    activeCells,
    active,
    symbols,
    clues,
    edgeConstraints,
    edges: edgeConstraints,
    rules,
    shapeBank,
    metadata: normalizeMetadata(raw.metadata)
  };

  return puzzle;
}

export function resizePuzzle(puzzle, width, height, { fillNew = false } = {}) {
  const next = createPuzzle(width, height);
  next.rules = { ...puzzle.rules };
  next.shapeBank = { ...puzzle.shapeBank };
  next.metadata = { ...puzzle.metadata };
  next.edgeConstraints = { ...puzzle.edgeConstraints };
  next.edges = next.edgeConstraints;
  next.clues = (puzzle.clues ?? []).map((clue) => ({ ...clue }));

  const minW = Math.min(puzzle.width, width);
  const minH = Math.min(puzzle.height, height);
  next.active.fill(Boolean(fillNew));
  for (let y = 0; y < minH; y += 1) {
    for (let x = 0; x < minW; x += 1) {
      const oldIndex = idx(x, y, puzzle.width);
      const newIndex = idx(x, y, width);
      next.active[newIndex] = puzzle.active[oldIndex];
      if (puzzle.symbols[oldIndex]) next.symbols[newIndex] = puzzle.symbols[oldIndex];
    }
  }
  next.activeCells = next.active.map((isActive, index) => (isActive ? index : -1)).filter((index) => index >= 0);
  return normalizePuzzle(next);
}

export function toggleCellActive(puzzle, index) {
  const next = clonePuzzle(puzzle);
  next.active[index] = !next.active[index];
  next.activeCells = next.active.map((isActive, cell) => (isActive ? cell : -1)).filter((cell) => cell >= 0);
  if (!next.active[index]) delete next.symbols[index];
  return normalizePuzzle(next);
}

export function cycleCellSymbol(puzzle, index, symbols = ["", "A", "B", "C", "D"]) {
  if (!puzzle.active[index]) return puzzle;
  const next = clonePuzzle(puzzle);
  const current = next.symbols[index] ?? "";
  const pos = symbols.indexOf(current);
  const value = symbols[(pos + 1 + symbols.length) % symbols.length];
  if (value) next.symbols[index] = value;
  else delete next.symbols[index];
  return normalizePuzzle(next);
}

export function setCellSymbol(puzzle, index, symbol) {
  if (!puzzle.active[index]) return puzzle;
  const next = clonePuzzle(puzzle);
  if (symbol && next.symbols[index] !== symbol) next.symbols[index] = symbol;
  else delete next.symbols[index];
  return normalizePuzzle(next);
}

export function setEdgeState(puzzle, a, b, state) {
  const next = clonePuzzle(puzzle);
  const key = edgeKey(a, b);
  const constraints = { ...(next.edgeConstraints ?? next.edges ?? {}) };
  const current = constraints[key] ?? { state: null, relation: null };
  current.state = state;
  if (!current.state && !current.relation) delete constraints[key];
  else constraints[key] = current;
  next.edgeConstraints = constraints;
  next.edges = constraints;
  return normalizePuzzle(next);
}

export function setEdgeRelation(puzzle, a, b, relation) {
  const next = clonePuzzle(puzzle);
  const key = edgeKey(a, b);
  const constraints = { ...(next.edgeConstraints ?? next.edges ?? {}) };
  const current = constraints[key] ?? { state: null, relation: null };
  current.relation = relation;
  if (!current.state && !current.relation) delete constraints[key];
  else constraints[key] = current;
  next.edgeConstraints = constraints;
  next.edges = constraints;
  return normalizePuzzle(next);
}

/** Border effects (relation clues such as Gemini, Delta, Difference, Inequality) on the border between a and b. */
export function borderEffectsOnEdge(puzzle, a, b) {
  const key = edgeKey(a, b);
  return (puzzle.clues ?? []).filter((clue) => {
    if (clue.type !== "relation") return false;
    const cells = relationReferenceCells(clue);
    return Boolean(cells) && edgeKey(cells[0], cells[1]) === key;
  });
}

/** Removes every border effect on the border between a and b. The wall itself is left alone. */
export function removeBorderEffects(puzzle, a, b) {
  const ids = new Set(borderEffectsOnEdge(puzzle, a, b).map((clue) => clue.id));
  const legacyRelation = (puzzle.edgeConstraints ?? puzzle.edges ?? {})[edgeKey(a, b)]?.relation;
  if (ids.size === 0 && !legacyRelation) return puzzle;
  const next = legacyRelation ? setEdgeRelation(puzzle, a, b, null) : puzzle;
  return normalizePuzzle({ ...next, clues: (next.clues ?? []).filter((clue) => !ids.has(clue.id)) });
}

/**
 * Places a border effect. A border holds at most one effect, so any existing
 * effect there is replaced, and a border with an effect is always a wall.
 */
export function placeBorderEffect(puzzle, clue) {
  const cells = relationReferenceCells(clue);
  if (!cells) return puzzle;
  const [a, b] = cells;
  const next = setEdgeState(removeBorderEffects(puzzle, a, b), a, b, "cut");
  const rules = { ...next.rules, [clue.ruleId]: next.rules[clue.ruleId] ?? {} };
  return normalizePuzzle({ ...next, rules, clues: [...(next.clues ?? []), clue] });
}

export function cycleEdgeConstraint(puzzle, a, b) {
  const key = edgeKey(a, b);
  const current = puzzle.edgeConstraints[key] ?? puzzle.edges[key] ?? { state: null, relation: null };
  const order = [
    { state: null, relation: null },
    { state: "cut", relation: null },
    { state: "join", relation: null },
    { state: null, relation: "sameShape" },
    { state: null, relation: "differentShape" }
  ];
  const index = order.findIndex((item) => item.state === current.state && item.relation === current.relation);
  const nextConstraint = order[(index + 1) % order.length];
  let next = setEdgeState(puzzle, a, b, nextConstraint.state);
  next = setEdgeRelation(next, a, b, nextConstraint.relation);
  return next;
}

export function parseShapeBank(text) {
  const shapes = [];
  const errors = [];
  const lines = String(text ?? "").split(/\r?\n/);
  for (let lineNo = 0; lineNo < lines.length; lineNo += 1) {
    let line = lines[lineNo].trim();
    if (!line || line.startsWith("#")) continue;
    line = line.replace(/;/g, " ");
    let name = `shape_${shapes.length + 1}`;
    let body = line;
    if (line.includes(":")) {
      const parts = line.split(":");
      name = parts.shift().trim() || name;
      body = parts.join(":").trim();
    }
    const coords = body.split(/\s+/).filter(Boolean);
    const cells = [];
    let valid = true;
    for (const coord of coords) {
      const match = coord.match(/^(-?\d+),(-?\d+)$/);
      if (!match) {
        errors.push(`Line ${lineNo + 1}: invalid coordinate "${coord}". Use x,y such as 0,0.`);
        valid = false;
        break;
      }
      cells.push([Number(match[1]), Number(match[2])]);
    }
    if (!valid) continue;
    if (cells.length === 0) {
      errors.push(`Line ${lineNo + 1}: shape has no cells.`);
      continue;
    }
    const normalized = normalizeShape(cells);
    shapes.push({ name, cells: normalized });
  }
  return { shapes, errors };
}

function normalizeActiveCells(raw, size) {
  if (Array.isArray(raw.activeCells)) {
    return uniqueSortedIndexes(raw.activeCells, size);
  }
  if (Array.isArray(raw.active)) {
    return raw.active.map((isActive, index) => (isActive !== false && index < size ? index : -1)).filter((index) => index >= 0);
  }
  return Array.from({ length: size }, (_, index) => index);
}

function normalizeSymbols(rawSymbols, size, activeSet) {
  const symbols = {};
  for (const [key, value] of Object.entries(rawSymbols ?? {})) {
    const index = Number(key);
    const symbol = String(value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (Number.isInteger(index) && index >= 0 && index < size && activeSet.has(index) && symbol) {
      symbols[index] = symbol.slice(0, 3);
    }
  }
  return symbols;
}

function normalizeRules(raw) {
  const incoming = raw.rules ?? {};
  const rules = {};

  for (const [key, value] of Object.entries(incoming)) {
    if (!LEGACY_RULE_FIELDS.has(key)) {
      rules[key] = value && typeof value === "object" ? clonePlain(value) : value;
    }
  }

  const area = Math.max(0, Number(hasOwn(incoming, "area") ? incoming.area : incoming.precision?.area) || 0);
  const roseCounts = normalizeRequiredSymbolCounts(
    hasOwn(incoming, "roseLabels")
      ? countsFromRoseLabels(incoming.roseLabels)
      : incoming.rose_window?.requiredSymbolCounts ?? incoming.rose_window?.requiredCounts
  );
  const roseLabels = normalizeRoseLabels(incoming.roseLabels, roseCounts);
  const allowRotations = hasOwn(incoming, "allowRotations")
    ? incoming.allowRotations
    : incoming.shape_bank?.allowRotations ?? raw.shapeBank?.allowRotations;
  const allowReflections = hasOwn(incoming, "allowReflections")
    ? incoming.allowReflections
    : incoming.shape_bank?.allowReflections ?? raw.shapeBank?.allowReflections;
  const shapeEquivalenceAllowRotations =
    hasOwn(incoming, "shapeEquivalenceAllowRotations")
      ? incoming.shapeEquivalenceAllowRotations
      : incoming.shape_bank?.shapeEquivalenceAllowRotations ?? raw.shapeBank?.shapeEquivalenceAllowRotations;
  const shapeEquivalenceAllowReflections =
    hasOwn(incoming, "shapeEquivalenceAllowReflections")
      ? incoming.shapeEquivalenceAllowReflections
      : incoming.shape_bank?.shapeEquivalenceAllowReflections ?? raw.shapeBank?.shapeEquivalenceAllowReflections;
  const shapeBankText = hasOwn(incoming, "shapeBankText")
    ? incoming.shapeBankText
    : raw.shapeBank?.text ?? incoming.shape_bank?.text;

  rules.area = area;
  rules.roseLabels = roseLabels;
  rules.shapeBankText = String(shapeBankText ?? "");
  rules.allowRotations = allowRotations !== false;
  rules.allowReflections = allowReflections !== false;
  rules.shapeEquivalenceAllowRotations = shapeEquivalenceAllowRotations !== false;
  rules.shapeEquivalenceAllowReflections = shapeEquivalenceAllowReflections !== false;

  if (area > 0) {
    rules.precision = {
      ...(rules.precision ?? {}),
      area
    };
  } else {
    delete rules.precision;
  }

  const requiredSymbolCounts = Object.keys(roseCounts).length > 0 ? roseCounts : countsFromRoseLabels(roseLabels);
  if (Object.keys(requiredSymbolCounts).length > 0) {
    rules.rose_window = {
      ...(rules.rose_window ?? {}),
      requiredSymbolCounts
    };
  } else {
    delete rules.rose_window;
  }

  return rules;
}

function normalizeShapeBank(raw, rules) {
  const incoming = raw.shapeBank ?? raw.rules?.shape_bank ?? {};
  const text = hasOwn(raw.rules, "shapeBankText") ? rules.shapeBankText : incoming.text ?? rules.shapeBankText;
  const entries = normalizeShapeBankEntries(incoming.entries);
  const shapeBank = {
    text: String(text ?? ""),
    entries,
    allowRotations: hasOwn(raw.rules, "allowRotations") ? rules.allowRotations : incoming.allowRotations ?? rules.allowRotations,
    allowReflections: hasOwn(raw.rules, "allowReflections") ? rules.allowReflections : incoming.allowReflections ?? rules.allowReflections,
    shapeEquivalenceAllowRotations: hasOwn(raw.rules, "shapeEquivalenceAllowRotations")
      ? rules.shapeEquivalenceAllowRotations
      : incoming.shapeEquivalenceAllowRotations ?? rules.shapeEquivalenceAllowRotations,
    shapeEquivalenceAllowReflections: hasOwn(raw.rules, "shapeEquivalenceAllowReflections")
      ? rules.shapeEquivalenceAllowReflections
      : incoming.shapeEquivalenceAllowReflections ?? rules.shapeEquivalenceAllowReflections
  };

  if (incoming.exactUses !== undefined) shapeBank.exactUses = Number(incoming.exactUses);
  if (incoming.maxUses !== undefined) shapeBank.maxUses = Number(incoming.maxUses);

  if (shapeBank.text || shapeBank.entries.length > 0) {
    rules.shape_bank = {
      ...(rules.shape_bank ?? {}),
      text: shapeBank.text,
      entries: shapeBank.entries,
      allowRotations: shapeBank.allowRotations,
      allowReflections: shapeBank.allowReflections,
      shapeEquivalenceAllowRotations: shapeBank.shapeEquivalenceAllowRotations,
      shapeEquivalenceAllowReflections: shapeBank.shapeEquivalenceAllowReflections
    };
    if (shapeBank.exactUses !== undefined) rules.shape_bank.exactUses = shapeBank.exactUses;
    if (shapeBank.maxUses !== undefined) rules.shape_bank.maxUses = shapeBank.maxUses;
  } else {
    delete rules.shape_bank;
  }

  return shapeBank;
}

function normalizeEdgeConstraints(rawEdges, size, activeSet) {
  const edgeConstraints = {};
  for (const [key, value] of Object.entries(rawEdges ?? {})) {
    const [a, b] = parseEdgeKey(key);
    if (!Number.isInteger(a) || !Number.isInteger(b)) continue;
    if (a < 0 || b < 0 || a >= size || b >= size) continue;
    if (!activeSet.has(a) || !activeSet.has(b)) continue;
    const state = value?.state === "join" || value?.state === "cut" ? value.state : null;
    const relation = value?.relation === "sameShape" || value?.relation === "differentShape" ? value.relation : null;
    if (state || relation) edgeConstraints[edgeKey(a, b)] = { state, relation };
  }
  return edgeConstraints;
}

function normalizeClues(rawClues, size, activeSet) {
  if (!Array.isArray(rawClues)) return [];
  const clues = [];
  for (let index = 0; index < rawClues.length; index += 1) {
    const rawClue = rawClues[index] ?? {};
    const clue = {
      id: String(rawClue.id ?? `clue_${index + 1}`),
      type: String(rawClue.type ?? rawClue.kind ?? "cell"),
      ruleId: rawClue.ruleId ? String(rawClue.ruleId) : undefined,
      location: normalizeLocation(rawClue.location, size, activeSet),
      params: clonePlain(rawClue.params ?? {})
    };
    if (rawClue.value !== undefined) clue.value = rawClue.value;
    if (rawClue.group !== undefined) clue.group = String(rawClue.group);
    if (Array.isArray(rawClue.regionRefs ?? rawClue.regions)) {
      clue.regionRefs = (rawClue.regionRefs ?? rawClue.regions).map((ref) =>
        typeof ref === "object" ? { ...ref, cell: Number(ref.cell) } : { cell: Number(ref) }
      );
    }
    if (Array.isArray(rawClue.cells)) clue.cells = rawClue.cells.map(Number);
    clues.push(clue);
  }
  return clues;
}

function normalizeLocation(location, size, activeSet) {
  if (!location || typeof location !== "object") return undefined;
  const type = String(location.type ?? "cell");
  const out = { type };
  if (Number.isInteger(Number(location.cell))) out.cell = Number(location.cell);
  if (Array.isArray(location.cells)) out.cells = location.cells.map(Number);
  if (Number.isInteger(Number(location.x))) out.x = Number(location.x);
  if (Number.isInteger(Number(location.y))) out.y = Number(location.y);
  if (location.side !== undefined) out.side = String(location.side);
  if (out.cell !== undefined && (out.cell < 0 || out.cell >= size || !activeSet.has(out.cell))) return out;
  return out;
}

function addLegacyRelationClues(clues, edgeConstraints) {
  const existingIds = new Set(clues.map((clue) => clue.id));
  for (const [key, constraint] of Object.entries(edgeConstraints)) {
    const ruleId = RELATION_RULE_BY_EDGE_RELATION[constraint.relation];
    if (!ruleId) continue;
    const [a, b] = parseEdgeKey(key);
    const id = `edge:${key}:${ruleId}`;
    if (existingIds.has(id)) continue;
    clues.push({
      id,
      type: "relation",
      ruleId,
      location: { type: "edge", cells: [a, b] },
      regionRefs: [{ cell: a }, { cell: b }],
      source: "edgeConstraints"
    });
    existingIds.add(id);
  }
}

function inferRelationRules(rules, clues) {
  for (const clue of clues) {
    if (!clue.ruleId) continue;
    if (rules[clue.ruleId] === undefined) rules[clue.ruleId] = {};
  }
}

function normalizeMetadata(metadata) {
  return metadata && typeof metadata === "object" ? clonePlain(metadata) : {};
}

function normalizeShapeBankEntries(entries) {
  if (!Array.isArray(entries)) return [];
  const out = [];
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index] ?? {};
    if (!Array.isArray(entry.cells)) continue;
    const cells = entry.cells
      .map((cell) => (Array.isArray(cell) ? [Number(cell[0]), Number(cell[1])] : null))
      .filter((cell) => cell && Number.isInteger(cell[0]) && Number.isInteger(cell[1]));
    if (cells.length === 0) continue;
    const normalized = {
      name: String(entry.name ?? `shape_${index + 1}`),
      cells: normalizeShape(cells)
    };
    if (entry.exactUses !== undefined) normalized.exactUses = Number(entry.exactUses);
    if (entry.maxUses !== undefined) normalized.maxUses = Number(entry.maxUses);
    out.push(normalized);
  }
  return out;
}

function normalizeRequiredSymbolCounts(value) {
  const counts = {};
  if (!value || typeof value !== "object") return counts;
  for (const [rawSymbol, rawCount] of Object.entries(value)) {
    const symbol = String(rawSymbol ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    const count = Number(rawCount);
    if (symbol && Number.isInteger(count) && count > 0) counts[symbol] = count;
  }
  return counts;
}

function normalizeRoseLabels(value, counts) {
  const text = String(value ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  if (text) return text;
  return Object.keys(counts).join("");
}

function countsFromRoseLabels(labels) {
  const counts = {};
  for (const label of new Set(String(labels ?? "").split("").filter(Boolean))) {
    counts[label] = 1;
  }
  return counts;
}

function uniqueSortedIndexes(indexes, size) {
  const out = new Set();
  for (const value of indexes) {
    const index = Number(value);
    if (Number.isInteger(index) && index >= 0 && index < size) out.add(index);
  }
  return [...out].sort((a, b) => a - b);
}

function clonePlain(value) {
  return JSON.parse(JSON.stringify(value ?? {}));
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object ?? {}, key);
}

export const TETROMINO_PRESET = `# Tetromino shape bank. Rotations are controlled by the checkbox.
I4: 0,0 1,0 2,0 3,0
O4: 0,0 1,0 0,1 1,1
L4: 0,0 0,1 0,2 1,2
T4: 0,0 1,0 2,0 1,1
S4: 1,0 2,0 0,1 1,1`;
