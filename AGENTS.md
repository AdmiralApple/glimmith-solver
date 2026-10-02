# Glimmith Solver agent notes

This repository is a dependency-light browser prototype. Keep it that way unless a feature clearly needs a build step.

## Commands

- `npm test` runs the core solver tests using Node's built-in test runner.
- `npm start` serves the app at `http://localhost:5173` using Python's static HTTP server.

## Coding style

- Use ES modules and plain JavaScript with JSDoc-style comments where helpful.
- Keep solver logic in `src/core/` and UI logic in `src/ui/`.
- Prefer small, testable pure functions in the core.
- Do not introduce framework dependencies before the visual editor requirements are stable.

## Solver design

The central abstraction is a region candidate: a connected set of active cells that satisfies local rules. The solver chooses candidates so every active cell is covered exactly once. New rule types should usually be implemented as either:

1. a candidate filter, or
2. a pairwise/multi-region constraint checked during exact-cover search.

`solvePuzzle` uses the exact-cover candidate solver only when the candidate plan lists every possible region (Shape Bank, small Precision, bounded Range); otherwise it uses the border solver in `src/core/edge-solver.js`, which checks finished regions with the same filters and constraints. A new rule works in both as long as its candidate filter and constraints are correct; the border solver just learns about it later in the search. Optional propagation in `edge-solver.js` makes a rule prune earlier; any border it forces must record a reason (the literals that force it) or leave the reason undefined, which falls back to "all guesses so far".

When adding a rule, add at least one test that proves the rule can eliminate an otherwise valid solution.
