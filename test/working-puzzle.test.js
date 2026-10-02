import assert from "node:assert/strict";
import test from "node:test";
import { createPuzzle, toggleCellActive } from "../src/core/puzzle.js";
import { clearWorkingPuzzle, loadWorkingPuzzle, saveWorkingPuzzle } from "../src/ui/working-puzzle.js";

test("working puzzle round-trips through storage", () => {
  const storage = memoryStorage();
  assert.equal(loadWorkingPuzzle(storage), null);

  const puzzle = toggleCellActive(createPuzzle(5, 4), 3);
  assert.equal(saveWorkingPuzzle(puzzle, storage), true);
  const restored = loadWorkingPuzzle(storage);
  assert.equal(restored.width, 5);
  assert.equal(restored.height, 4);
  assert.equal(restored.active[3], false);

  clearWorkingPuzzle(storage);
  assert.equal(loadWorkingPuzzle(storage), null);
});

test("working puzzle ignores corrupt data and unavailable storage", () => {
  const storage = memoryStorage();
  storage.setItem("glimmith.workingPuzzle.v1", "{not json");
  assert.equal(loadWorkingPuzzle(storage), null);

  const broken = {
    getItem() { throw new Error("blocked"); },
    setItem() { throw new Error("quota"); },
    removeItem() { throw new Error("blocked"); }
  };
  assert.equal(loadWorkingPuzzle(broken), null);
  assert.equal(saveWorkingPuzzle(createPuzzle(2, 2), broken), false);
  assert.doesNotThrow(() => clearWorkingPuzzle(broken));
});

function memoryStorage() {
  const data = new Map();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key)
  };
}
