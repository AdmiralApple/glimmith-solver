import assert from "node:assert/strict";
import test from "node:test";
import { createPuzzle, setEdgeState, setEdgeRelation } from "../src/core/puzzle.js";
import { solvePuzzle } from "../src/core/solver.js";
import { findNextLogicalStep } from "../src/core/explain.js";

test("2x2 Precision(4) has one four-cell region", () => {
  const puzzle = createPuzzle(2, 2);
  puzzle.rules.area = 4;
  const result = solvePuzzle(puzzle, { limit: 2 });
  assert.equal(result.status, "unique_solution");
  assert.equal(result.solutions[0].regions.length, 1);
  assert.deepEqual(result.solutions[0].regions[0].cells, [0, 1, 2, 3]);
});

test("2x2 Precision(2) has multiple domino partitions", () => {
  const puzzle = createPuzzle(2, 2);
  puzzle.rules.area = 2;
  const result = solvePuzzle(puzzle, { limit: 2 });
  assert.equal(result.status, "multiple_solutions");
  assert.equal(result.solutions[0].regions.length, 2);
});

test("given join constraint can force a unique domino partition", () => {
  let puzzle = createPuzzle(2, 2);
  puzzle.rules.area = 2;
  puzzle = setEdgeState(puzzle, 0, 1, "join");
  const result = solvePuzzle(puzzle, { limit: 2 });
  assert.equal(result.status, "unique_solution");
  assert.deepEqual(result.solutions[0].regions.map((region) => region.cells), [[0, 1], [2, 3]]);
});

test("Rose labels require one of each listed symbol per region", () => {
  const puzzle = createPuzzle(4, 1);
  puzzle.rules.area = 2;
  puzzle.rules.roseLabels = "AB";
  puzzle.symbols = { 0: "A", 1: "B", 2: "A", 3: "B" };
  const result = solvePuzzle(puzzle, { limit: 2 });
  assert.equal(result.status, "unique_solution");
  assert.deepEqual(result.solutions[0].regions.map((region) => region.cells), [[0, 1], [2, 3]]);
});

test("shape bank placements solve a simple square", () => {
  const puzzle = createPuzzle(2, 2);
  puzzle.rules.area = 4;
  puzzle.rules.shapeBankText = "O4: 0,0 1,0 0,1 1,1";
  const result = solvePuzzle(puzzle, { limit: 2 });
  assert.equal(result.status, "unique_solution");
  assert.equal(result.solutions[0].regions.length, 1);
});

test("same-shape relation filters candidate pairs", () => {
  let puzzle = createPuzzle(2, 2);
  puzzle.rules.area = 2;
  puzzle = setEdgeRelation(puzzle, 0, 1, "sameShape");
  const result = solvePuzzle(puzzle, { limit: 2 });
  assert.equal(result.status, "unique_solution");
  assert.deepEqual(result.solutions[0].regions.map((region) => region.cells), [[0, 2], [1, 3]]);
});

test("different-shape relation can prove no solution", () => {
  let puzzle = createPuzzle(2, 2);
  puzzle.rules.area = 2;
  puzzle = setEdgeRelation(puzzle, 0, 1, "differentShape");
  const result = solvePuzzle(puzzle, { limit: 2 });
  assert.equal(result.status, "no_solution");
});

test("generic Difference relation filters candidate pairs", () => {
  const puzzle = createPuzzle(3, 1);
  puzzle.rules.area = 0;
  puzzle.rules.shapeBankText = "M1: 0,0\nI2: 0,0 1,0";
  puzzle.clues = [
    {
      id: "difference_0_1",
      type: "relation",
      ruleId: "difference",
      value: 1,
      location: { type: "outside", side: "top" },
      regionRefs: [{ cell: 0 }, { cell: 1 }]
    }
  ];
  puzzle.rules.difference = {};

  const result = solvePuzzle(puzzle, { limit: 2 });
  assert.equal(result.status, "unique_solution");
  assert.deepEqual(result.solutions[0].regions.map((region) => region.cells), [[0], [1, 2]]);
});

test("Area Number clues can source and filter candidates", () => {
  const puzzle = createPuzzle(3, 1);
  puzzle.rules.area = 0;
  puzzle.clues = [
    { id: "one", type: "cell", ruleId: "area_number", value: 1, location: { type: "cell", cell: 0 } },
    { id: "two", type: "cell", ruleId: "area_number", value: 2, location: { type: "cell", cell: 1 } }
  ];

  const result = solvePuzzle(puzzle, { limit: 2 });
  assert.equal(result.status, "unique_solution");
  assert.deepEqual(result.solutions[0].regions.map((region) => region.cells), [[0], [1, 2]]);
});

test("Precision and Area Number can prove an impossible puzzle", () => {
  const puzzle = createPuzzle(2, 1);
  puzzle.rules.area = 2;
  puzzle.clues = [{ id: "one", type: "cell", ruleId: "area_number", value: 1, location: { type: "cell", cell: 0 } }];

  const result = solvePuzzle(puzzle, { limit: 2 });
  assert.equal(result.status, "no_solution");
});

test("Polyomino clues can source and filter shape candidates", () => {
  const puzzle = createPuzzle(2, 2);
  puzzle.rules.area = 0;
  puzzle.rules.polyomino = { allowRotations: false, allowReflections: false };
  // Each clue only constrains its own region, so both columns need a clue for a unique answer.
  puzzle.clues = [0, 1].map((cell) => ({
    id: `vertical_domino_${cell}`,
    type: "cell",
    ruleId: "polyomino",
    location: { type: "cell", cell },
    params: { shape: [[0, 0], [0, 1]] }
  }));

  const result = solvePuzzle(puzzle, { limit: 2 });
  assert.equal(result.status, "unique_solution");
  assert.deepEqual(result.solutions[0].regions.map((region) => region.cells), [[0, 2], [1, 3]]);
});

test("Polyomino rejects impossible clue shapes", () => {
  const puzzle = createPuzzle(2, 1);
  puzzle.rules.area = 0;
  puzzle.clues = [
    {
      id: "too_large",
      type: "cell",
      ruleId: "polyomino",
      location: { type: "cell", cell: 0 },
      params: { shape: [[0, 0], [1, 0], [2, 0]] }
    }
  ];

  const result = solvePuzzle(puzzle, { limit: 2 });
  assert.equal(result.status, "no_solution");
});

test("Shape Bank allows reflected placements by default", () => {
  const puzzle = createPuzzle(2, 3);
  puzzle.rules.area = 0;
  puzzle.active = [false, true, false, true, true, true];
  puzzle.activeCells = [1, 3, 4, 5];
  puzzle.rules.shapeBankText = "L4: 0,0 0,1 0,2 1,2";

  const result = solvePuzzle(puzzle, { limit: 2 });
  assert.equal(result.status, "unique_solution");
  assert.deepEqual(result.solutions[0].regions.map((region) => region.cells), [[1, 3, 4, 5]]);

  puzzle.rules.allowReflections = false;
  const withoutReflections = solvePuzzle(puzzle, { limit: 2 });
  assert.equal(withoutReflections.status, "no_solution");
});

test("Shape Bank and Gemini interact through configurable shape comparison", () => {
  let puzzle = createPuzzle(2, 2);
  puzzle.rules.area = 2;
  puzzle.rules.shapeBankText = "I2: 0,0 1,0";
  puzzle = setEdgeRelation(puzzle, 0, 1, "sameShape");

  const result = solvePuzzle(puzzle, { limit: 2 });
  assert.equal(result.status, "unique_solution");
  assert.deepEqual(result.solutions[0].regions.map((region) => region.cells), [[0, 2], [1, 3]]);
});

test("Shape Bank and Delta can prove no solution", () => {
  let puzzle = createPuzzle(2, 2);
  puzzle.rules.area = 2;
  puzzle.rules.shapeBankText = "I2: 0,0 1,0";
  puzzle = setEdgeRelation(puzzle, 0, 1, "differentShape");

  const result = solvePuzzle(puzzle, { limit: 2 });
  assert.equal(result.status, "no_solution");
});

test("Gemini and Delta use reflection equivalence by default", () => {
  const geminiDefault = solvePuzzle(mirroredShapeRelationPuzzle("gemini"), { limit: 2 });
  assert.equal(geminiDefault.status, "unique_solution");

  const geminiWithoutReflections = solvePuzzle(mirroredShapeRelationPuzzle("gemini", false), { limit: 2 });
  assert.equal(geminiWithoutReflections.status, "no_solution");

  const deltaDefault = solvePuzzle(mirroredShapeRelationPuzzle("delta"), { limit: 2 });
  assert.equal(deltaDefault.status, "no_solution");

  const deltaWithoutReflections = solvePuzzle(mirroredShapeRelationPuzzle("delta", false), { limit: 2 });
  assert.equal(deltaWithoutReflections.status, "unique_solution");
});

test("Mingle Shape rejects adjacent same-shape regions", () => {
  const puzzle = createPuzzle(4, 1);
  puzzle.rules.area = 2;
  puzzle.rules.mingle_shape = {};

  const result = solvePuzzle(puzzle, { limit: 2 });
  assert.equal(result.status, "no_solution");
});

test("Mingle Shape allows adjacent different-shape regions", () => {
  let puzzle = createPuzzle(3, 3);
  puzzle.rules.area = 3;
  puzzle.rules.mingle_shape = {};
  puzzle.active = [true, true, true, true, true, false, true, false, false];
  puzzle.activeCells = [0, 1, 2, 3, 4, 6];
  puzzle = setEdgeState(puzzle, 0, 3, "join");
  puzzle = setEdgeState(puzzle, 3, 6, "join");
  puzzle = setEdgeState(puzzle, 1, 2, "join");
  puzzle = setEdgeState(puzzle, 1, 4, "join");
  puzzle = setEdgeState(puzzle, 0, 1, "cut");
  puzzle = setEdgeState(puzzle, 3, 4, "cut");

  const result = solvePuzzle(puzzle, { limit: 2 });
  assert.equal(result.status, "unique_solution");
  assert.deepEqual(result.solutions[0].regions.map((region) => region.cells), [[0, 3, 6], [1, 2, 4]]);
});

test("Mingle Shape allows non-adjacent duplicate shapes", () => {
  const puzzle = createPuzzle(5, 1);
  puzzle.rules.area = 2;
  puzzle.rules.mingle_shape = {};
  puzzle.active[2] = false;
  puzzle.activeCells = [0, 1, 3, 4];

  const result = solvePuzzle(puzzle, { limit: 2 });
  assert.equal(result.status, "unique_solution");
  assert.deepEqual(result.solutions[0].regions.map((region) => region.cells), [[0, 1], [3, 4]]);
});

test("Mingle Shape respects reflection equivalence", () => {
  const defaultReflections = solvePuzzle(mirroredMinglePuzzle({}), { limit: 2 });
  assert.equal(defaultReflections.status, "no_solution");

  const withoutReflections = solvePuzzle(mirroredMinglePuzzle({ allowReflections: false }), { limit: 2 });
  assert.equal(withoutReflections.status, "unique_solution");
  assert.deepEqual(withoutReflections.solutions[0].regions.map((region) => region.cells), [
    [1, 2, 6, 7],
    [3, 4, 10, 11]
  ]);

  const withReflections = solvePuzzle(mirroredMinglePuzzle({ allowReflections: true }), { limit: 2 });
  assert.equal(withReflections.status, "no_solution");
});

test("Match requires all regions to share one shape", () => {
  const sameShape = createPuzzle(4, 1);
  sameShape.rules.area = 2;
  sameShape.rules.match = {};
  const allowed = solvePuzzle(sameShape, { limit: 2 });
  assert.equal(allowed.status, "unique_solution");
  assert.deepEqual(allowed.solutions[0].regions.map((region) => region.cells), [[0, 1], [2, 3]]);

  const mixedShapes = forcedMixedTriominoPuzzle();
  mixedShapes.rules.match = {};
  const rejected = solvePuzzle(mixedShapes, { limit: 2 });
  assert.equal(rejected.status, "no_solution");
});

test("Mismatch requires all regions to have distinct shapes", () => {
  const duplicateShape = createPuzzle(4, 1);
  duplicateShape.rules.area = 2;
  duplicateShape.rules.mismatch = {};
  const rejected = solvePuzzle(duplicateShape, { limit: 2 });
  assert.equal(rejected.status, "no_solution");

  const mixedShapes = forcedMixedTriominoPuzzle();
  mixedShapes.rules.mismatch = {};
  const allowed = solvePuzzle(mixedShapes, { limit: 2 });
  assert.equal(allowed.status, "unique_solution");
  assert.deepEqual(allowed.solutions[0].regions.map((region) => region.cells), [[0, 3, 6], [1, 2, 4]]);
});

test("Range can source and filter bounded-area candidates", () => {
  const puzzle = createPuzzle(2, 2);
  puzzle.rules.area = 0;
  puzzle.rules.range = { min: 4, max: 4 };

  const result = solvePuzzle(puzzle, { limit: 2 });
  assert.equal(result.status, "unique_solution");
  assert.deepEqual(result.solutions[0].regions.map((region) => region.cells), [[0, 1, 2, 3]]);
});

test("Solitude requires exactly one counted clue or eligible Rose symbol per region", () => {
  const puzzle = createPuzzle(2, 1);
  puzzle.rules.area = 1;
  puzzle.rules.solitude = {};
  puzzle.clues = [
    { id: "left", type: "cell", ruleId: "area_number", value: 1, location: { type: "cell", cell: 0 } },
    { id: "right", type: "cell", ruleId: "area_number", value: 1, location: { type: "cell", cell: 1 } }
  ];

  const result = solvePuzzle(puzzle, { limit: 2 });
  assert.equal(result.status, "unique_solution");
  assert.equal(result.solutions[0].regions.length, 2);

  puzzle.clues.pop();
  const rejected = solvePuzzle(puzzle, { limit: 2 });
  assert.equal(rejected.status, "no_solution");
});

test("Size Separation rejects equal-area edge-adjacent regions", () => {
  const puzzle = createPuzzle(4, 1);
  puzzle.rules.area = 2;
  puzzle.rules.size_separation = {};

  const result = solvePuzzle(puzzle, { limit: 2 });
  assert.equal(result.status, "no_solution");
});

test("Boxy and Non-Boxy filter rectangular regions", () => {
  const boxy = createPuzzle(2, 2);
  boxy.rules.area = 4;
  boxy.rules.boxy = {};
  const boxyResult = solvePuzzle(boxy, { limit: 2 });
  assert.equal(boxyResult.status, "unique_solution");

  const lTriomino = createPuzzle(2, 2);
  lTriomino.rules.area = 3;
  lTriomino.active = [true, true, true, false];
  lTriomino.activeCells = [0, 1, 2];
  lTriomino.rules.boxy = {};
  const boxyRejected = solvePuzzle(lTriomino, { limit: 2 });
  assert.equal(boxyRejected.status, "no_solution");

  lTriomino.rules.boxy = undefined;
  lTriomino.rules.non_boxy = {};
  const nonBoxyResult = solvePuzzle(lTriomino, { limit: 2 });
  assert.equal(nonBoxyResult.status, "unique_solution");

  const square = createPuzzle(2, 2);
  square.rules.area = 4;
  square.rules.non_boxy = {};
  const nonBoxyRejected = solvePuzzle(square, { limit: 2 });
  assert.equal(nonBoxyRejected.status, "no_solution");
});

test("Inequality relation clues compare referenced region areas", () => {
  const puzzle = createPuzzle(3, 1);
  puzzle.rules.area = 0;
  puzzle.rules.inequality = {};
  puzzle.clues = [
    { id: "one", type: "cell", ruleId: "area_number", value: 1, location: { type: "cell", cell: 0 } },
    { id: "two", type: "cell", ruleId: "area_number", value: 2, location: { type: "cell", cell: 1 } },
    {
      id: "left_less",
      type: "relation",
      ruleId: "inequality",
      params: { direction: "lt" },
      regionRefs: [{ cell: 0 }, { cell: 1 }]
    }
  ];

  const result = solvePuzzle(puzzle, { limit: 2 });
  assert.equal(result.status, "unique_solution");
  assert.deepEqual(result.solutions[0].regions.map((region) => region.cells), [[0], [1, 2]]);

  puzzle.clues[2].params.direction = "gt";
  const rejected = solvePuzzle(puzzle, { limit: 2 });
  assert.equal(rejected.status, "no_solution");
});

test("Inequality edge-location clues compare adjacent region areas", () => {
  const puzzle = createPuzzle(3, 1);
  puzzle.rules.area = 0;
  puzzle.rules.inequality = {};
  puzzle.clues = [
    { id: "one", type: "cell", ruleId: "area_number", value: 1, location: { type: "cell", cell: 0 } },
    { id: "two", type: "cell", ruleId: "area_number", value: 2, location: { type: "cell", cell: 1 } },
    {
      id: "edge_left_less",
      type: "relation",
      ruleId: "inequality",
      location: { type: "edge", cells: [0, 1] },
      params: { direction: "lt" }
    }
  ];

  const result = solvePuzzle(puzzle, { limit: 2 });
  assert.equal(result.status, "unique_solution");
  assert.deepEqual(result.solutions[0].regions.map((region) => region.cells), [[0], [1, 2]]);
});

test("Palisade cell clues filter local side-border patterns", () => {
  const puzzle = createPuzzle(1, 1);
  puzzle.rules.area = 1;
  puzzle.clues = [
    { id: "lonely", type: "cell", ruleId: "palisade", location: { type: "cell", cell: 0 }, params: { pattern: "full" } }
  ];

  const result = solvePuzzle(puzzle, { limit: 2 });
  assert.equal(result.status, "unique_solution");
  assert.deepEqual(result.solutions[0].regions.map((region) => region.cells), [[0]]);

  const impossible = createPuzzle(2, 1);
  impossible.rules.area = 2;
  impossible.clues = [
    { id: "not_lonely", type: "cell", ruleId: "palisade", location: { type: "cell", cell: 0 }, params: { pattern: "full" } }
  ];
  const rejected = solvePuzzle(impossible, { limit: 2 });
  assert.equal(rejected.status, "no_solution");
});

test("Compass cell clues filter directional own-region counts", () => {
  const puzzle = createPuzzle(3, 1);
  puzzle.rules.area = 3;
  puzzle.clues = [
    { id: "east_two", type: "cell", ruleId: "compass", location: { type: "cell", cell: 0 }, params: { E: 2 } }
  ];

  const result = solvePuzzle(puzzle, { limit: 2 });
  assert.equal(result.status, "unique_solution");
  assert.deepEqual(result.solutions[0].regions.map((region) => region.cells), [[0, 1, 2]]);

  puzzle.clues[0].params.E = 1;
  const rejected = solvePuzzle(puzzle, { limit: 2 });
  assert.equal(rejected.status, "no_solution");
});

test("Watchtower vertex clues count distinct touching regions", () => {
  const oneRegion = createPuzzle(2, 2);
  oneRegion.rules.area = 4;
  oneRegion.clues = [
    { id: "one", type: "vertex", ruleId: "watchtower", location: { type: "vertex", x: 1, y: 1 }, value: 1 }
  ];
  const oneResult = solvePuzzle(oneRegion, { limit: 2 });
  assert.equal(oneResult.status, "unique_solution");
  assert.equal(oneResult.solutions[0].regions.length, 1);

  oneRegion.clues[0].value = 2;
  const wrongCount = solvePuzzle(oneRegion, { limit: 2 });
  assert.equal(wrongCount.status, "no_solution");

  const fourRegions = createPuzzle(2, 2);
  fourRegions.rules.area = 1;
  fourRegions.clues = [
    { id: "four", type: "vertex", ruleId: "watchtower", location: { type: "vertex", x: 1, y: 1 }, value: 4 }
  ];
  const fourResult = solvePuzzle(fourRegions, { limit: 2 });
  assert.equal(fourResult.status, "unique_solution");
  assert.equal(fourResult.solutions[0].regions.length, 4);
});

test("Solitude counts Palisade and Compass cell clues", () => {
  const puzzle = createPuzzle(2, 1);
  puzzle.rules.area = 1;
  puzzle.rules.solitude = {};
  puzzle.clues = [
    { id: "palisade", type: "cell", ruleId: "palisade", location: { type: "cell", cell: 0 }, params: { pattern: "full" } },
    { id: "compass", type: "cell", ruleId: "compass", location: { type: "cell", cell: 1 }, params: {} }
  ];

  const result = solvePuzzle(puzzle, { limit: 2 });
  assert.equal(result.status, "unique_solution");
  assert.equal(result.solutions[0].regions.length, 2);

  puzzle.clues.pop();
  const rejected = solvePuzzle(puzzle, { limit: 2 });
  assert.equal(rejected.status, "no_solution");
});

test("Bricky forbids degree-4 boundary vertices only", () => {
  const fourWay = createPuzzle(2, 2);
  fourWay.rules.area = 1;
  fourWay.rules.bricky = {};
  const fourWayRejected = solvePuzzle(fourWay, { limit: 2 });
  assert.equal(fourWayRejected.status, "no_solution");

  const tJunction = forcedTJunctionPuzzle("bricky");
  const allowed = solvePuzzle(tJunction, { limit: 2 });
  assert.equal(allowed.status, "unique_solution");
  assert.deepEqual(allowed.solutions[0].regions.map((region) => region.cells), [[0, 1], [2], [3]]);
});

test("Loopy forbids degree-3 boundary vertices only", () => {
  const tJunction = forcedTJunctionPuzzle("loopy");
  const rejected = solvePuzzle(tJunction, { limit: 2 });
  assert.equal(rejected.status, "no_solution");

  const fourWay = diagonalDegreeFourPuzzle("loopy");
  const allowed = solvePuzzle(fourWay, { limit: 2 });
  assert.equal(allowed.status, "unique_solution");
  assert.equal(allowed.solutions[0].regions.length, 2);
});

test("Bricky and Loopy together reject degree-3 and degree-4 boundary vertices", () => {
  const tJunction = forcedTJunctionPuzzle("bricky");
  tJunction.rules.loopy = {};
  const tRejected = solvePuzzle(tJunction, { limit: 2 });
  assert.equal(tRejected.status, "no_solution");

  const fourWay = diagonalDegreeFourPuzzle("bricky");
  fourWay.rules.loopy = {};
  const fourRejected = solvePuzzle(fourWay, { limit: 2 });
  assert.equal(fourRejected.status, "no_solution");
});

function mirroredMinglePuzzle(mingleConfig) {
  const puzzle = mirroredShapePuzzle();
  puzzle.rules.mingle_shape = mingleConfig;
  return puzzle;
}

function forcedMixedTriominoPuzzle() {
  let puzzle = createPuzzle(3, 3);
  puzzle.rules.area = 3;
  puzzle.active = [true, true, true, true, true, false, true, false, false];
  puzzle.activeCells = [0, 1, 2, 3, 4, 6];
  puzzle = setEdgeState(puzzle, 0, 3, "join");
  puzzle = setEdgeState(puzzle, 3, 6, "join");
  puzzle = setEdgeState(puzzle, 1, 2, "join");
  puzzle = setEdgeState(puzzle, 1, 4, "join");
  puzzle = setEdgeState(puzzle, 0, 1, "cut");
  puzzle = setEdgeState(puzzle, 3, 4, "cut");
  return puzzle;
}

function forcedTJunctionPuzzle(ruleId) {
  let puzzle = createPuzzle(2, 2);
  puzzle.rules.area = 0;
  puzzle.rules[ruleId] = {};
  puzzle.clues = [
    { id: "top_domino", type: "cell", ruleId: "area_number", value: 2, location: { type: "cell", cell: 0 } },
    { id: "bottom_left", type: "cell", ruleId: "area_number", value: 1, location: { type: "cell", cell: 2 } },
    { id: "bottom_right", type: "cell", ruleId: "area_number", value: 1, location: { type: "cell", cell: 3 } }
  ];
  puzzle = setEdgeState(puzzle, 0, 1, "join");
  return puzzle;
}

function diagonalDegreeFourPuzzle(ruleId) {
  const puzzle = createPuzzle(2, 2);
  puzzle.rules.area = 1;
  puzzle.rules[ruleId] = {};
  puzzle.active = [true, false, false, true];
  puzzle.activeCells = [0, 3];
  return puzzle;
}

function mirroredShapeRelationPuzzle(ruleId, allowReflections) {
  const puzzle = mirroredShapePuzzle();
  if (allowReflections !== undefined) puzzle.rules.shapeEquivalenceAllowReflections = allowReflections;
  puzzle.rules[ruleId] = {};
  puzzle.clues = [
    {
      id: `${ruleId}_edge`,
      type: "relation",
      ruleId,
      location: { type: "edge", cells: [2, 3] },
      regionRefs: [{ cell: 2 }, { cell: 3 }]
    }
  ];
  return puzzle;
}

function mirroredShapePuzzle() {
  let puzzle = createPuzzle(6, 2);
  puzzle.rules.area = 4;
  puzzle.active = [
    false, true, true, true, true, false,
    true, true, false, false, true, true
  ];
  puzzle.activeCells = [1, 2, 3, 4, 6, 7, 10, 11];
  puzzle = setEdgeState(puzzle, 1, 2, "join");
  puzzle = setEdgeState(puzzle, 1, 7, "join");
  puzzle = setEdgeState(puzzle, 6, 7, "join");
  puzzle = setEdgeState(puzzle, 3, 4, "join");
  puzzle = setEdgeState(puzzle, 4, 10, "join");
  puzzle = setEdgeState(puzzle, 10, 11, "join");
  puzzle = setEdgeState(puzzle, 2, 3, "cut");
  return puzzle;
}

test("Polyomino clues allow reflected placements by default", () => {
  const puzzle = createPuzzle(2, 3);
  puzzle.rules.area = 0;
  puzzle.active = [false, true, false, true, true, true];
  puzzle.activeCells = [1, 3, 4, 5];
  puzzle.clues = [
    {
      id: "l_clue",
      type: "cell",
      ruleId: "polyomino",
      location: { type: "cell", cell: 1 },
      params: { shape: [[0, 0], [0, 1], [0, 2], [1, 2]] }
    }
  ];

  const result = solvePuzzle(puzzle, { limit: 2 });
  assert.equal(result.status, "unique_solution");
  assert.deepEqual(result.solutions[0].regions.map((region) => region.cells), [[1, 3, 4, 5]]);

  puzzle.clues[0].params.allowReflections = false;
  const withoutReflections = solvePuzzle(puzzle, { limit: 2 });
  assert.equal(withoutReflections.status, "no_solution");
});

test("Polyomino clue placement uses clue reflection settings", () => {
  const basePuzzle = createPuzzle(3, 3);
  basePuzzle.rules.area = 0;
  basePuzzle.rules.polyomino = { allowRotations: false, allowReflections: false };
  basePuzzle.active = [true, true, true, false, true, true, false, false, true];
  basePuzzle.activeCells = [0, 1, 2, 4, 5, 8];
  basePuzzle.clues = [
    {
      id: "left_chiral",
      type: "cell",
      ruleId: "polyomino",
      location: { type: "cell", cell: 0 },
      params: { shape: [[0, 0], [1, 0], [0, 1]], allowRotations: false, allowReflections: false }
    },
    {
      id: "vertical",
      type: "cell",
      ruleId: "polyomino",
      location: { type: "cell", cell: 2 },
      params: { shape: [[0, 0], [0, 1], [0, 2]], allowRotations: false, allowReflections: false }
    }
  ];

  const withoutReflections = solvePuzzle(basePuzzle, { limit: 2 });
  assert.equal(withoutReflections.status, "no_solution");

  const withReflections = createPuzzle(3, 2);
  Object.assign(withReflections, basePuzzle);
  withReflections.clues = [
    {
      ...basePuzzle.clues[0],
      params: { ...basePuzzle.clues[0].params, allowReflections: true }
    },
    basePuzzle.clues[1]
  ];

  const result = solvePuzzle(withReflections, { limit: 2 });
  assert.equal(result.status, "unique_solution");
  assert.deepEqual(result.solutions[0].regions.map((region) => region.cells), [[0, 1, 4], [2, 5, 8]]);
});

test("next-step explainer finds a forced join", () => {
  const puzzle = createPuzzle(2, 2);
  puzzle.rules.area = 4;
  const result = findNextLogicalStep(puzzle);
  assert.equal(result.status, "step");
  assert.equal(result.step.type, "forced_region");
  assert.equal(result.step.proof.result, "all_completions_agree");
  assert.deepEqual(result.step.cells, [0, 1, 2, 3]);
});
