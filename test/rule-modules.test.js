import assert from "node:assert/strict";
import test from "node:test";
import {
  allVertexBorderDegrees,
  cellsAroundVertex,
  distinctRegionsTouchingVertex,
  palisadePatternFromSides,
  selectedBorderSegments,
  vertexBorderDegree
} from "../src/core/boundary.js";
import { createConstraintModel } from "../src/core/constraints.js";
import { canonicalShapeKey, maskFromIndexes } from "../src/core/geometry.js";
import { normalizePuzzle } from "../src/core/puzzle.js";
import { solvePuzzle } from "../src/core/solver.js";
import { areaNumberRule } from "../src/core/rules/area-number.js";
import { boxyRule, nonBoxyRule } from "../src/core/rules/area-shape-filters.js";
import { brickyRule } from "../src/core/rules/bricky.js";
import { compassCounts, compassRule } from "../src/core/rules/compass.js";
import { inequalityRule } from "../src/core/rules/inequality.js";
import { loopyRule } from "../src/core/rules/loopy.js";
import { mingleShapeRule } from "../src/core/rules/mingle-shape.js";
import { deltaRule, differenceRule, geminiRule } from "../src/core/rules/relations.js";
import { matchRule, mismatchRule } from "../src/core/rules/shape-global.js";
import { candidatePalisadePattern, palisadeRule } from "../src/core/rules/palisade.js";
import { polyominoRule } from "../src/core/rules/polyomino.js";
import { precisionRule } from "../src/core/rules/precision.js";
import { rangeRule } from "../src/core/rules/range.js";
import { createRuleContext } from "../src/core/rules/registry.js";
import { roseWindowRule } from "../src/core/rules/rose-window.js";
import { shapeBankRule } from "../src/core/rules/shape-bank.js";
import { sizeSeparationRule } from "../src/core/rules/size-separation.js";
import { solitudeRule } from "../src/core/rules/solitude.js";
import { watchtowerRule } from "../src/core/rules/watchtower.js";

test("Precision rule filters by candidate area", () => {
  const context = createRuleContext(normalizePuzzle({ width: 2, height: 2, rules: { area: 2 } }));

  assert.equal(precisionRule.candidateFilter({ area: 2 }, context), true);
  assert.equal(precisionRule.candidateFilter({ area: 3 }, context), false);
});

test("Rose Window rule filters by required symbol counts", () => {
  const puzzle = normalizePuzzle({
    width: 2,
    height: 1,
    symbols: { 0: "A", 1: "B" },
    rules: { roseLabels: "AB" }
  });
  const context = createRuleContext(puzzle);

  assert.equal(roseWindowRule.candidateFilter(candidate([0, 1], 2), context), true);
  assert.equal(roseWindowRule.candidateFilter(candidate([0], 2), context), false);
});

test("Shape Bank rule validates optional future use limits", () => {
  const puzzle = normalizePuzzle({
    width: 1,
    height: 1,
    shapeBank: { text: "M1: 0,0", exactUses: -1 }
  });
  const context = createRuleContext(puzzle);

  assert.match(shapeBankRule.validatePuzzle(context).join("\n"), /exactUses/);
});

test("Area Number rule filters candidates containing number clues", () => {
  const puzzle = normalizePuzzle({
    width: 3,
    height: 1,
    clues: [{ id: "area_2", type: "cell", ruleId: "area_number", value: 2, location: { type: "cell", cell: 0 } }]
  });
  const context = createRuleContext(puzzle);

  assert.equal(areaNumberRule.candidateFilter(candidate([0, 1], 3), context), true);
  assert.equal(areaNumberRule.candidateFilter(candidate([0], 3), context), false);
  assert.equal(areaNumberRule.candidateFilter(candidate([1], 3), context), true);
});

test("Polyomino rule filters candidates containing shape clues", () => {
  const puzzle = normalizePuzzle({
    width: 2,
    height: 2,
    rules: { polyomino: { allowRotations: false, allowReflections: false } },
    clues: [
      {
        id: "vertical_domino",
        type: "cell",
        ruleId: "polyomino",
        location: { type: "cell", cell: 0 },
        params: { shape: [[0, 0], [0, 1]] }
      }
    ]
  });
  const context = createRuleContext(puzzle);

  assert.equal(polyominoRule.candidateFilter(candidate([0, 2], 2), context), true);
  assert.equal(polyominoRule.candidateFilter(candidate([0, 1], 2), context), false);
});

test("Gemini, Delta, and Difference relation rules add pairwise incompatibilities", () => {
  const candidates = [
    { ...candidate([0], 3), id: 0, shapeKey: "mono", shapeKeyWithReflections: "mono" },
    { ...candidate([1], 3), id: 1, shapeKey: "mono", shapeKeyWithReflections: "mono" },
    { ...candidate([1, 2], 3), id: 2, shapeKey: "domino", shapeKeyWithReflections: "domino" }
  ];

  assertInvalidPairs(geminiRule, "gemini", {}, candidates, [[0, 2]]);
  assertInvalidPairs(deltaRule, "delta", {}, candidates, [[0, 1]]);
  assertInvalidPairs(differenceRule, "difference", { value: 1 }, candidates, [[0, 1]]);
});

test("Match and Mismatch add shape-key pairwise incompatibilities", () => {
  const puzzle = normalizePuzzle({
    width: 3,
    height: 1,
    rules: { match: {}, mismatch: {} }
  });
  const candidates = [
    { ...candidate([0], 3), id: 0 },
    { ...candidate([1], 3), id: 1 },
    { ...candidate([1, 2], 3), id: 2 }
  ];

  const matchContext = createRuleContext(puzzle, { candidates });
  const matchModel = createConstraintModel();
  matchRule.addConstraints(matchModel, matchContext);
  assert.equal(matchModel.invalidPairs.get(0)?.has(2), true);
  assert.equal(matchModel.invalidPairs.get(1)?.has(2), true);

  const mismatchContext = createRuleContext(puzzle, { candidates });
  const mismatchModel = createConstraintModel();
  mismatchRule.addConstraints(mismatchModel, mismatchContext);
  assert.equal(mismatchModel.invalidPairs.get(0)?.has(1), true);
});

test("Range validates bounds and filters inclusive area candidates", () => {
  const context = createRuleContext(
    normalizePuzzle({
      width: 4,
      height: 1,
      rules: { area: 0, range: { min: 2, max: 3 } }
    })
  );

  assert.deepEqual(rangeRule.validatePuzzle(context), []);
  assert.equal(rangeRule.candidateFilter(candidate([0], 4), context), false);
  assert.equal(rangeRule.candidateFilter(candidate([0, 1], 4), context), true);
  assert.equal(rangeRule.candidateFilter(candidate([0, 1, 2], 4), context), true);
  assert.equal(rangeRule.candidateFilter(candidate([0, 1, 2, 3], 4), context), false);

  const invalid = createRuleContext(normalizePuzzle({ width: 1, height: 1, rules: { area: 0, range: { min: 3, max: 2 } } }));
  assert.match(rangeRule.validatePuzzle(invalid).join("\n"), /min.*less than or equal to.*max/);
});

test("Solitude counts implemented cell clues and single-symbol Rose symbols", () => {
  const context = createRuleContext(
    normalizePuzzle({
      width: 3,
      height: 1,
      symbols: { 2: "A" },
      clues: [
        { id: "area", type: "cell", ruleId: "area_number", value: 1, location: { type: "cell", cell: 0 } },
        { id: "poly", type: "cell", ruleId: "polyomino", location: { type: "cell", cell: 1 }, params: { shape: [[0, 0]] } }
      ],
      rules: { area: 0, roseLabels: "A", solitude: {} }
    })
  );

  assert.equal(solitudeRule.candidateFilter(candidate([0], 3), context), true);
  assert.equal(solitudeRule.candidateFilter(candidate([1], 3), context), true);
  assert.equal(solitudeRule.candidateFilter(candidate([2], 3), context), true);
  assert.equal(solitudeRule.candidateFilter(candidate([0, 1], 3), context), false);
});

test("Size Separation rejects equal-area orthogonally adjacent candidate pairs", () => {
  const puzzle = normalizePuzzle({
    width: 3,
    height: 1,
    rules: { size_separation: {} }
  });
  const candidates = [
    { ...candidate([0], 3), id: 0 },
    { ...candidate([1], 3), id: 1 },
    { ...candidate([1, 2], 3), id: 2 }
  ];
  const context = createRuleContext(puzzle, { candidates });
  const model = createConstraintModel();

  sizeSeparationRule.addConstraints(model, context);

  assert.equal(model.invalidPairs.get(0)?.has(1), true);
  assert.equal(model.invalidPairs.get(0)?.has(2), false);
});

test("Boxy and Non-Boxy filter filled rectangles in opposite directions", () => {
  const context = createRuleContext(normalizePuzzle({ width: 3, height: 2, rules: { boxy: {}, non_boxy: {} } }));
  const rectangle = candidate([0, 1, 3, 4], 3);
  const bent = candidate([0, 1, 3], 3);

  assert.equal(boxyRule.candidateFilter(rectangle, context), true);
  assert.equal(boxyRule.candidateFilter(bent, context), false);
  assert.equal(nonBoxyRule.candidateFilter(rectangle, context), false);
  assert.equal(nonBoxyRule.candidateFilter(bent, context), true);
});

test("Boxy and Non-Boxy judge rectangles anywhere on the board, not only at the top-left", () => {
  const context = createRuleContext(normalizePuzzle({ width: 4, height: 3, rules: { boxy: {}, non_boxy: {} } }));
  const lowerRightSquare = candidate([6, 7, 10, 11], 4);
  const offsetBar = candidate([5, 6], 4);
  const offsetBent = candidate([6, 10, 11], 4);

  assert.equal(boxyRule.candidateFilter(lowerRightSquare, context), true);
  assert.equal(boxyRule.candidateFilter(offsetBar, context), true);
  assert.equal(boxyRule.candidateFilter(offsetBent, context), false);
  assert.equal(nonBoxyRule.candidateFilter(lowerRightSquare, context), false);
  assert.equal(nonBoxyRule.candidateFilter(offsetBent, context), true);

  // End to end: a 2x2 board of area-2 rectangles has exactly the two domino tilings.
  const boxy = solvePuzzle({ width: 2, height: 2, rules: { area: 2, boxy: {} } }, { limit: 3 });
  assert.equal(boxy.solutions.length, 2);
  // A lone square away from the corner is a rectangle, so Non-Boxy leaves no solution.
  const nonBoxy = solvePuzzle({ width: 3, height: 3, activeCells: [4, 5, 7, 8], rules: { area: 4, non_boxy: {} } }, { limit: 2 });
  assert.equal(nonBoxy.status, "no_solution");
});

test("Inequality validates directions and rejects incompatible area pairs", () => {
  const candidates = [
    { ...candidate([0], 3), id: 0 },
    { ...candidate([1, 2], 3), id: 1 },
    { ...candidate([1], 3), id: 2 }
  ];

  assertInvalidPairs(inequalityRule, "inequality", { params: { direction: "lt" } }, candidates, [[0, 2]]);

  const invalid = createRuleContext(
    normalizePuzzle({
      width: 2,
      height: 1,
      rules: { inequality: {} },
      clues: [
        {
          id: "bad_inequality",
          type: "relation",
          ruleId: "inequality",
          params: { direction: "sideways" },
          regionRefs: [{ cell: 0 }, { cell: 1 }]
        }
      ]
    })
  );
  assert.match(inequalityRule.validatePuzzle(invalid).join("\n"), /requires params.direction "lt" or "gt"/);
});

test("Palisade recognizes local border pattern classes", () => {
  const puzzle = normalizePuzzle({ width: 3, height: 3, rules: { palisade: {} } });

  assert.equal(candidatePalisadePattern(candidate([0, 1, 2, 3, 4, 5, 6, 7, 8], 3), puzzle, 4), "empty");
  assert.equal(candidatePalisadePattern(candidate([4], 3), puzzle, 4), "full");
  assert.equal(candidatePalisadePattern(candidate([4, 5, 7, 8], 3), puzzle, 4), "corner");
  assert.equal(candidatePalisadePattern(candidate([1, 4, 7], 3), puzzle, 4), "opposite");
  assert.equal(palisadePatternFromSides(new Set(["N"])), "one_sided");
  assert.equal(palisadePatternFromSides(new Set(["N", "E", "S"])), "three_sided");
});

test("Palisade filters candidate regions containing the clue cell", () => {
  const puzzle = normalizePuzzle({
    width: 3,
    height: 3,
    rules: { palisade: {} },
    clues: [
      { id: "corner", type: "cell", ruleId: "palisade", location: { type: "cell", cell: 4 }, params: { pattern: "corner" } }
    ]
  });
  const context = createRuleContext(puzzle);

  assert.equal(palisadeRule.candidateFilter(candidate([4, 5, 7, 8], 3), context), true);
  assert.equal(palisadeRule.candidateFilter(candidate([1, 4, 7], 3), context), false);
  assert.equal(palisadeRule.candidateFilter(candidate([0, 1], 3), context), true);
});

test("Compass counts own-region cells in directional half-planes", () => {
  const puzzle = normalizePuzzle({ width: 3, height: 3, rules: { compass: {} } });
  const counts = compassCounts(candidate([4, 2, 5, 8], 3), puzzle, 4);

  assert.deepEqual(counts, { N: 1, E: 3, S: 1, W: 0 });
});

test("Compass filters supplied directions and ignores missing directions", () => {
  const puzzle = normalizePuzzle({
    width: 3,
    height: 3,
    rules: { compass: {} },
    clues: [
      { id: "east_three", type: "cell", ruleId: "compass", location: { type: "cell", cell: 4 }, params: { E: 3 } }
    ]
  });
  const context = createRuleContext(puzzle);

  assert.equal(compassRule.candidateFilter(candidate([4, 2, 5, 8], 3), context), true);
  assert.equal(compassRule.candidateFilter(candidate([4, 1, 7], 3), context), false);
});

test("Watchtower counts distinct selected regions touching a vertex", () => {
  const puzzle = normalizePuzzle({ width: 2, height: 2, rules: { watchtower: {} } });
  const vertex = { x: 1, y: 1 };

  assert.deepEqual(cellsAroundVertex(puzzle, vertex), [0, 1, 2, 3]);
  assert.equal(distinctRegionsTouchingVertex([candidate([0, 1, 2, 3], 2)], puzzle, vertex), 1);
  assert.equal(distinctRegionsTouchingVertex([candidate([0, 1], 2), candidate([2, 3], 2)], puzzle, vertex), 2);
  assert.equal(
    distinctRegionsTouchingVertex([candidate([0], 2), candidate([1], 2), candidate([2], 2), candidate([3], 2)], puzzle, vertex),
    4
  );
});

test("Watchtower adds a selected-candidate validator for exact vertex counts", () => {
  const candidates = [
    { ...candidate([0], 2), id: 0 },
    { ...candidate([1], 2), id: 1 },
    { ...candidate([2], 2), id: 2 },
    { ...candidate([3], 2), id: 3 }
  ];
  const puzzle = normalizePuzzle({
    width: 2,
    height: 2,
    rules: { watchtower: {} },
    clues: [{ id: "four", type: "vertex", ruleId: "watchtower", location: { type: "vertex", x: 1, y: 1 }, value: 4 }]
  });
  const context = createRuleContext(puzzle, { candidates });
  const model = createConstraintModel();

  watchtowerRule.addConstraints(model, context);

  assert.equal(model.selectionValidators.length, 1);
  assert.equal(model.selectionValidators[0](candidates.slice(0, 3), { complete: false }), true);
  assert.equal(model.selectionValidators[0](candidates, { complete: true }), true);

  const oneRegion = [{ ...candidate([0, 1, 2, 3], 2), id: 4 }];
  assert.equal(model.selectionValidators[0](oneRegion, { complete: true }), false);
});

test("Boundary helpers compute selected border segments and vertex degrees", () => {
  const monomino = normalizePuzzle({ width: 1, height: 1 });
  const monominoCandidates = [candidate([0], 1)];
  assert.deepEqual(selectedBorderSegments(monominoCandidates, monomino), [
    { orientation: "h", x: 0, y: 0 },
    { orientation: "h", x: 0, y: 1 },
    { orientation: "v", x: 0, y: 0 },
    { orientation: "v", x: 1, y: 0 }
  ]);
  assert.equal(vertexBorderDegree(monominoCandidates, monomino, { x: 0, y: 0 }), 2);
  assert.equal(vertexBorderDegree(monominoCandidates, monomino, { x: 1, y: 1 }), 2);

  const fourMonominoes = normalizePuzzle({ width: 2, height: 2 });
  const fourCandidates = [candidate([0], 2), candidate([1], 2), candidate([2], 2), candidate([3], 2)];
  assert.equal(vertexBorderDegree(fourCandidates, fourMonominoes, { x: 1, y: 1 }), 4);

  const tJunctionCandidates = [candidate([0, 1], 2), candidate([2], 2), candidate([3], 2)];
  assert.equal(vertexBorderDegree(tJunctionCandidates, fourMonominoes, { x: 1, y: 1 }), 3);

  const joinedBoard = normalizePuzzle({ width: 2, height: 1 });
  assert.equal(selectedBorderSegments([candidate([0, 1], 2)], joinedBoard).length, 6);
  assert.equal(allVertexBorderDegrees(fourCandidates, fourMonominoes).find((item) => item.x === 1 && item.y === 1)?.degree, 4);
});

test("Bricky forbids degree-4 vertices but allows degree-3 vertices", () => {
  const puzzle = normalizePuzzle({ width: 2, height: 2, rules: { bricky: {} } });
  const fourCandidates = [candidate([0], 2), candidate([1], 2), candidate([2], 2), candidate([3], 2)];
  const tJunctionCandidates = [candidate([0, 1], 2), candidate([2], 2), candidate([3], 2)];
  const model = createConstraintModel();

  brickyRule.addConstraints(model, createRuleContext(puzzle, { candidates: fourCandidates }));

  assert.equal(model.selectionValidators[0](fourCandidates, { complete: true }), false);
  assert.equal(model.selectionValidators[0](tJunctionCandidates, { complete: true }), true);
});

test("Loopy forbids degree-3 vertices but allows degree-4 vertices", () => {
  const puzzle = normalizePuzzle({ width: 2, height: 2, rules: { loopy: {} } });
  const tJunctionCandidates = [candidate([0, 1], 2), candidate([2], 2), candidate([3], 2)];
  const diagonalPuzzle = normalizePuzzle({ width: 2, height: 2, activeCells: [0, 3], rules: { loopy: {} } });
  const diagonalCandidates = [candidate([0], 2), candidate([3], 2)];
  const model = createConstraintModel();
  const diagonalModel = createConstraintModel();

  loopyRule.addConstraints(model, createRuleContext(puzzle, { candidates: tJunctionCandidates }));
  loopyRule.addConstraints(diagonalModel, createRuleContext(diagonalPuzzle, { candidates: diagonalCandidates }));

  assert.equal(model.selectionValidators[0](tJunctionCandidates, { complete: true }), false);
  assert.equal(vertexBorderDegree(diagonalCandidates, diagonalPuzzle, { x: 1, y: 1 }), 4);
  assert.equal(diagonalModel.selectionValidators[0](diagonalCandidates, { complete: true }), true);
});

test("Bricky and Loopy together reject degree-3 and degree-4 vertices", () => {
  const puzzle = normalizePuzzle({ width: 2, height: 2, rules: { bricky: {}, loopy: {} } });
  const diagonalPuzzle = normalizePuzzle({ width: 2, height: 2, activeCells: [0, 3], rules: { bricky: {}, loopy: {} } });
  const diagonalCandidates = [candidate([0], 2), candidate([3], 2)];
  const tJunctionCandidates = [candidate([0, 1], 2), candidate([2], 2), candidate([3], 2)];
  const model = createConstraintModel();
  const diagonalModel = createConstraintModel();
  const context = createRuleContext(puzzle, { candidates: tJunctionCandidates });
  const diagonalContext = createRuleContext(diagonalPuzzle, { candidates: diagonalCandidates });

  brickyRule.addConstraints(model, context);
  loopyRule.addConstraints(model, context);
  brickyRule.addConstraints(diagonalModel, diagonalContext);
  loopyRule.addConstraints(diagonalModel, diagonalContext);

  assert.equal(diagonalModel.selectionValidators.every((validator) => validator(diagonalCandidates, { complete: true })), false);
  assert.equal(model.selectionValidators.every((validator) => validator(tJunctionCandidates, { complete: true })), false);
});

test("Mingle Shape rejects orthogonally adjacent same-shape candidate pairs", () => {
  const puzzle = normalizePuzzle({
    width: 4,
    height: 1,
    rules: { mingle_shape: {} }
  });
  const candidates = [
    { ...candidate([0, 1], 4), id: 0, shapeKey: "domino", shapeKeyWithReflections: "domino" },
    { ...candidate([2, 3], 4), id: 1, shapeKey: "domino", shapeKeyWithReflections: "domino" }
  ];
  const context = createRuleContext(puzzle, { candidates });
  const model = createConstraintModel();

  mingleShapeRule.addConstraints(model, context);

  assert.equal(model.invalidPairs.get(0)?.has(1), true);
});

test("Mingle Shape allows adjacent different-shape candidate pairs", () => {
  const puzzle = normalizePuzzle({
    width: 3,
    height: 2,
    rules: { mingle_shape: {} }
  });
  const candidates = [
    { ...candidate([0, 1], 3), id: 0, shapeKey: "domino", shapeKeyWithReflections: "domino" },
    { ...candidate([2, 5], 3), id: 1, shapeKey: "vertical", shapeKeyWithReflections: "vertical" }
  ];
  const context = createRuleContext(puzzle, { candidates });
  const model = createConstraintModel();

  mingleShapeRule.addConstraints(model, context);

  assert.equal(model.invalidPairs.get(0)?.has(1), undefined);
});

test("Mingle Shape allows non-adjacent duplicate shapes", () => {
  const puzzle = normalizePuzzle({
    width: 5,
    height: 1,
    rules: { mingle_shape: {} }
  });
  const candidates = [
    { ...candidate([0, 1], 5), id: 0, shapeKey: "domino", shapeKeyWithReflections: "domino" },
    { ...candidate([3, 4], 5), id: 1, shapeKey: "domino", shapeKeyWithReflections: "domino" }
  ];
  const context = createRuleContext(puzzle, { candidates });
  const model = createConstraintModel();

  mingleShapeRule.addConstraints(model, context);

  assert.equal(model.invalidPairs.size, 0);
});

test("Mingle Shape rule-specific reflection setting overrides global shape comparison", () => {
  const puzzle = normalizePuzzle({
    width: 6,
    height: 2,
    rules: {
      mingle_shape: { allowReflections: true },
      shapeEquivalenceAllowReflections: false
    }
  });
  const candidates = [
    { ...candidate([1, 2, 6, 7], 6), id: 0 },
    { ...candidate([3, 4, 10, 11], 6), id: 1 }
  ];
  const context = createRuleContext(puzzle, { candidates });
  const model = createConstraintModel();

  mingleShapeRule.addConstraints(model, context);

  assert.equal(model.invalidPairs.get(0)?.has(1), true);
});

test("Mingle Shape falls back to global reflection setting without override", () => {
  const puzzle = normalizePuzzle({
    width: 6,
    height: 2,
    rules: {
      mingle_shape: {},
      shapeEquivalenceAllowReflections: true
    }
  });
  const candidates = [
    { ...candidate([1, 2, 6, 7], 6), id: 0 },
    { ...candidate([3, 4, 10, 11], 6), id: 1 }
  ];
  const context = createRuleContext(puzzle, { candidates });
  const model = createConstraintModel();

  mingleShapeRule.addConstraints(model, context);

  assert.equal(model.invalidPairs.get(0)?.has(1), true);
});

test("Mingle Shape rule-specific reflection false overrides global true", () => {
  const puzzle = normalizePuzzle({
    width: 6,
    height: 2,
    rules: {
      mingle_shape: { allowReflections: false },
      shapeEquivalenceAllowReflections: true
    }
  });
  const candidates = [
    { ...candidate([1, 2, 6, 7], 6), id: 0 },
    { ...candidate([3, 4, 10, 11], 6), id: 1 }
  ];
  const context = createRuleContext(puzzle, { candidates });
  const model = createConstraintModel();

  mingleShapeRule.addConstraints(model, context);

  assert.equal(model.invalidPairs.size, 0);
});

function assertInvalidPairs(rule, ruleId, cluePatch, candidates, expectedPairs) {
  const puzzle = normalizePuzzle({
    width: 3,
    height: 1,
    clues: [
      {
        id: `${ruleId}_relation`,
        type: "relation",
        ruleId,
        location: { type: "edge", cells: [0, 1] },
        regionRefs: [{ cell: 0 }, { cell: 1 }],
        ...cluePatch
      }
    ]
  });
  const context = createRuleContext(puzzle, { candidates });
  const model = createConstraintModel();
  rule.addConstraints(model, context);

  for (const [left, right] of expectedPairs) {
    assert.equal(model.invalidPairs.get(left)?.has(right), true, `${ruleId} should reject ${left}-${right}`);
  }
}

function candidate(cells, width) {
  const shapeCells = cells.map((cell) => [cell % width, Math.floor(cell / width)]);
  return {
    id: -1,
    cells,
    mask: maskFromIndexes(cells),
    area: cells.length,
    shapeCells,
    shapeKey: canonicalShapeKey(shapeCells, { allowRotations: true, allowReflections: false }),
    shapeKeyWithReflections: canonicalShapeKey(shapeCells, { allowRotations: true, allowReflections: true })
  };
}
