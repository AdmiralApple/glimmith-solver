import assert from "node:assert/strict";
import test from "node:test";
import { createPuzzle } from "../src/core/puzzle.js";
import { applyWallSegment, cornersCrossed, dragBorderEdges, locateBoardPoint, resolveHotkey } from "../src/ui/hotkeys.js";

const puzzle = createPuzzle(4, 3);
// cell (x, y) spans pixels 10 + 46x .. 10 + 46(x+1)

test("locateBoardPoint distinguishes vertices, borders and cells", () => {
  assert.deepEqual(locateBoardPoint({ x: 56, y: 56 }, puzzle), { type: "vertex", x: 1, y: 1 });
  const edge = locateBoardPoint({ x: 56, y: 33 }, puzzle);
  assert.equal(edge.type, "edge");
  assert.deepEqual([edge.a, edge.b], [0, 1]);
  const cell = locateBoardPoint({ x: 33, y: 33 }, puzzle);
  assert.equal(cell.type, "cell");
  assert.equal(cell.cell, 0);
  assert.equal(locateBoardPoint({ x: 400, y: 20 }, puzzle), null);
});

test("corners are selected within 0.2 of a tile, and only then", () => {
  // Vertex (1,1) sits at pixel (56, 56); 0.2 of a 46px tile is 9.2px.
  assert.equal(locateBoardPoint({ x: 56 + 6, y: 56 + 6 }, puzzle).type, "vertex");
  assert.equal(locateBoardPoint({ x: 56 + 9, y: 56 }, puzzle).type, "vertex");
  assert.notEqual(locateBoardPoint({ x: 56 + 10, y: 56 }, puzzle).type, "vertex");
  assert.notEqual(locateBoardPoint({ x: 56 + 8, y: 56 + 8 }, puzzle).type, "vertex");
});

test("borders next to an inactive cell are not hoverable", () => {
  const holed = { ...puzzle, active: puzzle.active.map((value, i) => (i === 1 ? false : value)) };
  assert.equal(locateBoardPoint({ x: 56, y: 33 }, holed).type, "cell");
});

test("dragBorderEdges returns the cell pairs crossed by a straight drag", () => {
  assert.deepEqual(dragBorderEdges({ x: 0, y: 1 }, { x: 2, y: 1 }, puzzle), [[0, 4], [1, 5]]);
  assert.deepEqual(dragBorderEdges({ x: 1, y: 3 }, { x: 1, y: 0 }, puzzle), [[0, 1], [4, 5], [8, 9]]);
  assert.deepEqual(dragBorderEdges({ x: 0, y: 0 }, { x: 1, y: 1 }, puzzle), []);
  assert.deepEqual(dragBorderEdges({ x: 0, y: 0 }, { x: 2, y: 0 }, puzzle), []);
});

test("digits depend on what is hovered", () => {
  const cell = { type: "cell", cell: 5, side: "N" };
  const edge = { type: "edge", a: 1, b: 2, cell: 1, side: "E" };
  const vertex = { type: "vertex", x: 1, y: 1 };
  assert.deepEqual(resolveHotkey("7", { target: cell, width: 4 }), { type: "areaNumber", cell: 5, digit: 7 });
  assert.deepEqual(resolveHotkey("3", { target: edge, width: 4 }), { type: "difference", a: 1, b: 2, value: 3 });
  assert.deepEqual(resolveHotkey("2", { target: vertex, width: 4 }), { type: "watchtower", vertex: { x: 1, y: 1 }, value: 2 });
  assert.equal(resolveHotkey("5", { target: vertex, width: 4 }), null);
});

test("mode keys redirect digits", () => {
  const cell = { type: "cell", cell: 5, side: "W" };
  assert.deepEqual(resolveHotkey("w", { target: cell, width: 4 }), { type: "setMode", mode: "rose" });
  assert.deepEqual(resolveHotkey("3", { target: cell, mode: "rose", width: 4 }), { type: "rose", cell: 5, symbol: "C" });
  assert.equal(resolveHotkey("6", { target: cell, mode: "rose", width: 4 }), null);
  assert.deepEqual(resolveHotkey("4", { target: cell, mode: "palisade", width: 4 }), { type: "palisade", cell: 5, pattern: "full" });
  assert.equal(resolveHotkey("2", { target: cell, mode: "palisade", width: 4 }).pattern, "corner");
  assert.equal(resolveHotkey("2", { target: cell, mode: "palisade", width: 4, currentPalisade: "corner" }).pattern, "opposite");
  assert.deepEqual(resolveHotkey("9", { target: cell, mode: "compass", width: 4 }), { type: "compass", cell: 5, side: "W", value: 9 });
});

test("arrow keys set inequality direction by edge orientation", () => {
  const horizontal = { type: "edge", a: 1, b: 2, cell: 1, side: "E" };
  const vertical = { type: "edge", a: 1, b: 5, cell: 1, side: "S" };
  assert.equal(resolveHotkey("ArrowLeft", { target: horizontal, width: 4 }).direction, "lt");
  assert.equal(resolveHotkey("ArrowRight", { target: horizontal, width: 4 }).direction, "gt");
  assert.equal(resolveHotkey("ArrowUp", { target: horizontal, width: 4 }), null);
  assert.equal(resolveHotkey("ArrowDown", { target: vertical, width: 4 }).direction, "gt");
});

test("D, G, P and Delete resolve to editor actions", () => {
  const edge = { type: "edge", a: 1, b: 2, cell: 1, side: "E" };
  assert.deepEqual(resolveHotkey("d", { target: edge, width: 4 }), { type: "relation", ruleId: "delta", a: 1, b: 2 });
  assert.deepEqual(resolveHotkey("G", { target: null, width: 4 }), { type: "selectRelation", ruleId: "gemini" });
  assert.deepEqual(resolveHotkey("p", { target: { type: "cell", cell: 3 }, width: 4 }), { type: "polyomino", cell: 3 });
  assert.equal(resolveHotkey("Delete", { target: null, width: 4 }), null);
  assert.equal(resolveHotkey("Delete", { target: edge, width: 4 }).type, "delete");
});

test("cornersCrossed finds every corner on a fast straight move", () => {
  // One pointer jump from vertex (0,1) to vertex (3,1) along the grid line y=1.
  const v = (x, y) => ({ x: 10 + 46 * x, y: 10 + 46 * y });
  assert.deepEqual(cornersCrossed(v(0, 1), v(3, 1), puzzle), [{ x: 0, y: 1 }, { x: 1, y: 1 }, { x: 2, y: 1 }, { x: 3, y: 1 }]);
  // Moving through a cell's middle enters no corner.
  assert.deepEqual(cornersCrossed({ x: 20, y: 33 }, { x: 45, y: 33 }, puzzle), []);
});

test("applyWallSegment draws, then a stroke that starts on a wall erases", () => {
  const drawn = applyWallSegment(puzzle, { x: 1, y: 0 }, { x: 1, y: 1 });
  assert.equal(drawn.mode, "draw");
  assert.equal(drawn.changed, true);
  assert.equal(drawn.puzzle.edges["0-1"].state, "cut");

  const erased = applyWallSegment(drawn.puzzle, { x: 1, y: 0 }, { x: 1, y: 1 });
  assert.equal(erased.mode, "erase");
  assert.equal(erased.puzzle.edges["0-1"]?.state ?? null, null);

  // In draw mode an existing wall is left alone; in erase mode empty borders stay empty.
  assert.equal(applyWallSegment(drawn.puzzle, { x: 1, y: 0 }, { x: 1, y: 1 }, "draw").changed, false);
  assert.equal(applyWallSegment(puzzle, { x: 2, y: 0 }, { x: 2, y: 1 }, "erase").changed, false);

  // Perimeter segments have no border between two cells and do not fix the mode.
  const perimeter = applyWallSegment(puzzle, { x: 0, y: 0 }, { x: 1, y: 0 });
  assert.deepEqual([perimeter.mode, perimeter.changed], [null, false]);
});
