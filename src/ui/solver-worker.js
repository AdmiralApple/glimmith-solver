import { solvePuzzle } from "../core/solver.js";
import { explainAllLogicalSteps, findNextLogicalStep } from "../core/explain.js";

/**
 * Runs solver tasks off the main thread so long searches never freeze the page and can be
 * cancelled (the page terminates this worker). Messages: { id, task, puzzle, options }.
 */
const TASKS = {
  solve: solvePuzzle,
  nextStep: findNextLogicalStep,
  explainAll: explainAllLogicalSteps
};

self.addEventListener("message", (event) => {
  const { id, task, puzzle, options } = event.data;
  try {
    const run = TASKS[task];
    if (!run) throw new Error(`Unknown solver task "${task}".`);
    self.postMessage({ id, ok: true, result: run(puzzle, options) });
  } catch (error) {
    self.postMessage({ id, ok: false, error: error?.message ?? String(error) });
  }
});
