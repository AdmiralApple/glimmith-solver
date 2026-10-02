import { createConstraintModel } from "./constraints.js";
import { canonicalShapeKey, edgeKey, idx, maskFromIndexes, normalizeShape, shapeCellsFromIndexes, shapeTransforms, xy } from "./geometry.js";
import { palisadePatternFromSides } from "./boundary.js";
import { normalizePuzzle, parseShapeBank } from "./puzzle.js";
import { addRuleConstraints, applyCandidateFilters, createRuleContext } from "./rules/registry.js";
import { edgeConstraintsRule } from "./rules/edge-constraints.js";
import { candidateShapeForComparison, shapeComparisonOptions } from "./shape-comparison.js";

/**
 * Border solver.
 *
 * Works on the borders between adjacent active cells instead of a list of pre-enumerated regions,
 * so it handles puzzles whose regions are too large or too unconstrained to list (a Range minimum
 * with no maximum, Polyomino clues that cover only some regions, no size rule at all).
 *
 * Every border is UNKNOWN, OPEN (same region) or WALL; regions are the groups of cells joined by
 * OPEN borders. `propagate` applies sound deductions until nothing changes. The search guesses one
 * border at a time and learns from dead ends: each forced border records the literals that forced
 * it, a contradiction is traced back through those reasons to a short "nogood" (a set of border
 * values that cannot all hold), the nogood is enforced from then on, and the search jumps back to
 * where it first matters, as in CDCL SAT solvers.
 *
 * Finished regions are checked with the rule modules' own candidate filters, pair constraints and
 * selection validators, so rule meanings stay identical to the candidate solver in solver.js.
 */

const UNKNOWN = 0;
const OPEN = 1;
const WALL = 2;

/** Area Number clues up to this size get an explicit list of possible regions. */
const AREA_DOMAIN_MAX = 7;
const DOMAIN_PLACEMENT_LIMIT = 20000;

/** A literal is "border e has value v", packed as an integer. */
function literalOf(edge, value) {
  return edge * 2 + (value === WALL ? 1 : 0);
}

function literalValue(literal) {
  return literal & 1 ? WALL : OPEN;
}

/**
 * Solves a puzzle with the border solver.
 * @param {object} rawPuzzle
 * @param {{ limit?: number, maxNodes?: number, maxMillis?: number, rootProbe?: boolean }} options
 *   limit: solutions to look for (2 proves uniqueness); maxNodes / maxMillis: search budget;
 *   rootProbe: try every border both ways before searching (default true).
 */
export function solveByBorders(rawPuzzle, options = {}) {
  const puzzle = normalizePuzzle(rawPuzzle);
  const limit = Math.max(1, options.limit ?? 2);
  const model = buildModel(puzzle);
  const result = {
    status: "no_solution",
    solutions: [],
    errors: [...model.errors],
    candidates: [],
    candidatePlan: { kind: "borders", ruleId: null, errors: [] },
    nodeCount: 0,
    truncated: false
  };
  if (model.failed) return result;

  const solutions = [];
  const run = learningSearch(model, { ...options, limit }, solutions);

  if (solutions.length === 0) result.status = run.limitHit ? "search_limit" : "no_solution";
  else if (run.limitHit) result.status = "search_limit";
  else if (limit === 1) result.status = "solution_found";
  else if (solutions.length > 1) result.status = "multiple_solutions";
  else result.status = "unique_solution";
  result.solutions = solutions;
  result.nodeCount = run.nodes;
  result.truncated = run.limitHit || solutions.length >= limit;
  if (run.limitHit) result.errors.push(run.timedOut ? "The border solver hit its time limit." : "The border solver hit its step limit.");
  return result;
}

/**
 * Borders the solver can prove without guessing: by propagation, or because assuming the opposite
 * propagates to a contradiction ("probing"). Only borders not already set in the puzzle are listed.
 * @returns {{ ok: boolean, forced: { a: number, b: number, state: "join"|"cut", how: "propagation"|"probing" }[] }}
 */
export function forcedBorders(rawPuzzle, { probe: doProbe = true } = {}) {
  const puzzle = normalizePuzzle(rawPuzzle);
  const model = buildModel(puzzle);
  if (model.failed) return { ok: false, forced: [] };
  const state = model.initialState.slice();
  const domains = model.domains.map((domain) => domain.placements.map((_, i) => i));
  if (!propagate(model, state, domains)) return { ok: false, forced: [] };
  const byPropagation = state.slice();
  if (doProbe && !probe(model, state, domains)) return { ok: false, forced: [] };
  const forced = [];
  for (let e = 0; e < state.length; e += 1) {
    if (state[e] === UNKNOWN || model.initialState[e] !== UNKNOWN) continue;
    forced.push({
      a: model.edgeA[e],
      b: model.edgeB[e],
      state: state[e] === OPEN ? "join" : "cut",
      how: byPropagation[e] === state[e] ? "propagation" : "probing"
    });
  }
  // Propagation steps read more simply than probing steps, so list them first.
  forced.sort((x, y) => (x.how === y.how ? 0 : x.how === "propagation" ? -1 : 1));
  return { ok: true, forced };
}

/**
 * Search with conflict learning (see the file comment). Returns the number of steps and whether
 * the step or time budget ran out.
 */
function learningSearch(model, options, solutions) {
  const limit = options.limit;
  const maxNodes = Math.max(1, options.maxNodes ?? 250000);
  const deadline = Number.isFinite(options.maxMillis) ? Date.now() + options.maxMillis : Infinity;
  const rootState = model.initialState.slice();
  const rootDomains = model.domains.map((domain) => domain.placements.map((_, i) => i));
  const rootOutcome = options.rootProbe === false ? propagate(model, rootState, rootDomains) : probe(model, rootState, rootDomains);
  let nodes = 0;
  if (!rootOutcome) return { nodes, limitHit: false };

  // levels[0] is the root; levels[i] holds the state after guess i, its propagation and its trail.
  const levels = [{ state: rootState, domains: rootDomains, outcome: rootOutcome, literal: -1, trail: null }];

  const addNogood = (literals, decision = false) => {
    if (decision) {
      // A guess-only nogood exists to flip the latest guess; drop older ones it makes redundant.
      model.nogoods = model.nogoods.filter(
        (existing) => !(existing.decision && existing.literals.length > literals.length && literals.every((literal, i) => existing.literals[i] === literal))
      );
    }
    model.nogoods.push({ literals: Int32Array.from(literals), w1: 0, w2: literals.length > 1 ? 1 : 0, decision });
    for (const literal of literals) model.activity[literal >> 1] += model.activityIncrement;
    model.activityIncrement *= 1.05;
    if (model.activityIncrement > 1e100) {
      for (let e = 0; e < model.activity.length; e += 1) model.activity[e] *= 1e-100;
      model.activityIncrement *= 1e-100;
    }
  };
  const guessesUpTo = (count) => levels.slice(1, count + 1).map((level) => level.literal);

  // Jump back to level `keep` and re-propagate it with the newly learned nogoods. If that level is a
  // dead end too, learn "not all of its guesses" and keep going up.
  const reassert = (keep) => {
    for (;;) {
      levels.length = keep + 1;
      const level = levels[keep];
      const state = level.state.slice();
      const domains = level.domains.slice();
      const trail = level.trail ? [...level.trail] : null;
      model.trail = trail;
      const outcome = propagate(model, state, domains);
      model.trail = null;
      if (outcome) {
        levels[keep] = { ...level, state, domains, outcome, trail };
        return true;
      }
      if (keep === 0) return false;
      addNogood(guessesUpTo(keep), true);
      keep -= 1;
    }
  };

  let conflictsSinceRestart = 0;
  let restartIndex = 1;
  const restartBase = options.restartBase ?? 64;
  for (;;) {
    nodes += 1;
    if (nodes > maxNodes) return { nodes, limitHit: true };
    if ((nodes & 31) === 0 && Date.now() > deadline) return { nodes, limitHit: true, timedOut: true };

    // Luby restarts keep everything learned and let the guess order adapt to it.
    if (conflictsSinceRestart >= restartBase * luby(restartIndex)) {
      conflictsSinceRestart = 0;
      restartIndex += 1;
      if (!reassert(0)) return { nodes, limitHit: false };
    }

    const top = levels[levels.length - 1];
    const literal = chooseLiteral(model, top.state, top.domains, top.outcome);
    if (literal === null) {
      const solution = finalSolution(model, top.state);
      if (solution) {
        solutions.push(solution);
        if (solutions.length >= limit) return { nodes, limitHit: false };
      }
      // The guesses determine the whole state, so blocking them excludes exactly this outcome.
      const guesses = guessesUpTo(levels.length - 1);
      if (guesses.length === 0) return { nodes, limitHit: false };
      addNogood(guesses, true);
      if (!reassert(levels.length - 2)) return { nodes, limitHit: false };
      continue;
    }

    const state = top.state.slice();
    const domains = top.domains.slice();
    state[literal >> 1] = literalValue(literal);
    const trail = [{ e: literal >> 1, reason: null, decision: true }];
    model.trail = trail;
    const outcome = propagate(model, state, domains);
    model.trail = null;
    model.phase[literal >> 1] = literalValue(literal);
    if (outcome) {
      levels.push({ state, domains, outcome, literal, trail });
      continue;
    }

    // Dead end: trace it back to a short nogood and jump back to where it first applies.
    conflictsSinceRestart += 1;
    const pendingLevel = levels.length;
    const levelOf = (lit) => {
      const e = lit >> 1;
      for (let i = 0; i < levels.length; i += 1) if (levels[i].state[e] !== UNKNOWN) return i;
      return pendingLevel;
    };
    const guesses = [...guessesUpTo(levels.length - 1), literal];
    const learned = analyzeConflict(model.explanation ?? guesses, trail, levelOf, pendingLevel, guesses);
    if (learned.length === 0) return { nodes, limitHit: false };
    addNogood(learned);
    const depths = learned.map(levelOf).sort((a, b) => b - a);
    if (depths[0] < pendingLevel) {
      // Already contradictory at an earlier level: that level is the dead end.
      if (depths[0] === 0) return { nodes, limitHit: false };
      levels.length = depths[0] + 1;
      addNogood(guessesUpTo(depths[0]), true);
      if (!reassert(depths[0] - 1)) return { nodes, limitHit: false };
      continue;
    }
    if (!reassert(depths.length > 1 ? depths[1] : 0)) return { nodes, limitHit: false };
  }
}

function luby(i) {
  for (let k = 1; ; k += 1) {
    if (i === (1 << k) - 1) return 1 << (k - 1);
    if (i >= 1 << (k - 1) && i < (1 << k) - 1) return luby(i - (1 << (k - 1)) + 1);
  }
}

/**
 * First-UIP conflict analysis. Starting from the literals behind the contradiction, replace the
 * most recently forced literal of the current level by its reason until only one literal of the
 * current level is left. Root-level literals are facts and are dropped. Borders without a precise
 * reason fall back to "all guesses so far", which is always sound.
 */
function analyzeConflict(conflict, trail, levelOf, currentLevel, guesses) {
  const position = new Map();
  trail.forEach((entry, i) => position.set(entry.e, i));
  const learned = new Map();
  const add = (literal) => {
    if (levelOf(literal) === 0) return;
    learned.set(literal >> 1, literal);
  };
  conflict.forEach(add);
  for (let guard = 0; guard < 100000; guard += 1) {
    let latest = -1;
    let latestPosition = -1;
    let atCurrent = 0;
    for (const literal of learned.values()) {
      if (levelOf(literal) !== currentLevel) continue;
      atCurrent += 1;
      const p = position.has(literal >> 1) ? position.get(literal >> 1) : trail.length;
      if (p > latestPosition) {
        latestPosition = p;
        latest = literal;
      }
    }
    if (atCurrent <= 1) break;
    const entry = latestPosition < trail.length ? trail[latestPosition] : null;
    if (entry?.decision) break;
    learned.delete(latest >> 1);
    const reason = entry && entry.reason !== undefined ? entry.reason : guesses;
    reason.forEach(add);
  }
  return [...learned.values()];
}

/** The next guess as a single literal (border = value), or null when every border is decided. */
function chooseLiteral(model, state, domains, outcome) {
  // Borders that keep showing up in conflicts first (with their last value), as in SAT solvers.
  let best = -1;
  let bestActivity = 0;
  for (let e = 0; e < state.length; e += 1) {
    if (state[e] !== UNKNOWN) continue;
    if (model.activity[e] > bestActivity) {
      bestActivity = model.activity[e];
      best = e;
    }
  }
  if (best >= 0) return literalOf(best, model.phase[best] || OPEN);
  // Before any conflict: the clue with the fewest placements, else grow the tightest region.
  const branch = chooseBranch(model, state, domains, outcome);
  if (!branch) return null;
  for (const [edge, value] of branch[0]) {
    if (state[edge] === UNKNOWN) return literalOf(edge, value);
  }
  for (let e = 0; e < state.length; e += 1) if (state[e] === UNKNOWN) return literalOf(e, OPEN);
  return null;
}

// ---------------------------------------------------------------------------
// Model: borders, clues and static per-clue placement lists.

function buildModel(puzzle) {
  const { width, height } = puzzle;
  const n = width * height;
  const errors = [];
  const edgeA = [];
  const edgeB = [];
  const edgeByKey = new Map();
  const cellEdges = Array.from({ length: n }, () => []);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const a = idx(x, y, width);
      if (!puzzle.active[a]) continue;
      for (const [nx, ny] of [[x + 1, y], [x, y + 1]]) {
        if (nx >= width || ny >= height) continue;
        const b = idx(nx, ny, width);
        if (!puzzle.active[b]) continue;
        const e = edgeA.length;
        edgeA.push(a);
        edgeB.push(b);
        edgeByKey.set(edgeKey(a, b), e);
        cellEdges[a].push([e, b]);
        cellEdges[b].push([e, a]);
      }
    }
  }

  const context = createRuleContext(puzzle);
  const configs = context.ruleConfigs;
  const state = new Uint8Array(edgeA.length);
  let failed = false;
  const force = (a, b, value) => {
    const e = edgeByKey.get(edgeKey(a, b));
    if (e === undefined) return;
    if (state[e] !== UNKNOWN && state[e] !== value) failed = true;
    state[e] = value;
  };

  for (const [key, constraint] of Object.entries(puzzle.edgeConstraints ?? {})) {
    const [a, b] = key.split("-").map(Number);
    if (constraint.state === "cut" || constraint.relation) force(a, b, WALL);
    else if (constraint.state === "join") force(a, b, OPEN);
  }

  // Global size bounds.
  let minSize = 1;
  let maxSize = Infinity;
  if (configs.precision?.area > 0) {
    minSize = Math.max(minSize, configs.precision.area);
    maxSize = Math.min(maxSize, configs.precision.area);
  }
  if (configs.range) {
    const min = Number(configs.range.min);
    const max = Number(configs.range.max);
    if (Number.isInteger(min) && min > 0) minSize = Math.max(minSize, min);
    if (Number.isInteger(max) && max > 0) maxSize = Math.min(maxSize, max);
  }
  const bankShapes = configs.shape_bank ? parseShapeBank(puzzle.rules.shapeBankText ?? "").shapes : [];
  if (bankShapes.length) {
    const sizes = bankShapes.map((shape) => shape.cells.length);
    minSize = Math.max(minSize, Math.min(...sizes));
    maxSize = Math.min(maxSize, Math.max(...sizes));
  }

  // Cell clues.
  const areaAt = new Int32Array(n);
  const polyAt = Array(n).fill(null);
  const relationClues = [];
  const compassClues = [];
  const palisadeClues = [];
  const domains = [];
  for (const clue of puzzle.clues ?? []) {
    const cell = Number(clue.location?.cell);
    if (clue.ruleId === "area_number" && configs.area_number && Number.isInteger(cell)) {
      const value = Number(clue.value ?? clue.params?.value);
      if (areaAt[cell] && areaAt[cell] !== value) failed = true;
      areaAt[cell] = value;
    } else if (clue.ruleId === "polyomino" && configs.polyomino && Number.isInteger(cell)) {
      const shape = normalizeShape(clue.params?.shape ?? []);
      if (shape.length === 0) continue;
      const matchOptions = { allowRotations: clue.params?.allowRotations !== false, allowReflections: clue.params?.allowReflections !== false };
      polyAt[cell] = { size: shape.length, shape, matchOptions, looseKey: canonicalShapeKey(shape, { allowRotations: true, allowReflections: true }) };
      domains.push({ kind: "polyomino", anchor: cell, placements: shapePlacements(shape, matchOptions, cell) });
    } else if (clue.type === "relation" && configs[clue.ruleId]) {
      const cells = clue.location?.cells ?? (clue.regionRefs ?? []).map((ref) => ref.cell);
      const [a, b] = cells.map(Number);
      if (!Number.isInteger(a) || !Number.isInteger(b)) continue;
      force(a, b, WALL);
      relationClues.push({
        ruleId: clue.ruleId,
        a,
        b,
        value: Number(clue.value ?? clue.params?.difference),
        direction: clue.params?.direction ?? clue.direction
      });
    } else if (clue.ruleId === "compass" && configs.compass && Number.isInteger(cell)) {
      const expected = {};
      for (const d of ["N", "E", "S", "W"]) {
        const v = clue.params?.[d];
        if (v !== undefined && v !== null && v !== "") expected[d] = Number(v);
      }
      compassClues.push({ cell, expected });
    } else if (clue.ruleId === "palisade" && configs.palisade && Number.isInteger(cell)) {
      palisadeClues.push({ cell, pattern: clue.params?.pattern });
    }
  }
  // A Gemini partner of a region with a known shape has that shape too (and chains onward).
  const exactAt = new Int32Array(n);
  if (configs.gemini) {
    const shapeAt = new Map();
    for (const domain of domains) {
      if (domain.kind === "polyomino") shapeAt.set(domain.anchor, normalizeShape(shapeCellsFromIndexes([...domain.placements[0]?.cells ?? []], width)));
    }
    const geminis = relationClues.filter((relation) => relation.ruleId === "gemini");
    const comparison = shapeComparisonOptions(puzzle);
    for (let changedShape = true, rounds = 0; changedShape && rounds < 50; rounds += 1) {
      changedShape = false;
      for (const { a, b } of geminis) {
        for (const [from, to] of [[a, b], [b, a]]) {
          if (areaAt[from] && !exactAt[to]) {
            exactAt[to] = areaAt[from];
            changedShape = true;
          }
          if (exactAt[from] && !exactAt[to]) {
            exactAt[to] = exactAt[from];
            changedShape = true;
          }
          const shape = shapeAt.get(from);
          if (shape && shape.length && !shapeAt.has(to)) {
            shapeAt.set(to, shape);
            exactAt[to] = shape.length;
            domains.push({ kind: "gemini", anchor: to, placements: shapePlacements(shape, comparison, to) });
            changedShape = true;
          }
        }
      }
    }
  }

  for (let cell = 0; cell < n; cell += 1) {
    if (areaAt[cell] > 0 && areaAt[cell] <= AREA_DOMAIN_MAX) {
      const placements = connectedPlacements(cell, areaAt[cell]);
      if (placements) domains.push({ kind: "area_number", anchor: cell, placements });
    }
  }

  const domainAnchor = new Uint8Array(n);
  for (const domain of domains) domainAnchor[domain.anchor] = 1;
  // Clues whose region is not covered by a placement list (large Area Numbers, Polyomino clues with
  // no placements) make the cramped-cell deduction unsound, so it is switched off for them.
  let hasClueWithoutDomain = false;
  for (let cell = 0; cell < n; cell += 1) {
    if ((areaAt[cell] || polyAt[cell]) && !domainAnchor[cell]) hasClueWithoutDomain = true;
  }
  const model = {
    puzzle,
    domainAnchor,
    hasClueWithoutDomain,
    width,
    height,
    n,
    edgeA,
    edgeB,
    edgeByKey,
    cellEdges,
    context,
    minSize,
    maxSize,
    areaAt,
    exactAt,
    polyAt,
    relationClues,
    compassClues,
    palisadeClues,
    domains,
    derivedCache: new Map(),
    nogoods: [],
    activity: new Float64Array(edgeA.length),
    activityIncrement: 1,
    phase: new Uint8Array(edgeA.length),
    candidateCache: new Map(),
    agreedLists: new WeakSet(),
    listSummaries: new WeakMap(),
    scratchInside: new Int32Array(edgeA.length),
    scratchBoundary: new Int32Array(edgeA.length),
    regionCheckCache: new Map(),
    pairCheckCache: new Map(),
    shapeOptions: shapeComparisonOptions(puzzle),
    hasPairRules: Object.keys(configs).some((id) => ["gemini", "delta", "difference", "inequality", "size_separation", "mingle_shape", "match", "mismatch", "watchtower"].includes(id)),
    errors,
    failed,
    initialState: state
  };
  model.makePlacement = makePlacement;
  model.shapePlacements = shapePlacements;
  return model;

  function makePlacement(cells) {
    const sorted = [...cells].sort((p, q) => p - q);
    const inside = new Set(sorted);
    const internal = [];
    const boundary = [];
    for (const c of sorted) {
      for (const [e, other] of cellEdges[c]) {
        if (inside.has(other)) {
          if (c < other) internal.push(e);
        } else boundary.push(e);
      }
    }
    return {
      cells: Int32Array.from(sorted),
      internal: Int32Array.from(internal),
      boundary: Int32Array.from(boundary),
      key: sorted.join(","),
      mask: maskFromIndexes(sorted)
    };
  }

  /** Placements of a shape (under the given transforms) that cover `cell` and pass the static rule filters. */
  function shapePlacements(shape, transformOptions, cell) {
    const out = [];
    const seen = new Set();
    const target = xy(cell, width);
    for (const transformed of shapeTransforms(shape, transformOptions)) {
      for (const [dx, dy] of transformed) {
        const ox = target.x - dx;
        const oy = target.y - dy;
        const cells = [];
        let ok = true;
        for (const [sx, sy] of transformed) {
          const x = ox + sx;
          const y = oy + sy;
          if (x < 0 || y < 0 || x >= width || y >= height || !puzzle.active[idx(x, y, width)]) {
            ok = false;
            break;
          }
          cells.push(idx(x, y, width));
        }
        if (!ok) continue;
        const placement = makePlacement(cells);
        if (seen.has(placement.key)) continue;
        seen.add(placement.key);
        if (!staticallyValid(placement)) continue;
        out.push(placement);
      }
    }
    return out;
  }

  /**
   * All connected sets of `size` active cells containing `cell`, or null when there are too many.
   * Redelmeier-style growth: a frontier cell that was tried and backed out of is excluded from
   * the rest of that branch, so every set is produced exactly once.
   */
  function connectedPlacements(cell, size) {
    const out = [];
    const region = [cell];
    const inRegion = new Set(region);
    let overflow = false;
    grow(cellEdges[cell].map(([, other]) => other), new Set([cell]));
    return overflow ? null : out;

    function grow(untried, seen) {
      if (overflow) return;
      if (region.length === size) {
        const placement = makePlacement(region);
        if (staticallyValid(placement)) out.push(placement);
        if (out.length > DOMAIN_PLACEMENT_LIMIT) overflow = true;
        return;
      }
      const marked = new Set(seen);
      for (const c of untried) marked.add(c);
      for (let i = 0; i < untried.length; i += 1) {
        const next = untried[i];
        region.push(next);
        inRegion.add(next);
        const childUntried = untried.slice(i + 1);
        const childSeen = new Set(marked);
        for (const [, other] of cellEdges[next]) {
          if (!childSeen.has(other)) {
            childSeen.add(other);
            childUntried.push(other);
          }
        }
        grow(childUntried, childSeen);
        region.pop();
        inRegion.delete(next);
        if (overflow) return;
      }
    }
  }

  function staticallyValid(placement) {
    for (const e of placement.internal) if (state[e] === WALL) return false;
    for (const e of placement.boundary) if (state[e] === OPEN) return false;
    return applyCandidateFilters(regionCandidate(puzzle, placement.cells), context, [edgeConstraintsRule]);
  }
}

// ---------------------------------------------------------------------------
// Propagation

function propagate(model, state, domains) {
  const { n, edgeA, edgeB, cellEdges } = model;
  model.explanation = null;
  const blobOf = new Int32Array(n).fill(-1);
  const zoneOf = new Int32Array(n).fill(-1);
  const stack = new Int32Array(n);

  for (let guard = 0; guard < 10000; guard += 1) {
    let changed = false;
    // reason: literals (already true) that force this border, or undefined for "the guesses so far".
    const set = (e, value, reason) => {
      if (state[e] === value) return true;
      if (state[e] !== UNKNOWN) return false;
      // The reason is taken before the border is set, so it can never mention the border itself.
      if (model.trail) model.trail.push({ e, reason: typeof reason === "function" ? reason() : reason });
      state[e] = value;
      changed = true;
      return true;
    };

    if (model.nogoods.length) {
      for (const nogood of model.nogoods) {
        const literals = nogood.literals;
        if (literals.length === 1) {
          const only = literals[0];
          const current = state[only >> 1];
          if (current === literalValue(only)) {
            model.explanation = [only];
            return null;
          }
          if (current === UNKNOWN && !set(only >> 1, literalValue(only) === OPEN ? WALL : OPEN, [])) return null;
          continue;
        }
        // status: 0 unknown, 1 holds, 2 false
        const status = (literal) => {
          const current = state[literal >> 1];
          return current === UNKNOWN ? 0 : current === literalValue(literal) ? 1 : 2;
        };
        let s1 = status(literals[nogood.w1]);
        let s2 = status(literals[nogood.w2]);
        if (s1 === 2 || s2 === 2) continue;
        if (s1 === 1) {
          for (let k = 0; k < literals.length; k += 1) {
            if (k === nogood.w1 || k === nogood.w2) continue;
            if (status(literals[k]) !== 1) {
              nogood.w1 = k;
              s1 = status(literals[k]);
              break;
            }
          }
        }
        if (s2 === 1) {
          for (let k = 0; k < literals.length; k += 1) {
            if (k === nogood.w1 || k === nogood.w2) continue;
            if (status(literals[k]) !== 1) {
              nogood.w2 = k;
              s2 = status(literals[k]);
              break;
            }
          }
        }
        if (s1 === 2 || s2 === 2) continue;
        if (s1 === 1 && s2 === 1) {
          model.explanation = [...literals];
          return null;
        }
        if (s1 === 1 || s2 === 1) {
          const open = s1 === 1 ? literals[nogood.w2] : literals[nogood.w1];
          if (!set(open >> 1, literalValue(open) === OPEN ? WALL : OPEN, [...literals].filter((l) => l !== open))) return null;
        }
      }
      if (changed) continue;
    }

    // Groups of cells joined by OPEN borders ("blobs"), and the zones they could still grow into.
    const blobs = components(OPEN, blobOf);
    const zones = components(-WALL, zoneOf);
    // A wall cannot separate two cells of the same blob; an unknown border inside a blob is open.
    for (let e = 0; e < edgeA.length; e += 1) {
      if (blobOf[edgeA[e]] !== blobOf[edgeB[e]]) continue;
      if (state[e] === WALL) {
        // This wall plus an open path between its two cells.
        model.explanation = [literalOf(e, WALL), ...openPath(model, state, edgeA[e], edgeB[e]).map((p) => literalOf(p, OPEN))];
        return null;
      }
      if (state[e] === UNKNOWN) set(e, OPEN, () => openPath(model, state, edgeA[e], edgeB[e]).map((p) => literalOf(p, OPEN)));
    }
    if (changed) continue;

    // Per-blob facts: clues inside, size bounds, frontier.
    const info = blobs.map((cells) => blobInfo(model, cells));
    for (const item of info) if (item.invalid) return null;
    const closed = [];
    for (let b = 0; b < blobs.length; b += 1) {
      const frontier = [];
      for (const c of blobs[b]) for (const [e] of cellEdges[c]) if (state[e] === UNKNOWN) frontier.push(e);
      info[b].frontier = frontier;
      if (frontier.length === 0) closed.push(b);
    }

    // Finished regions: rule filters, then pair rules / validators among all finished regions.
    for (const b of closed) {
      if (!regionPasses(model, blobs[b])) {
        model.explanation = exactRegionLiterals(model, state, blobs[b]);
        return null;
      }
    }
    if (model.hasPairRules && closed.length > 1 && !closedRegionsCompatible(model, closed.map((b) => blobs[b]))) return null;

    // Relation clues: once one side's size or shape is known (finished region, or a region holding
    // an Area Number / Polyomino clue), bound the other side.
    const derivedDomains = [];
    const zoneSizeOf = (b) => zones[zoneOf[blobs[b][0]]].length;
    for (const relation of model.relationClues) {
      const ba = blobOf[relation.a];
      const bb = blobOf[relation.b];
      // Bounds that hold even while both regions are still growing: final size >= current size,
      // and <= the space the region can still reach.
      for (const [mine, other, iAmFirst] of [[ba, bb, true], [bb, ba, false]]) {
        const now = blobs[mine].length;
        const zoneLimited = zoneSizeOf(mine) < info[mine].upper;
        const most = Math.min(info[mine].upper, zoneSizeOf(mine));
        const target = info[other];
        // Why "mine" has at least `now` cells: its open spanning borders.
        const nowReason = () => spanningOpen(model, state, blobs[mine]).map((e) => literalOf(e, OPEN));
        // Why "mine" has at most `most` cells: the walls of its zone, or its own upper bound.
        const mineUpper = info[mine].upperReason;
        const mostReason = () =>
          zoneLimited
            ? zoneWalls(model, state, zones[zoneOf[blobs[mine][0]]]).map((e) => literalOf(e, WALL))
            : [...nowReason(), ...(mineUpper ? mineUpper() : [])];
        if (relation.ruleId === "gemini") {
          tighten(target, "lower", now, nowReason);
          tighten(target, "upper", most, mostReason);
        } else if (relation.ruleId === "difference" && Number.isInteger(relation.value)) {
          tighten(target, "lower", now - relation.value, nowReason);
          tighten(target, "upper", most + relation.value, mostReason);
        } else if (relation.ruleId === "inequality") {
          const otherMustBeLarger = (relation.direction === "lt") === iAmFirst;
          if (otherMustBeLarger) tighten(target, "lower", now + 1, nowReason);
          else tighten(target, "upper", most - 1, mostReason);
        }
      }
      for (const [mine, other, otherCell, iAmFirst] of [[ba, bb, relation.b, true], [bb, ba, relation.a, false]]) {
        const finished = info[mine].frontier.length === 0;
        const s = finished ? blobs[mine].length : info[mine].lower === info[mine].upper ? info[mine].lower : null;
        if (s === null) continue;
        const target = info[other];
        // Why "mine" has exactly s cells.
        const mineLower = info[mine].lowerReason;
        const mineUpperExact = info[mine].upperReason;
        const exactReason = () =>
          finished
            ? exactRegionLiterals(model, state, blobs[mine])
            : [
                ...spanningOpen(model, state, blobs[mine]).map((e) => literalOf(e, OPEN)),
                ...(mineLower ? mineLower() : []),
                ...(mineUpperExact ? mineUpperExact() : [])
              ];
        if (relation.ruleId === "gemini") {
          tighten(target, "lower", s, exactReason);
          tighten(target, "upper", s, exactReason);
          if (target.frontier.length === 0) continue;
          if (finished) derivedDomains.push({ anchor: otherCell, placements: geminiPlacements(model, blobs[mine], otherCell) });
          else if (info[mine].polyShape) derivedDomains.push({ anchor: otherCell, placements: geminiPlacementsForClue(model, info[mine].polyShape, otherCell) });
        } else if (relation.ruleId === "difference" && Number.isInteger(relation.value)) {
          const d = relation.value;
          tighten(target, "upper", s + d, exactReason);
          tighten(target, "lower", s - d >= 1 ? s - d : s + d, exactReason);
        } else if (relation.ruleId === "inequality") {
          // direction "lt" means region(a) < region(b).
          const otherMustBeLarger = (relation.direction === "lt") === iAmFirst;
          if (otherMustBeLarger) tighten(target, "lower", s + 1, exactReason);
          else tighten(target, "upper", s - 1, exactReason);
        }
      }
    }
    // Size bounds.
    const zoneSize = zones.map((cells) => cells.length);
    for (let b = 0; b < blobs.length; b += 1) {
      const item = info[b];
      const size = blobs[b].length;
      if (item.lower > item.upper) {
        model.explanation = dedupe([...spanningOpen(model, state, blobs[b]).map((e) => literalOf(e, OPEN)), ...boundReason(item, "lower"), ...boundReason(item, "upper")]);
        return null;
      }
      if (size > item.upper) {
        model.explanation = dedupe([...spanningOpen(model, state, blobs[b]).map((e) => literalOf(e, OPEN)), ...boundReason(item, "upper")]);
        return null;
      }
      if (zoneSize[zoneOf[blobs[b][0]]] < item.lower) {
        model.explanation = dedupe([
          ...zoneWalls(model, state, zones[zoneOf[blobs[b][0]]]).map((e) => literalOf(e, WALL)),
          ...spanningOpen(model, state, blobs[b]).map((e) => literalOf(e, OPEN)),
          ...boundReason(item, "lower")
        ]);
        return null;
      }
      if (size === item.upper && item.frontier.length) {
        const reason = dedupe([...spanningOpen(model, state, blobs[b]).map((e) => literalOf(e, OPEN)), ...boundReason(item, "upper")]);
        for (const e of item.frontier) if (!set(e, WALL, reason)) return null;
      }
    }
    if (changed) continue;

    // An area fenced off by walls that cannot hold two regions is one region: the largest region
    // it must contain plus any other region (at least minSize cells) would not fit.
    const largestNeed = new Map();
    for (let b = 0; b < blobs.length; b += 1) {
      const z = zoneOf[blobs[b][0]];
      if (info[b].lower > (largestNeed.get(z)?.lower ?? 0)) largestNeed.set(z, { lower: info[b].lower, b });
    }
    for (let z = 0; z < zones.length; z += 1) {
      const need = largestNeed.get(z);
      const largest = Math.max(need?.lower ?? 0, model.minSize);
      if (zones[z].length - largest >= model.minSize) continue;
      const inside = new Set(zones[z]);
      let reasonCache = null;
      const reason = () =>
        (reasonCache ??= dedupe([
          ...zoneWalls(model, state, zones[z]).map((e) => literalOf(e, WALL)),
          ...(need && need.lower > model.minSize
            ? [...spanningOpen(model, state, blobs[need.b]).map((e) => literalOf(e, OPEN)), ...boundReason(info[need.b], "lower")]
            : [])
        ]));
      for (const c of zones[z]) {
        for (const [e, other] of cellEdges[c]) {
          if (c > other || !inside.has(other)) continue;
          if (state[e] === WALL) {
            model.explanation = dedupe([literalOf(e, WALL), ...reason()]);
            return null;
          }
          if (state[e] === UNKNOWN && !set(e, OPEN, reason)) return null;
        }
      }
    }
    if (changed) continue;
    // Merging two blobs across an unknown border must keep them valid, and must not join the two
    // sides of a relation marker (they are always different regions).
    // apartFrom[b] lists the blobs that blob b may never join.
    const apartFrom = new Map();
    for (const relation of model.relationClues) {
      const x = blobOf[relation.a];
      const y = blobOf[relation.b];
      if (x === y) return null;
      if (!apartFrom.has(x)) apartFrom.set(x, []);
      if (!apartFrom.has(y)) apartFrom.set(y, []);
      apartFrom.get(x).push(y);
      apartFrom.get(y).push(x);
    }
    for (let e = 0; e < edgeA.length; e += 1) {
      if (state[e] !== UNKNOWN) continue;
      const bx = blobOf[edgeA[e]];
      const by = blobOf[edgeB[e]];
      if (apartFrom.get(bx)?.includes(by) || !canMerge(info[bx], info[by], blobs[bx].length + blobs[by].length)) {
        set(e, WALL, () =>
          dedupe([
            ...spanningOpen(model, state, blobs[bx]).map((p) => literalOf(p, OPEN)),
            ...spanningOpen(model, state, blobs[by]).map((p) => literalOf(p, OPEN)),
            ...boundReason(info[bx], "upper"),
            ...boundReason(info[by], "upper")
          ])
        );
      }
    }
    if (changed) continue;
    // Compass: own-region counts in each half-plane.
    for (const clue of model.compassClues) {
      const b = blobOf[clue.cell];
      const counts = halfPlaneCounts(model, blobs[b], clue.cell);
      const reach = halfPlaneCounts(model, zones[zoneOf[clue.cell]], clue.cell);
      for (const [d, expected] of Object.entries(clue.expected)) {
        if (counts[d] > expected) {
          // Open paths from the clue to expected + 1 own cells on that side.
          const extra = blobs[b].filter((c) => c !== clue.cell && inHalfPlane(model, c, clue.cell, d)).slice(0, expected + 1);
          const edges = new Set();
          for (const c of extra) for (const p of openPath(model, state, clue.cell, c)) edges.add(p);
          model.explanation = [...edges].map((e) => literalOf(e, OPEN));
          return null;
        }
        if (reach[d] < expected) {
          // The walls fencing the clue's reachable area.
          model.explanation = zoneWalls(model, state, zones[zoneOf[clue.cell]]).map((e) => literalOf(e, WALL));
          return null;
        }
        if (counts[d] === expected) {
          const reason = () => {
            const counted = blobs[b].filter((c) => c !== clue.cell && inHalfPlane(model, c, clue.cell, d));
            const edges = new Set(spanningOpen(model, state, blobs[b]));
            void counted;
            return [...edges].map((x) => literalOf(x, OPEN));
          };
          for (const e of info[b].frontier) {
            const outside = blobOf[edgeA[e]] === b ? edgeB[e] : edgeA[e];
            if (inHalfPlane(model, outside, clue.cell, d) && !set(e, WALL, reason)) return null;
          }
        }
      }
    }
    if (changed) continue;
    // Palisade: the four sides of the clue cell.
    for (const clue of model.palisadeClues) {
      if (!palisadePropagate(model, state, clue, set)) return null;
    }
    if (changed) continue;

    // Zone accounting: inside an area walled off from the rest, clued regions take their exact sizes;
    // the cells left over must be none, or enough for at least one more region.
    if (!zonesHaveRoom(model, zones, zoneOf, blobs, blobOf, info)) return null;

    // Clue placement lists: keep placements still consistent with the borders, force what they agree on.
    for (let d = 0; d < domains.length; d += 1) {
      const list = model.domains[d].placements;
      const current = domains[d];
      let valid = null;
      for (let k = 0; k < current.length; k += 1) {
        const fits = placementFits(state, list[current[k]]);
        if (!fits && !valid) valid = current.slice(0, k);
        else if (fits && valid) valid.push(current[k]);
      }
      if (valid) {
        if (valid.length === 0) {
          model.explanation = killingLiterals(state, list) ?? null;
          return null;
        }
        domains[d] = valid;
      }
    }
    // Two clue regions that cannot be the same region cannot share a cell: a cell every placement of
    // one clue uses is unavailable to the other.
    if (!excludeOverlaps(model, domains)) return null;
    // Every cell needs a region. A region with no placement-listed clue needs at least minSize cells;
    // a cell too cramped for that must belong to a clue region, and if only one clue can reach it,
    // that clue's region takes it.
    const coverage = coverCrampedCells(model, state, domains, blobs, blobOf, info);
    if (coverage === null) return null;
    if (coverage) changed = true;
    for (let d = 0; d < domains.length; d += 1) {
      // A list already agreed on in an ancestor state has nothing new to force.
      if (model.agreedLists.has(domains[d])) continue;
      const list = model.domains[d].placements;
      const kept = new Set(domains[d]);
      let memo = null;
      const reason = () => (memo ??= { value: killingLiterals(state, list.filter((_, i) => !kept.has(i))) }).value;
      if (!forceAgreement(model, state, domains[d].map((i) => list[i]), set, reason)) return null;
      model.agreedLists.add(domains[d]);
    }
    if (changed) continue;
    for (const derived of derivedDomains) {
      const valid = derived.placements.filter((placement) => placementFits(state, placement));
      if (valid.length === 0) return null;
      derived.valid = valid;
      if (!forceAgreement(model, state, valid, set)) return null;
    }
    if (changed) continue;

    return { blobs, info, blobOf, derivedDomains };
  }
  return null;

  function components(kind, out) {
    // kind OPEN: join through OPEN borders. kind -WALL: join through any border that is not a wall.
    out.fill(-1);
    const groups = [];
    for (let start = 0; start < n; start += 1) {
      if (!model.puzzle.active[start] || out[start] >= 0) continue;
      const id = groups.length;
      const cells = [];
      let top = 0;
      stack[top++] = start;
      out[start] = id;
      while (top > 0) {
        const c = stack[--top];
        cells.push(c);
        for (const [e, other] of cellEdges[c]) {
          if (out[other] >= 0) continue;
          const s = state[e];
          if (kind === OPEN ? s === OPEN : s !== WALL) {
            out[other] = id;
            stack[top++] = other;
          }
        }
      }
      groups.push(cells);
    }
    return groups;
  }
}

function blobInfo(model, cells) {
  let area = 0;
  let polyKey = "";
  let polySize = 0;
  let polyShape = null;
  let invalid = false;
  for (const c of cells) {
    if (model.areaAt[c]) {
      if (area && area !== model.areaAt[c]) invalid = true;
      area = model.areaAt[c];
    }
    const poly = model.polyAt[c];
    if (poly) {
      if (polyKey && polyKey !== poly.looseKey) invalid = true;
      polyKey = poly.looseKey;
      polySize = poly.size;
      polyShape = poly;
    }
  }
  let lower = model.minSize;
  let upper = model.maxSize;
  for (const c of cells) {
    const exact = model.exactAt[c];
    if (exact) {
      lower = Math.max(lower, exact);
      upper = Math.min(upper, exact);
    }
  }
  for (const exact of [area, polySize]) {
    if (!exact) continue;
    lower = Math.max(lower, exact);
    upper = Math.min(upper, exact);
  }
  return { area, polyKey, polySize, polyShape, lower, upper, invalid, hasClue: Boolean(area || polyKey) };
}

function coverCrampedCells(model, state, domains, blobs, blobOf, info) {
  const { n, cellEdges } = model;
  if (model.domains.length === 0 || model.hasClueWithoutDomain) return false;
  // Cells that can still be part of a region holding no listed clue.
  const eligible = new Uint8Array(n);
  const union = model.domains.map((domain, d) => listSummary(model, d, domains[d]).union);
  let claimed = 0n;
  model.domains.forEach((domain, d) => {
    claimed |= listSummary(model, d, domains[d]).forced;
  });
  const claimedBits = claimed.toString(2);
  const claimedLength = claimedBits.length;
  for (let c = 0; c < n; c += 1) {
    if (!model.puzzle.active[c]) continue;
    if (model.domainAnchor[c]) continue;
    if (info[blobOf[c]].hasClue) continue;
    if (c < claimedLength && claimedBits[claimedLength - 1 - c] === "1") continue;
    eligible[c] = 1;
  }
  const seen = new Uint8Array(n);
  let changed = false;
  for (let start = 0; start < n; start += 1) {
    if (!eligible[start] || seen[start]) continue;
    const component = [start];
    seen[start] = 1;
    for (let i = 0; i < component.length; i += 1) {
      for (const [e, other] of cellEdges[component[i]]) {
        if (state[e] === WALL || !eligible[other] || seen[other]) continue;
        seen[other] = 1;
        component.push(other);
      }
    }
    if (component.length >= model.minSize) continue;
    for (const c of component) {
      const bit = 1n << BigInt(c);
      const owners = [];
      for (let d = 0; d < model.domains.length; d += 1) if (union[d] & bit) owners.push(d);
      if (owners.length === 0) return null;
      if (owners.length > 1) continue;
      const d = owners[0];
      const list = model.domains[d].placements;
      const kept = domains[d].filter((i) => list[i].mask & bit);
      if (kept.length === 0) return null;
      if (kept.length !== domains[d].length) {
        domains[d] = kept;
        changed = true;
      }
    }
  }
  return changed;
}

/** Edges of a shortest open path from cell a to cell b (both in the same blob). */
function openPath(model, state, a, b) {
  const previous = new Map([[a, -1]]);
  const queue = [a];
  for (let i = 0; i < queue.length && !previous.has(b); i += 1) {
    const c = queue[i];
    for (const [e, other] of model.cellEdges[c]) {
      if (state[e] !== OPEN || previous.has(other)) continue;
      previous.set(other, e);
      queue.push(other);
    }
  }
  const path = [];
  for (let c = b; c !== a; ) {
    const e = previous.get(c);
    if (e === undefined || e < 0) break;
    path.push(e);
    c = model.edgeA[e] === c ? model.edgeB[e] : model.edgeA[e];
  }
  return path;
}

/** Open edges of a spanning tree of a blob: they alone join all its cells. */
function spanningOpen(model, state, cells) {
  const inside = new Set(cells);
  const seen = new Set([cells[0]]);
  const queue = [cells[0]];
  const edges = [];
  for (let i = 0; i < queue.length; i += 1) {
    for (const [e, other] of model.cellEdges[queue[i]]) {
      if (state[e] !== OPEN || !inside.has(other) || seen.has(other)) continue;
      seen.add(other);
      queue.push(other);
      edges.push(e);
    }
  }
  return edges;
}

/** Walls on the boundary of a zone (cells joined through non-wall borders). */
function zoneWalls(model, state, cells) {
  const inside = new Set(cells);
  const walls = [];
  for (const c of cells) {
    for (const [e, other] of model.cellEdges[c]) {
      if (!inside.has(other) && state[e] === WALL) walls.push(e);
    }
  }
  return walls;
}

/** Literals that pin a finished region exactly: a spanning tree of open borders and its walls. */
function exactRegionLiterals(model, state, cells) {
  return [
    ...spanningOpen(model, state, cells).map((e) => literalOf(e, OPEN)),
    ...zoneWalls(model, state, cells).map((e) => literalOf(e, WALL))
  ];
}

/** Tighten a blob's size bound and remember why it holds (a function producing literals). */
function tighten(item, which, value, reason) {
  if (which === "lower" ? value > item.lower : value < item.upper) {
    item[which] = value;
    item[which === "lower" ? "lowerReason" : "upperReason"] = reason;
  }
}

/** Literals behind a bound; empty when the bound comes from the puzzle itself. */
function boundReason(item, which) {
  const reason = item[which === "lower" ? "lowerReason" : "upperReason"];
  return reason ? reason() : [];
}

function dedupe(literals) {
  return [...new Set(literals)];
}

/** Size bounds that come only from the puzzle itself (clues in the blob, global rules). */
function staticUpper(model, cells) {
  let upper = model.maxSize;
  for (const c of cells) {
    if (model.areaAt[c]) upper = Math.min(upper, model.areaAt[c]);
    if (model.polyAt[c]) upper = Math.min(upper, model.polyAt[c].size);
    if (model.exactAt[c]) upper = Math.min(upper, model.exactAt[c]);
  }
  return upper;
}

function staticLower(model, cells) {
  let lower = model.minSize;
  for (const c of cells) {
    if (model.areaAt[c]) lower = Math.max(lower, model.areaAt[c]);
    if (model.polyAt[c]) lower = Math.max(lower, model.polyAt[c].size);
    if (model.exactAt[c]) lower = Math.max(lower, model.exactAt[c]);
  }
  return lower;
}

function zonesHaveRoom(model, zones, zoneOf, blobs, blobOf, info) {
  const byZone = new Map();
  for (let b = 0; b < blobs.length; b += 1) {
    if (!info[b].hasClue || info[b].upper === Infinity) continue;
    const z = zoneOf[blobs[b][0]];
    const list = byZone.get(z) ?? [];
    list.push(info[b]);
    byZone.set(z, list);
  }
  for (const [z, list] of byZone) {
    // Greedily keep clue blobs that certainly belong to different regions.
    const distinct = [];
    let allDistinct = true;
    for (const item of list) {
      if (distinct.every((other) => !canMerge(item, other, 0))) distinct.push(item);
      else allDistinct = false;
    }
    const required = distinct.reduce((sum, item) => sum + item.upper, 0);
    const size = zones[z].length;
    if (required > size) return false;
    const leftover = size - required;
    if (allDistinct && leftover > 0 && leftover < model.minSize) return false;
  }
  return true;
}

/** Cells used by every placement in a list (forced) and by any (union), cached per list object. */
function listSummary(model, d, indices) {
  let summary = model.listSummaries.get(indices);
  if (!summary) {
    const list = model.domains[d].placements;
    let and = -1n;
    let or = 0n;
    for (const i of indices) {
      and &= list[i].mask;
      or |= list[i].mask;
    }
    summary = { forced: indices.length ? and : 0n, union: or };
    model.listSummaries.set(indices, summary);
  }
  return summary;
}

function excludeOverlaps(model, domains) {
  const count = domains.length;
  const forced = new Array(count);
  const union = new Array(count);
  for (let d = 0; d < count; d += 1) {
    const summary = listSummary(model, d, domains[d]);
    forced[d] = summary.forced;
    union[d] = summary.union;
  }
  for (let changed = true, rounds = 0; changed && rounds < 20; rounds += 1) {
    changed = false;
    for (let x = 0; x < count; x += 1) {
      let forbidden = 0n;
      const anchorX = 1n << BigInt(model.domains[x].anchor);
      for (let y = 0; y < count; y += 1) {
        if (y === x || forced[y] === 0n) continue;
        const anchorY = 1n << BigInt(model.domains[y].anchor);
        const maybeSameRegion = (union[x] & anchorY) !== 0n || (union[y] & anchorX) !== 0n;
        if (!maybeSameRegion) forbidden |= forced[y];
      }
      if (forbidden === 0n) continue;
      const list = model.domains[x].placements;
      const kept = domains[x].filter((i) => (list[i].mask & forbidden) === 0n);
      if (kept.length === 0) return false;
      if (kept.length !== domains[x].length) {
        domains[x] = kept;
        const summary = listSummary(model, x, kept);
        forced[x] = summary.forced;
        union[x] = summary.union;
        changed = true;
      }
    }
  }
  return true;
}

function canMerge(x, y, mergedSize) {
  if (x.area && y.area && x.area !== y.area) return false;
  if (x.polyKey && y.polyKey && x.polyKey !== y.polyKey) return false;
  return mergedSize <= Math.min(x.upper, y.upper);
}

function placementFits(state, placement) {
  for (const e of placement.internal) if (state[e] === WALL) return false;
  for (const e of placement.boundary) if (state[e] === OPEN) return false;
  return true;
}

/** Borders inside every remaining placement are open; borders on the edge of every placement are walls. */
/** For each placement, one literal of the state that rules it out; undefined if some has none. */
function killingLiterals(state, placements) {
  const literals = new Set();
  for (const placement of placements) {
    let found = -1;
    for (const e of placement.internal) {
      if (state[e] === WALL) {
        found = literalOf(e, WALL);
        break;
      }
    }
    if (found < 0) {
      for (const e of placement.boundary) {
        if (state[e] === OPEN) {
          found = literalOf(e, OPEN);
          break;
        }
      }
    }
    if (found < 0) return undefined;
    literals.add(found);
  }
  return [...literals];
}

function forceAgreement(model, state, placements, set, reason) {
  if (placements.length === 0) return false;
  const inside = model.scratchInside;
  const edge = model.scratchBoundary;
  const touched = [];
  for (const placement of placements) {
    for (const e of placement.internal) {
      if (inside[e] === 0 && edge[e] === 0) touched.push(e);
      inside[e] += 1;
    }
    for (const e of placement.boundary) {
      if (inside[e] === 0 && edge[e] === 0) touched.push(e);
      edge[e] += 1;
    }
  }
  const total = placements.length;
  let ok = true;
  for (const e of touched) {
    if (ok && state[e] === UNKNOWN) {
      if (inside[e] === total && !set(e, OPEN, reason)) ok = false;
      else if (edge[e] === total && !set(e, WALL, reason)) ok = false;
    }
    inside[e] = 0;
    edge[e] = 0;
  }
  return ok;
}

function halfPlaneCounts(model, cells, clueCell) {
  const counts = { N: 0, E: 0, S: 0, W: 0 };
  for (const c of cells) {
    if (c === clueCell) continue;
    for (const d of ["N", "E", "S", "W"]) if (inHalfPlane(model, c, clueCell, d)) counts[d] += 1;
  }
  return counts;
}

function inHalfPlane(model, cell, clueCell, direction) {
  const p = xy(cell, model.width);
  const q = xy(clueCell, model.width);
  if (direction === "N") return p.y < q.y;
  if (direction === "S") return p.y > q.y;
  if (direction === "W") return p.x < q.x;
  return p.x > q.x;
}

function palisadePropagate(model, state, clue, set) {
  const { width, height } = model;
  const p = xy(clue.cell, width);
  const sides = [];
  for (const [d, dx, dy] of [["N", 0, -1], ["E", 1, 0], ["S", 0, 1], ["W", -1, 0]]) {
    const x = p.x + dx;
    const y = p.y + dy;
    const neighbor = x >= 0 && y >= 0 && x < width && y < height ? idx(x, y, width) : -1;
    const e = neighbor >= 0 ? model.edgeByKey.get(edgeKey(clue.cell, neighbor)) : undefined;
    if (e === undefined) sides.push({ d, fixed: true });
    else sides.push({ d, e, fixed: state[e] === UNKNOWN ? null : state[e] === WALL });
  }
  const free = sides.filter((side) => side.fixed === null);
  const consistent = [];
  for (let bits = 0; bits < 1 << free.length; bits += 1) {
    const walls = new Set(sides.filter((side) => side.fixed === true).map((side) => side.d));
    free.forEach((side, i) => {
      if (bits & (1 << i)) walls.add(side.d);
    });
    if (palisadePatternFromSides(walls) === clue.pattern) consistent.push(bits);
  }
  if (consistent.length === 0) {
    model.explanation = sides.filter((side) => side.e !== undefined && side.fixed !== null).map((side) => literalOf(side.e, side.fixed ? WALL : OPEN));
    return false;
  }
  const known = sides.filter((side) => side.e !== undefined && side.fixed !== null).map((side) => literalOf(side.e, side.fixed ? WALL : OPEN));
  for (let i = 0; i < free.length; i += 1) {
    const allWall = consistent.every((bits) => bits & (1 << i));
    const allOpen = consistent.every((bits) => !(bits & (1 << i)));
    if (allWall && !set(free[i].e, WALL, known)) return false;
    if (allOpen && !set(free[i].e, OPEN, known)) return false;
  }
  return true;
}

/** Placements congruent (under the puzzle's shape-comparison settings) to a finished region, covering `cell`. */
function geminiPlacements(model, regionCells, cell) {
  const regionCacheKey = `region:${regionKey(regionCells)}@${cell}`;
  let placements = model.derivedCache.get(regionCacheKey);
  if (placements) return placements;
  const shape = normalizeShape(shapeCellsFromIndexes(regionCells, model.width));
  const cacheKey = `${canonicalShapeKey(shape, model.shapeOptions)}@${cell}`;
  placements = model.derivedCache.get(cacheKey);
  if (!placements) {
    placements = model.shapePlacements(shape, model.shapeOptions, cell);
    model.derivedCache.set(cacheKey, placements);
  }
  model.derivedCache.set(regionCacheKey, placements);
  return placements;
}

/**
 * Placements a Gemini partner may take when the other region holds a Polyomino clue. Uses the
 * union of the clue's and the comparison's allowed transforms, so the list is never too narrow.
 */
function geminiPlacementsForClue(model, poly, cell) {
  const options = {
    allowRotations: poly.matchOptions.allowRotations || model.shapeOptions.allowRotations,
    allowReflections: poly.matchOptions.allowReflections || model.shapeOptions.allowReflections
  };
  const cacheKey = `clue:${poly.looseKey}:${options.allowRotations}:${options.allowReflections}@${cell}`;
  let placements = model.derivedCache.get(cacheKey);
  if (!placements) {
    placements = model.shapePlacements(poly.shape, options, cell);
    model.derivedCache.set(cacheKey, placements);
  }
  return placements;
}

function regionKey(cells) {
  return [...cells].sort((a, b) => a - b).join(",");
}

/** The candidate object for a region, built once per distinct cell set. */
function cachedCandidate(model, cells, key = regionKey(cells)) {
  let candidate = model.candidateCache.get(key);
  if (!candidate) {
    candidate = regionCandidate(model.puzzle, cells);
    if (model.candidateCache.size > 200000) model.candidateCache.clear();
    model.candidateCache.set(key, candidate);
  }
  return candidate;
}

function regionPasses(model, cells) {
  const key = regionKey(cells);
  let ok = model.regionCheckCache.get(key);
  if (ok === undefined) {
    ok = applyCandidateFilters(cachedCandidate(model, cells, key), model.context, [edgeConstraintsRule]);
    model.regionCheckCache.set(key, ok);
  }
  return ok;
}

function closedRegionsCompatible(model, regions, complete = false) {
  const keys = regions.map(regionKey);
  const key = `${complete}|${[...keys].sort().join("|")}`;
  const cached = model.pairCheckCache.get(key);
  if (cached !== undefined) return cached;
  const candidates = regions.map((cells, id) => ({ ...cachedCandidate(model, cells, keys[id]), id }));
  const context = createRuleContext(model.puzzle, { candidates });
  const constraints = createConstraintModel();
  addRuleConstraints(constraints, context);
  let ok = constraints.invalidPairs.size === 0;
  if (ok) {
    const stateInfo = { complete, coveredMask: candidates.reduce((mask, candidate) => mask | candidate.mask, 0n) };
    ok = constraints.selectionValidators.every((validate) => validate(candidates, stateInfo));
  }
  if (model.pairCheckCache.size > 50000) model.pairCheckCache.clear();
  model.pairCheckCache.set(key, ok);
  return ok;
}

// ---------------------------------------------------------------------------
// Branching and solutions

function chooseBranch(model, state, domains, outcome) {
  const { blobs, info, derivedDomains } = outcome;
  if (!state.some((s) => s === UNKNOWN)) return null;

  // 1. The clue placement list with the fewest options.
  let best = null;
  const consider = (placements) => {
    if (placements.length < 2) return;
    if (!best || placements.length < best.length) best = placements;
  };
  domains.forEach((valid, d) => consider(valid.map((i) => model.domains[d].placements[i])));
  for (const derived of derivedDomains) consider(derived.valid ?? []);
  if (best && best.length <= 12) {
    return best.map((placement) => [
      ...[...placement.internal].map((e) => [e, OPEN]),
      ...[...placement.boundary].map((e) => [e, WALL])
    ]);
  }

  // 2. Otherwise a border of the most constrained unfinished blob: smallest frontier, too small first.
  let bestBlob = -1;
  let bestScore = Infinity;
  for (let b = 0; b < blobs.length; b += 1) {
    const frontier = info[b].frontier;
    if (frontier.length === 0) continue;
    const needsGrowth = blobs[b].length < info[b].lower ? 0 : 1000;
    const score = needsGrowth + frontier.length;
    if (score < bestScore) {
      bestScore = score;
      bestBlob = b;
    }
  }
  if (bestBlob < 0) return null;
  const e = info[bestBlob].frontier[0];
  // A region still below its minimum tries to grow first; one that is big enough tries to close
  // first. Most regions in these puzzles are small, so this finds them before merging them into
  // a large leftover region.
  const growFirst = blobs[bestBlob].length < info[bestBlob].lower;
  return growFirst ? [[[e, OPEN]], [[e, WALL]]] : [[[e, WALL]], [[e, OPEN]]];
}

function finalSolution(model, state) {
  if (state.some((s) => s === UNKNOWN)) return null;
  const blobOf = new Int32Array(model.n).fill(-1);
  const regions = [];
  for (let start = 0; start < model.n; start += 1) {
    if (!model.puzzle.active[start] || blobOf[start] >= 0) continue;
    const cells = [start];
    blobOf[start] = regions.length;
    for (let i = 0; i < cells.length; i += 1) {
      for (const [e, other] of model.cellEdges[cells[i]]) {
        if (state[e] === OPEN && blobOf[other] < 0) {
          blobOf[other] = regions.length;
          cells.push(other);
        }
      }
    }
    regions.push(cells.sort((a, b) => a - b));
  }
  for (const cells of regions) if (!regionPasses(model, cells)) return null;
  if (!closedRegionsCompatible(model, regions, true)) return null;

  const solutionRegions = regions.map((cells, index) => {
    const candidate = regionCandidate(model.puzzle, cells);
    return {
      id: index + 1,
      cells: [...cells],
      area: cells.length,
      shapeKey: candidateShapeForComparison(model.puzzle, candidate),
      source: "borders",
      sourceName: ""
    };
  });
  const regionByCell = {};
  for (const region of solutionRegions) for (const cell of region.cells) regionByCell[cell] = region.id;
  return { regions: solutionRegions, regionByCell };
}

/**
 * Failed-literal probing: try each unknown border both ways; when one way propagates to a
 * contradiction, the border takes the other value. Repeats until nothing changes.
 * Returns the propagation outcome, or null if the node itself is contradictory.
 */
function probe(model, state, domains) {
  let outcome = propagate(model, state, domains);
  if (!outcome) return null;
  for (let progress = true; progress; ) {
    progress = false;
    for (let e = 0; e < state.length; e += 1) {
      for (const value of [OPEN, WALL]) {
        if (state[e] !== UNKNOWN) break;
        const trial = state.slice();
        trial[e] = value;
        if (propagate(model, trial, domains.slice())) continue;
        state[e] = value === OPEN ? WALL : OPEN;
        outcome = propagate(model, state, domains);
        if (!outcome) return null;
        progress = true;
      }
    }
  }
  return outcome;
}

/** A region in the same shape the candidate solver uses, so rule modules can check it. */
export function regionCandidate(puzzle, cells) {
  const sorted = [...cells].sort((a, b) => a - b);
  const shapeCells = shapeCellsFromIndexes(sorted, puzzle.width);
  return {
    id: -1,
    cells: sorted,
    mask: maskFromIndexes(sorted),
    area: sorted.length,
    shapeCells,
    shapeKey: canonicalShapeKey(shapeCells, { allowRotations: true, allowReflections: false }),
    shapeKeyWithReflections: canonicalShapeKey(shapeCells, { allowRotations: true, allowReflections: true }),
    source: "borders",
    sourceName: "",
    matchOptions: null,
    width: puzzle.width,
    height: puzzle.height
  };
}
