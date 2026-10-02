import assert from "node:assert/strict";
import test from "node:test";
import { forcedBorders, solveByBorders } from "../src/core/edge-solver.js";
import { findNextLogicalStep } from "../src/core/explain.js";
import { createPuzzle, normalizePuzzle } from "../src/core/puzzle.js";
import { chooseSolverEngine, solvePuzzle } from "../src/core/solver.js";
import { EXAMPLES } from "../src/ui/examples.js";

const allSolutions = (result) =>
  result.solutions
    .map((solution) => JSON.stringify(solution.regions.map((region) => region.cells.join(",")).sort()))
    .sort()
    .join("|");

test("border solver finds exactly the candidate solver's solutions on every example", () => {
  for (const example of EXAMPLES) {
    const candidates = solvePuzzle(example.puzzle, { limit: 5, engine: "candidates" });
    const borders = solveByBorders(example.puzzle, { limit: 5 });
    assert.equal(borders.status, candidates.status, `${example.id} status`);
    assert.equal(allSolutions(borders), allSolutions(candidates), `${example.id} solutions`);
  }
});

test("puzzles without a size rule are solved instead of reported impossible", () => {
  // Rose Windows only: every region needs one A and one B.
  const puzzle = { width: 4, height: 1, symbols: { 0: "A", 1: "B", 2: "A", 3: "B" }, rules: { area: 0, roseLabels: "AB" } };
  assert.equal(chooseSolverEngine(normalizePuzzle(puzzle)), "borders");
  const result = solvePuzzle(puzzle, { limit: 2 });
  assert.equal(result.status, "unique_solution");
  assert.deepEqual(result.solutions[0].regions.map((region) => region.cells), [[0, 1], [2, 3]]);
});

test("a clue constrains only its own region", () => {
  // One vertical-domino clue on a 2x2 board: the other column may be one domino or two single cells.
  const puzzle = createPuzzle(2, 2);
  puzzle.rules.area = 0;
  puzzle.rules.polyomino = {};
  puzzle.clues = [
    { id: "domino", type: "cell", ruleId: "polyomino", location: { type: "cell", cell: 0 }, params: { shape: [[0, 0], [0, 1]], allowRotations: false, allowReflections: false } }
  ];
  const result = solvePuzzle(puzzle, { limit: 5 });
  assert.equal(result.status, "multiple_solutions");
  assert.equal(result.solutions.length, 2);
});

test("a minimum region size with no maximum is handled on a larger board", () => {
  const puzzle = createPuzzle(8, 8);
  puzzle.rules.area = 0;
  puzzle.rules.range = { min: 30 };
  // 64 cells and regions of at least 30: one region of 64, or two regions of 30-34 cells.
  const result = solvePuzzle(puzzle, { limit: 2, maxMillis: 10000 });
  assert.equal(result.status, "multiple_solutions");
  for (const solution of result.solutions) {
    for (const region of solution.regions) assert.ok(region.cells.length >= 30);
  }
});

test("an area too small for two regions is proven to be one region", () => {
  const puzzle = createPuzzle(2, 2);
  puzzle.rules.area = 4;
  const proven = forcedBorders(puzzle);
  assert.equal(proven.ok, true);
  assert.deepEqual(proven.forced.map((item) => item.state), ["join", "join", "join", "join"]);
});

test("proven borders agree with the unique solution", () => {
  for (const example of EXAMPLES) {
    const result = solvePuzzle(example.puzzle, { limit: 2 });
    if (result.status !== "unique_solution") continue;
    const regionByCell = result.solutions[0].regionByCell;
    for (const { a, b, state } of forcedBorders(example.puzzle).forced) {
      assert.equal(state, regionByCell[a] === regionByCell[b] ? "join" : "cut", `${example.id} ${a}-${b}`);
    }
  }
});

test("next step on a border-solver puzzle is a proven border", () => {
  const puzzle = {
    width: 3,
    height: 1,
    rules: { area: 0, area_number: {} },
    clues: [
      { id: "one", type: "cell", ruleId: "area_number", value: 1, location: { type: "cell", cell: 0 } },
      { id: "two", type: "cell", ruleId: "area_number", value: 2, location: { type: "cell", cell: 1 } }
    ]
  };
  const result = findNextLogicalStep(puzzle);
  assert.equal(result.status, "step");
  assert.ok(["forced_cut", "forced_join"].includes(result.step.type));
});

test("the time limit stops a long search", () => {
  const puzzle = createPuzzle(14, 14);
  puzzle.rules.area = 0;
  puzzle.rules.range = { min: 3 };
  const started = Date.now();
  const result = solveByBorders(puzzle, { limit: 1000000, maxMillis: 200 });
  assert.ok(Date.now() - started < 5000);
  assert.equal(result.status, "search_limit");
  assert.equal(result.truncated, true);
});
