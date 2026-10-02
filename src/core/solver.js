import { createConstraintModel } from "./constraints.js";
import { activeCellIndexes, hasBit, maskFromIndexes } from "./geometry.js";
import { normalizePuzzle } from "./puzzle.js";
import { buildCandidateGenerationPlan, generateCandidates } from "./candidates.js";
import { addRuleConstraints, createRuleContext } from "./rules/registry.js";
import { candidateShapeForComparison } from "./shape-comparison.js";
import { validatePuzzle } from "./validation.js";
import { solveByBorders } from "./edge-solver.js";

/**
 * Candidate plans that list every region a solution could use. The other plans only list regions
 * for some clues (Polyomino, Area Number) or none at all, so exact cover over them can miss
 * solutions; those puzzles go to the border solver instead.
 */
const COMPLETE_CANDIDATE_PLANS = new Set(["shape_bank", "fixed_area", "range"]);

/** Listing regions of this many cells or more gets too slow; the border solver takes those puzzles. */
const LARGE_REGION_AREA = 12;

/**
 * Which solver handles this puzzle: "candidates" (exact cover over listed regions, fast when the
 * list is complete and small) or "borders" (decides borders one by one; handles anything). Decided
 * from the candidate plan alone, without listing any regions. Pass options.engine to force one.
 * Even when this says "candidates", solvePuzzle switches to borders if the list gets truncated.
 */
export function chooseSolverEngine(puzzle, options = {}) {
  if (options.engine === "candidates" || options.engine === "borders") return options.engine;
  const context = createRuleContext(puzzle, options);
  const plan = buildCandidateGenerationPlan(puzzle, context);
  if (!COMPLETE_CANDIDATE_PLANS.has(plan.kind)) return "borders";
  if (plan.kind === "fixed_area" && plan.area >= LARGE_REGION_AREA) return "borders";
  if (plan.kind === "range") {
    const max = Number(context.ruleConfigs.range?.max);
    if (!Number.isInteger(max) || max >= LARGE_REGION_AREA) return "borders";
  }
  return "candidates";
}

export function solvePuzzle(rawPuzzle, options = {}) {
  const validation = validatePuzzle(rawPuzzle);
  const puzzle = validation.puzzle ?? normalizePuzzle(rawPuzzle);
  const limit = Math.max(1, options.limit ?? 2);
  const maxNodes = Math.max(1, options.maxNodes ?? 250000);
  const activeCells = activeCellIndexes(puzzle);
  const fullMask = maskFromIndexes(activeCells);

  if (!validation.ok) {
    return {
      status: "no_solution",
      solutions: [],
      errors: validation.errors,
      candidates: [],
      nodeCount: 0,
      truncated: false
    };
  }

  if (activeCells.length === 0) {
    return {
      status: "unique_solution",
      solutions: [{ regions: [], regionByCell: {} }],
      errors: [],
      candidates: [],
      nodeCount: 0,
      truncated: false
    };
  }

  const borders = () => solveByBorders(puzzle, { limit, maxNodes, maxMillis: options.maxMillis });
  if (chooseSolverEngine(puzzle, options) === "borders") return borders();
  let context = createRuleContext(puzzle, options);
  const { candidates, errors, plan, truncated } = generateCandidates(puzzle, { ...options, context });
  if (truncated && options.engine !== "candidates") return borders();
  context = createRuleContext(puzzle, { ...options, candidates });
  const candidatesByCell = Array.from({ length: puzzle.width * puzzle.height }, () => []);
  for (const candidate of candidates) {
    for (const cell of candidate.cells) candidatesByCell[cell].push(candidate);
  }

  for (const cell of activeCells) {
    if (candidatesByCell[cell].length === 0) {
      return {
        status: "no_solution",
        solutions: [],
        errors: [...errors, `No valid region candidate can cover cell ${cell}.`],
        candidates,
        candidatePlan: plan,
        nodeCount: 0,
        truncated: false
      };
    }
  }

  const constraintModel = createConstraintModel();
  addRuleConstraints(constraintModel, context);
  const invalidPairs = constraintModel.invalidPairs;
  const selectionValidators = constraintModel.selectionValidators ?? [];
  const solutions = [];
  let nodeCount = 0;
  let hitNodeLimit = false;
  const selected = [];

  dfs(0n);

  let status;
  if (solutions.length === 0) status = "no_solution";
  else if (hitNodeLimit) status = "search_limit";
  else if (limit === 1) status = "solution_found";
  else if (solutions.length > 1) status = "multiple_solutions";
  else status = "unique_solution";

  return {
    status,
    solutions,
    errors,
    candidates,
    candidatePlan: plan,
    nodeCount,
    truncated: hitNodeLimit || solutions.length >= limit
  };

  function dfs(coveredMask) {
    if (solutions.length >= limit || hitNodeLimit) return;
    nodeCount += 1;
    if (nodeCount > maxNodes) {
      hitNodeLimit = true;
      return;
    }

    if (coveredMask === fullMask) {
      if (!selectionValidatorsPass(null, coveredMask)) return;
      solutions.push(makeSolution(puzzle, selected.map((id) => candidates[id])));
      return;
    }

    const choice = chooseNextCell(coveredMask);
    if (!choice) return;

    for (const candidate of choice.options) {
      const nextMask = coveredMask | candidate.mask;
      if (!selectionValidatorsPass(candidate.id, nextMask)) continue;
      selected.push(candidate.id);
      dfs(nextMask);
      selected.pop();
      if (solutions.length >= limit || hitNodeLimit) return;
    }
  }

  function chooseNextCell(coveredMask) {
    let bestCell = -1;
    let bestOptions = null;

    for (const cell of activeCells) {
      if (hasBit(coveredMask, cell)) continue;
      const optionsForCell = [];
      for (const candidate of candidatesByCell[cell]) {
        if ((candidate.mask & coveredMask) !== 0n) continue;
        if (conflictsWithSelected(candidate.id)) continue;
        optionsForCell.push(candidate);
      }
      if (optionsForCell.length === 0) return null;
      if (bestOptions === null || optionsForCell.length < bestOptions.length) {
        bestCell = cell;
        bestOptions = optionsForCell;
        if (bestOptions.length === 1) break;
      }
    }

    return bestOptions === null ? null : { cell: bestCell, options: bestOptions };
  }

  function conflictsWithSelected(candidateId) {
    const bad = invalidPairs.get(candidateId);
    if (!bad) return false;
    for (const selectedId of selected) {
      if (bad.has(selectedId)) return true;
    }
    return false;
  }

  function selectionValidatorsPass(candidateId, coveredMask) {
    if (selectionValidators.length === 0) return true;
    const selectedCandidates = selected.map((id) => candidates[id]);
    if (candidateId !== null) selectedCandidates.push(candidates[candidateId]);
    const state = {
      complete: coveredMask === fullMask,
      coveredMask
    };
    return selectionValidators.every((validator) => validator(selectedCandidates, state));
  }
}

function makeSolution(puzzle, candidates) {
  const regions = candidates.map((candidate, index) => ({
    id: index + 1,
    cells: [...candidate.cells],
    area: candidate.area,
    shapeKey: candidateShapeForComparison(puzzle, candidate),
    source: candidate.source,
    sourceName: candidate.sourceName
  }));
  const regionByCell = {};
  for (const region of regions) {
    for (const cell of region.cells) regionByCell[cell] = region.id;
  }
  return { regions, regionByCell };
}
