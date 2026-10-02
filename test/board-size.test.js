import assert from "node:assert/strict";
import test from "node:test";
import { createPuzzle, resizePuzzle } from "../src/core/puzzle.js";
import { boardSizeWarning, parseBoardDimension } from "../src/ui/board-size.js";

test("board dimensions have no upper cap", () => {
  assert.equal(parseBoardDimension("40", 6), 40);
  assert.equal(parseBoardDimension("200", 6), 200);
  assert.equal(parseBoardDimension("7.9", 6), 7);
  assert.equal(parseBoardDimension("0", 6), 6);
  assert.equal(parseBoardDimension("", 6), 6);
  assert.equal(parseBoardDimension("abc", 6), 6);

  const big = resizePuzzle(createPuzzle(6, 6), 20, 18, { fillNew: true });
  assert.deepEqual([big.width, big.height, big.active.length], [20, 18, 360]);
});

test("large boards get a warning, normal ones do not", () => {
  assert.equal(boardSizeWarning(6, 6), "");
  assert.equal(boardSizeWarning(14, 14), "");
  assert.equal(boardSizeWarning(30, 5), "");
  assert.match(boardSizeWarning(15, 14), /large board/);
  assert.match(boardSizeWarning(60, 60), /very large/);
});
