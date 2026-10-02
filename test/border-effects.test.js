import assert from "node:assert/strict";
import test from "node:test";
import { borderEffectsOnEdge, createPuzzle, placeBorderEffect, removeBorderEffects, setEdgeRelation } from "../src/core/puzzle.js";
import { applyWallSegment } from "../src/ui/hotkeys.js";

function relation(ruleId, a, b, extra = {}) {
  return {
    id: `relation:${ruleId}:${a}-${b}`,
    type: "relation",
    ruleId,
    location: { type: "edge", cells: [a, b] },
    regionRefs: [{ cell: a }, { cell: b }],
    ...extra
  };
}

test("placing a border effect also places a wall", () => {
  const next = placeBorderEffect(createPuzzle(3, 3), relation("gemini", 0, 1));
  assert.equal(next.edges["0-1"].state, "cut");
  assert.deepEqual(borderEffectsOnEdge(next, 0, 1).map((clue) => clue.ruleId), ["gemini"]);
  assert.ok(next.rules.gemini);
});

test("a border holds only one effect; placing another replaces it", () => {
  let puzzle = placeBorderEffect(createPuzzle(3, 3), relation("gemini", 0, 1));
  puzzle = placeBorderEffect(puzzle, relation("delta", 0, 1));
  puzzle = placeBorderEffect(puzzle, relation("difference", 1, 0, { value: 2, params: { difference: 2 } }));
  const effects = borderEffectsOnEdge(puzzle, 0, 1);
  assert.equal(effects.length, 1);
  assert.equal(effects[0].ruleId, "difference");
  // Effects on other borders are untouched.
  puzzle = placeBorderEffect(puzzle, relation("delta", 1, 2));
  assert.equal(borderEffectsOnEdge(puzzle, 0, 1).length, 1);
  assert.equal(borderEffectsOnEdge(puzzle, 1, 2).length, 1);
});

test("placing an effect replaces a legacy edge-mark relation too", () => {
  const legacy = setEdgeRelation(createPuzzle(3, 3), 0, 1, "sameShape");
  assert.equal(borderEffectsOnEdge(legacy, 0, 1).length, 1);
  const next = placeBorderEffect(legacy, relation("delta", 0, 1));
  assert.deepEqual(borderEffectsOnEdge(next, 0, 1).map((clue) => clue.ruleId), ["delta"]);
  assert.equal(next.edges["0-1"].relation, null);
});

test("removing border effects keeps the wall", () => {
  const placed = placeBorderEffect(createPuzzle(3, 3), relation("delta", 0, 1));
  const removed = removeBorderEffects(placed, 0, 1);
  assert.equal(borderEffectsOnEdge(removed, 0, 1).length, 0);
  assert.equal(removed.edges["0-1"].state, "cut");
  assert.equal(removeBorderEffects(removed, 0, 1), removed);
});

test("erasing a wall with a stroke removes its border effect", () => {
  const placed = placeBorderEffect(createPuzzle(3, 3), relation("gemini", 0, 1));
  // The border between cells 0 and 1 runs from corner (1,0) to corner (1,1).
  const erased = applyWallSegment(placed, { x: 1, y: 0 }, { x: 1, y: 1 });
  assert.equal(erased.mode, "erase");
  assert.equal(erased.puzzle.edges["0-1"]?.state ?? null, null);
  assert.equal(borderEffectsOnEdge(erased.puzzle, 0, 1).length, 0);
});
