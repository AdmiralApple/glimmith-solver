# Glimmith Solver Prototype

A small browser-based prototype for solving **The Artisan of Glimmith-style** region-division puzzles.

The goal is not to be a complete game solver yet. This repository gives you a working foundation:

- draw an active/inactive stained-glass grid;
- add symbols to cells;
- add manual border givens: cut, join, Gemini/same-shape, Delta/different-shape;
- solve with an exact-cover region solver;
- ask for the next forced border using contradiction checks;
- export/import puzzle JSON.

The app has no runtime dependencies. It is plain HTML/CSS/JavaScript with Node's built-in test runner for the solver tests.

## Run locally

```bash
cd glimmith-solver
npm test
npm start
```

Then open:

```text
http://localhost:5173
```

`npm start` uses a tiny Node static server in `scripts/serve.mjs`, so it works on Windows, macOS, and Linux without installing extra packages.

## What works today

### Rules implemented

| Rule | Status | Notes |
|---|---:|---|
| Active/inactive cells | Implemented | Draw holes or irregular board masks. |
| Precision / exact area | Implemented | Every region candidate must have exactly `area` cells. |
| Shape bank | Implemented | Enter polyomino coordinates; rotations/reflections are optional. |
| Rose labels | Implemented | Each region must contain exactly one of every listed label, such as `ABCD`. |
| Manual walls/join borders | Implemented | Drag corner to corner for walls; use the Join border tool for joins. |
| Gemini / same shape | Implemented | Modeled as a relation on an edge between two regions. |
| Delta / different shape | Implemented | Modeled as a relation on an edge between two regions. |
| Next logic step | Implemented | Tests unknown borders by contradiction and returns a forced join/cut. |

### Shape bank format

Each shape is one line. Coordinates are local `x,y` cells.

```text
O4: 0,0 1,0 0,1 1,1
L4: 0,0 0,1 0,2 1,2
T4: 0,0 1,0 2,0 1,1
```

The shape name is optional but useful for solution summaries.

### Importing puzzles from the game

**Import from game** in the top bar opens puzzles straight from The Artisan of Glimmith. The game keeps each puzzle in its own folder, holding a plain-text `puzzle` file and a binary `metadata` file (title, description, author):

| Puzzles | Folder |
|---|---|
| Made in the in-game editor | `%LOCALAPPDATA%\Geri\Saved\workshop\<puzzle id>\` |
| Subscribed on the Steam Workshop | `<Steam library>\steamapps\workshop\content\4160210\<workshop id>\` |

Choose either `workshop` folder to list every puzzle in it by title, or pick a single `puzzle` file, or paste its text. Files are read in the browser and never uploaded. Your solving progress lives separately in `%LOCALAPPDATA%\Geri\Saved\SaveGames\WorkshopSaveFile.sav` and is not imported.

The reader is `src/core/game-format.js`. The `puzzle` text is a header of rule keywords followed by an ASCII grid:

| Game | Editor |
|---|---|
| `AREA_EQUALS n` | Precision |
| `AREA_AT_LEAST n`, `AREA_AT_MOST n` | Range |
| `SHAPE id rows` + `SHAPE_BANK ids…` | Shape Bank |
| `ALL_SHAPES_SAME` / `ALL_SHAPES_DIFFERENT` | Match / Mismatch |
| `ADJACENT_SHAPES_DIFFERENT` / `ADJACENT_SIZES_DIFFERENT` | Mingle Shape / Size Separation |
| `ONLY_RECTANGLES` / `NO_RECTANGLES` | Boxy / Non-Boxy |
| `ONE_SYMBOL_PER_REGION` | Solitude |
| `NO_4_WAY_INTERSECTIONS` / `NO_3_WAY_INTERSECTIONS` | Bricky / Loopy |
| cell `..` / blank | active / inactive cell |
| cell `05` | Area Number |
| cell `P1`…`P5` | Rose Window symbol A…E |
| cell `S<id>` | Polyomino clue using `SHAPE id` |
| cell `F0 F1 F2 F3 F4 F7` | Palisade: empty, one sided, opposite, three sided, full, corner |
| cell `U<n>D<n>L<n>R<n>` | Compass N/S/W/E (blank = any) |
| border `#` / `##` | wall |
| border `=` `==` / `!` `!!` | Gemini / Delta |
| border `<` `^^` / `>` `vv` | Inequality: the arrow points at the smaller region |
| border digit / `-<n>` | Difference |
| corner digit | Watchtower |

The token meanings were checked against the `SOLUTION` grids of the game's own puzzles.

## How the solver works

There are two solvers; `solvePuzzle` (`src/core/solver.js`) picks one per puzzle.

**Candidate solver (exact cover).** Used when every region a solution could use can be listed up front and the list is small: a Shape Bank, a Precision area under 12, or a Range with a maximum under 12. It lists the region candidates, then solves an exact-cover problem:

```text
Choose region candidates so every active cell is covered exactly once.
```

Local rules, such as area, shape bank, Rose labels, and cut/join borders, filter individual candidates. Gemini/Delta-style shape relations are checked as pairwise constraints between selected candidates.

**Border solver** (`src/core/edge-solver.js`). Used for everything else: no size rule, Polyomino or Area Number clues on only some regions, a Range minimum with no maximum, large regions, or a candidate list that gets cut off. It decides the border between each pair of neighbouring cells (wall or open) instead of listing regions:

- propagation applies sound deductions after every decision (region size bounds, clue placements, Gemini/Difference/Inequality bounds between partner regions, Compass and Palisade counts, areas too small for two regions);
- finished regions are checked with the same rule modules as the candidate solver;
- the search learns from dead ends like a SAT solver: each forced border records why, a contradiction is traced back to a short "nogood", and the search jumps back to where it first applies.

In the app, Solve, Next step and Explain all run in a Web Worker with a time limit (Solver section) and a Cancel button. For border-solver puzzles, Next step reports borders the solver proves directly (by propagation, or because the opposite leads to a contradiction) before falling back to a full solve.

The candidate solver's explanation engine uses a reliable but simple technique:

1. choose an unknown border;
2. assume it is joined;
3. check whether the puzzle still has any solution;
4. assume it is cut;
5. check whether the puzzle still has any solution;
6. when one assumption has zero solutions, the opposite border is forced.

This is not yet a human-style explanation engine, but it gives sound logical steps for many small and medium puzzles.

## Repository layout

```text
.
├── index.html                  # browser app shell
├── styles.css                  # app styling
├── scripts/serve.mjs           # tiny local static server
├── AGENTS.md                   # instructions for coding agents
├── codex-prompts/
│   └── 01-continue-mvp.md      # prompt for continuing the project with Codex
├── src/
│   ├── core/
│   │   ├── candidates.js       # region candidate generation and local filters
│   │   ├── edge-solver.js      # border solver with propagation and conflict learning
│   │   ├── explain.js          # forced-border explanation search
│   │   ├── game-format.js      # reader for The Artisan of Glimmith puzzle files
│   │   ├── geometry.js         # grid, shape, mask helpers
│   │   ├── puzzle.js           # puzzle model, JSON normalization, shape parsing
│   │   └── solver.js           # picks a solver; exact-cover backtracking solver
│   └── ui/
│       ├── app.js              # SVG editor and UI event handling
│       └── solver-worker.js    # runs Solve / Next step / Explain all off the main thread
└── test/
    └── solver.test.js          # core solver tests
```

## Recommended next milestones

1. **Screenshot tracing**: allow importing a screenshot as a low-opacity background behind the SVG grid, with grid offset/scale controls.
2. **Visual shape-bank editor**: let the user draw allowed shapes instead of typing coordinate lines.
3. **Rule plug-in interface**: formalize the current filters and pairwise constraints into classes/functions so new Glimmith rules are easy to add.
4. **More explanation types**: explain candidate eliminations, forced regions, and symbol-set deductions, not only forced borders.
5. **More game rules**: add Area Number, Match/Mismatch, Polyomino-specific constraints, Solitude/Palisade-like constraints if needed.
6. **Performance**: add better pruning and optional Web Worker execution so bigger boards do not freeze the UI.

## Known limitations

- The UI is manual drawing only; there is no OCR or automatic screenshot parsing yet.
- Gemini/Delta clues are modeled as edge relations between adjacent cells. If the game uses a clue placement that refers to regions in a different geometric way, add that interpretation as a new relation type.
- Candidate generation can grow quickly for large area-only boards; those puzzles go to the border solver. Shape-bank puzzles are much faster because placements are finite and constrained.
- Very open puzzles can still exceed the time limit. For example, an 18x13 game puzzle with a 59-cell region and many clue-free regions is not solved within a minute yet; Next step still finds proven borders on it.
- A clue constrains only its own region. Puzzles where some regions have no clue therefore often have more solutions than the clues suggest.
- The app currently uses square cells. If a puzzle has non-rectangular visual artwork, represent it as a square-grid mask for now.

## Development notes

Run tests after solver changes:

```bash
npm test
```

The project intentionally avoids a build system. If you add TypeScript, React, OR-Tools, Vite, or a backend, do it as a conscious architecture change and update this README.
