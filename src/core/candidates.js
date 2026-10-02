import {
  activeCellIndexes,
  boundsOfShape,
  canonicalShapeKey,
  idx,
  maskFromIndexes,
  orthogonalNeighbors,
  shapeCellsFromIndexes,
  shapeTransforms
} from "./geometry.js";
import { parseShapeBank } from "./puzzle.js";
import { candidateShapeForComparison } from "./shape-comparison.js";
import { areaNumberCandidateAreas } from "./rules/area-number.js";
import { edgeConstraintsRule } from "./rules/edge-constraints.js";
import { polyominoCandidateShapes } from "./rules/polyomino.js";
import { rangeCandidateAreas } from "./rules/range.js";
import { applyCandidateFilters, createRuleContext, explainCandidateRejection } from "./rules/registry.js";

const DEFAULT_MAX_CANDIDATES = 80000;

export function generateCandidates(puzzle, options = {}) {
  const maxCandidates = options.maxCandidates ?? DEFAULT_MAX_CANDIDATES;
  const context = options.context ?? createRuleContext(puzzle, options);
  const plan = buildCandidateGenerationPlan(puzzle, context);
  const errors = [...plan.errors];
  const raw = generateRawCandidatesForPlan(puzzle, plan, maxCandidates);
  if (plan.kind === "missing_source") {
    errors.push("Set a Precision area, provide Shape Bank shapes, place Area Number/Polyomino clues, or enable Range before solving.");
  }

  const excludedMasks = new Set(puzzle.metadata?.excludedCandidateMasks ?? []);
  const filtered = [];
  const seen = new Set();
  for (const candidate of raw) {
    if (seen.has(candidate.mask.toString())) continue;
    seen.add(candidate.mask.toString());
    if (excludedMasks.has(candidate.mask.toString())) continue;
    if (!applyCandidateFilters(candidate, context, [edgeConstraintsRule])) continue;
    candidate.id = filtered.length;
    filtered.push(candidate);
  }

  filtered.sort((a, b) => a.cells[0] - b.cells[0] || a.area - b.area || a.shapeKey.localeCompare(b.shapeKey));
  for (let id = 0; id < filtered.length; id += 1) filtered[id].id = id;

  const truncated = raw.length >= maxCandidates;
  if (truncated) {
    errors.push(`Candidate generation stopped at ${maxCandidates} regions. Add more rules or lower the board size.`);
  }

  return { candidates: filtered, errors, plan, truncated };
}

export function generateCandidateDiagnostics(puzzle, options = {}) {
  const maxCandidates = options.maxCandidates ?? DEFAULT_MAX_CANDIDATES;
  const context = options.context ?? createRuleContext(puzzle, options);
  const plan = buildCandidateGenerationPlan(puzzle, context);
  const raw = generateRawCandidatesForPlan(puzzle, plan, maxCandidates);
  const excludedMasks = new Set(puzzle.metadata?.excludedCandidateMasks ?? []);
  const accepted = [];
  const rejected = [];
  const acceptedMasks = new Set();
  const rejectedKeys = new Set();

  for (const candidate of raw) {
    const mask = candidate.mask.toString();
    if (excludedMasks.has(mask)) continue;
    const rejection = explainCandidateRejection(candidate, context, [edgeConstraintsRule]);
    if (rejection) {
      const key = `${mask}:${rejection.ruleId}`;
      if (!rejectedKeys.has(key)) {
        rejectedKeys.add(key);
        rejected.push({ candidate, rejection });
      }
      continue;
    }
    if (acceptedMasks.has(mask)) continue;
    acceptedMasks.add(mask);
    candidate.id = accepted.length;
    accepted.push(candidate);
  }

  return {
    plan,
    raw,
    accepted,
    rejected,
    errors: [...plan.errors, ...(raw.length >= maxCandidates ? [`Candidate generation stopped at ${maxCandidates} regions.`] : [])]
  };
}

export function buildCandidateGenerationPlan(puzzle, context = createRuleContext(puzzle)) {
  const { shapes, errors } = shapeBankEntriesForGeneration(puzzle);
  if (shapes.length > 0) {
    return {
      kind: "shape_bank",
      ruleId: "shape_bank",
      shapes,
      errors
    };
  }

  const precisionArea = context.ruleConfigs.precision?.area ?? 0;
  if (precisionArea > 0) {
    return {
      kind: "fixed_area",
      ruleId: "precision",
      area: precisionArea,
      errors
    };
  }

  const polyominoShapes = polyominoCandidateShapes(context);
  if (polyominoShapes.length > 0) {
    return {
      kind: "polyomino_clues",
      ruleId: "polyomino",
      shapes: polyominoShapes,
      errors
    };
  }

  const areaNumberAreas = areaNumberCandidateAreas(context);
  if (areaNumberAreas.length > 0) {
    return {
      kind: "area_number_clues",
      ruleId: "area_number",
      areas: areaNumberAreas,
      errors
    };
  }

  const rangeAreas = rangeCandidateAreas(context);
  if (rangeAreas.areas.length > 0) {
    return {
      kind: "range",
      ruleId: "range",
      areas: rangeAreas.areas,
      errors: [...errors, ...rangeAreas.errors]
    };
  }

  // Extension point for future rules: add candidate sources here and keep
  // rule-specific candidate generation out of the exact-cover search.
  return {
    kind: "missing_source",
    ruleId: null,
    errors
  };
}

function makeCandidate(indexes, width, height, source, sourceName = "", matchOptions = null) {
  const cells = [...indexes].sort((a, b) => a - b);
  const shapeCells = shapeCellsFromIndexes(cells, width);
  return {
    id: -1,
    cells,
    mask: maskFromIndexes(cells),
    area: cells.length,
    shapeCells,
    shapeKey: canonicalShapeKey(shapeCells, { allowRotations: true, allowReflections: false }),
    shapeKeyWithReflections: canonicalShapeKey(shapeCells, { allowRotations: true, allowReflections: true }),
    source,
    sourceName,
    matchOptions,
    width,
    height
  };
}

function generateRawCandidatesForPlan(puzzle, plan, maxCandidates) {
  if (plan.kind === "shape_bank") {
    return generateShapePlacementCandidates(puzzle, plan.shapes, maxCandidates, "shapeBank");
  }
  if (plan.kind === "polyomino_clues") {
    return generateShapePlacementCandidates(puzzle, plan.shapes, maxCandidates, "polyomino");
  }
  if (plan.kind === "fixed_area") {
    return generateConnectedCandidates(puzzle, plan.area, maxCandidates);
  }
  if (plan.kind === "area_number_clues") {
    return generateConnectedCandidatesForAreas(puzzle, plan.areas, maxCandidates);
  }
  if (plan.kind === "range") {
    return generateConnectedCandidatesForAreas(puzzle, plan.areas, maxCandidates);
  }
  return [];
}

function generateShapePlacementCandidates(puzzle, shapes, maxCandidates, source = "shapeBank") {
  const candidates = [];
  for (const shape of shapes) {
    if (puzzle.rules.precision?.area > 0 && shape.cells.length !== puzzle.rules.precision.area) continue;
    const transformOptions = shape.options ?? {
      allowRotations: puzzle.shapeBank?.allowRotations !== false,
      allowReflections: puzzle.shapeBank?.allowReflections !== false
    };
    const transforms = shapeTransforms(shape.cells, {
      allowRotations: transformOptions.allowRotations !== false,
      allowReflections: transformOptions.allowReflections !== false
    });
    for (const transformed of transforms) {
      const bounds = boundsOfShape(transformed);
      for (let y = 0; y <= puzzle.height - bounds.height; y += 1) {
        for (let x = 0; x <= puzzle.width - bounds.width; x += 1) {
          const indexes = [];
          let ok = true;
          for (const [dx, dy] of transformed) {
            const cell = idx(x + dx, y + dy, puzzle.width);
            if (!puzzle.active[cell]) {
              ok = false;
              break;
            }
            indexes.push(cell);
          }
          if (!ok) continue;
          candidates.push(makeCandidate(indexes, puzzle.width, puzzle.height, source, shape.name, shape.matchOptions));
          if (candidates.length >= maxCandidates) return candidates;
        }
      }
    }
  }
  return candidates;
}

function generateConnectedCandidates(puzzle, targetArea, maxCandidates) {
  const activeCells = activeCellIndexes(puzzle).sort((a, b) => a - b);
  const active = new Set(activeCells);
  const candidates = [];
  const seenMasks = new Set();

  for (const anchor of activeCells) {
    const region = new Set([anchor]);
    const frontier = new Set(
      orthogonalNeighbors(anchor, puzzle.width, puzzle.height).filter((n) => active.has(n) && n >= anchor)
    );
    explore(anchor, region, frontier);
    if (candidates.length >= maxCandidates) break;
  }

  return candidates;

  function explore(anchor, region, frontier) {
    if (candidates.length >= maxCandidates) return;
    if (region.size === targetArea) {
      const cells = [...region].sort((a, b) => a - b);
      const mask = maskFromIndexes(cells).toString();
      if (!seenMasks.has(mask)) {
        seenMasks.add(mask);
        candidates.push(makeCandidate(cells, puzzle.width, puzzle.height, "connected"));
      }
      return;
    }
    if (frontier.size === 0) return;

    const choices = [...frontier].sort((a, b) => a - b);
    for (const cell of choices) {
      if (cell < anchor) continue;
      const nextRegion = new Set(region);
      nextRegion.add(cell);

      const nextFrontier = new Set(frontier);
      nextFrontier.delete(cell);
      for (const neighbor of orthogonalNeighbors(cell, puzzle.width, puzzle.height)) {
        if (neighbor >= anchor && active.has(neighbor) && !nextRegion.has(neighbor)) {
          nextFrontier.add(neighbor);
        }
      }
      explore(anchor, nextRegion, nextFrontier);
      if (candidates.length >= maxCandidates) return;
    }
  }
}

function generateConnectedCandidatesForAreas(puzzle, targetAreas, maxCandidates) {
  const candidates = [];
  const seen = new Set();
  for (const area of targetAreas) {
    for (const candidate of generateConnectedCandidates(puzzle, area, maxCandidates - candidates.length)) {
      const key = candidate.mask.toString();
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push(candidate);
      if (candidates.length >= maxCandidates) return candidates;
    }
  }
  return candidates;
}

function shapeBankEntriesForGeneration(puzzle) {
  const parsed = parseShapeBank(puzzle.shapeBank?.text ?? puzzle.rules.shapeBankText);
  return {
    shapes: [...parsed.shapes, ...(puzzle.shapeBank?.entries ?? [])],
    errors: parsed.errors
  };
}

export { candidateShapeForComparison };
