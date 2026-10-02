import assert from "node:assert/strict";
import test from "node:test";
import { parseGameMetadata, parseGamePuzzle } from "../src/core/game-format.js";
import { solvePuzzle } from "../src/core/solver.js";
import { groupGamePuzzleFiles } from "../src/ui/game-import.js";

// Hand-written puzzles in the game's text format (CRLF like the game writes).
const crlf = (lines) => lines.join("\r\n");

const KITCHEN_SINK = crlf([
  "VERSION 1",
  "PUZZLE_VERSION 1",
  "DIFFICULTY 4",
  "COMMENT anything here is ignored",
  "SHAPE 1 2",
  "##",
  "# ",
  "SHAPE 2 1",
  "##",
  "SHAPE_BANK 1 2",
  "AREA_AT_LEAST 2",
  "AREA_AT_MOST 4",
  "ADJACENT_SIZES_DIFFERENT",
  "NO_4_WAY_INTERSECTIONS",
  "DIMENSIONS 4 3",
  "PUZZLE",
  "+--+--+--3--+",
  "|05#P1=F7!S1|",
  "+--+##+^^+-2+",
  "|..<UD1LR>..2..|",
  "+vv+==+!!+--+",
  "|P2|..|..|  |",
  "+--+--+--+  +"
]);

test("parses rules, shapes and the shape bank from the header", () => {
  const { puzzle, difficulty, warnings } = parseGamePuzzle(KITCHEN_SINK);
  assert.deepEqual(warnings, []);
  assert.equal(difficulty, 4);
  assert.deepEqual([puzzle.width, puzzle.height], [4, 3]);
  assert.deepEqual(puzzle.rules.range, { min: 2, max: 4 });
  assert.ok(puzzle.rules.size_separation);
  assert.ok(puzzle.rules.bricky);
  assert.equal(puzzle.rules.shapeBankText, "S1: 0,0 1,0 0,1\nS2: 0,0 1,0");
});

test("parses cells: inactive, area number, rose symbols, palisade, polyomino, compass", () => {
  const { puzzle } = parseGamePuzzle(KITCHEN_SINK);
  const clue = (ruleId, cell) => puzzle.clues.find((c) => c.ruleId === ruleId && c.location?.cell === cell);
  assert.equal(puzzle.active[11], false);
  assert.equal(puzzle.active.filter(Boolean).length, 11);
  assert.equal(clue("area_number", 0).value, 5);
  assert.equal(puzzle.symbols[1], "A");
  assert.equal(puzzle.symbols[8], "B");
  assert.equal(puzzle.rules.roseLabels, "AB");
  assert.equal(clue("palisade", 2).params.pattern, "corner");
  assert.deepEqual(clue("polyomino", 3).params.shape, [[0, 0], [1, 0], [0, 1]]);
  // Compass: U/D/L/R become N/S/W/E; blank directions are unconstrained.
  assert.deepEqual(clue("compass", 5).params, { S: 1 });
});

test("a wide compass token does not shift the cells after it", () => {
  const { puzzle } = parseGamePuzzle(KITCHEN_SINK);
  // Row 1 is "..<UD1LR>..2.." : cells 4,5,6,7 with borders <, >, 2 between them.
  const relation = (ruleId, a, b) => puzzle.clues.find((c) => c.ruleId === ruleId && c.location.cells[0] === a && c.location.cells[1] === b);
  assert.equal(relation("inequality", 4, 5).params.direction, "lt");
  assert.equal(relation("inequality", 5, 6).params.direction, "gt");
  assert.equal(relation("difference", 6, 7).value, 2);
});

test("parses borders: walls, Gemini, Delta, Inequality, Difference, and watchtower corners", () => {
  const { puzzle } = parseGamePuzzle(KITCHEN_SINK);
  const relation = (ruleId, a, b) => puzzle.clues.find((c) => c.ruleId === ruleId && c.location.cells[0] === a && c.location.cells[1] === b);
  assert.equal(puzzle.edges["0-1"].state, "cut");
  assert.ok(relation("gemini", 1, 2));
  assert.ok(relation("delta", 2, 3));
  assert.equal(puzzle.edges["1-5"].state, "cut");
  assert.equal(relation("inequality", 2, 6).params.direction, "lt"); // ^^ : top is smaller
  assert.equal(relation("difference", 3, 7).value, 2); // -2
  assert.equal(relation("inequality", 4, 8).params.direction, "gt"); // vv : top is larger
  assert.ok(relation("gemini", 5, 9));
  assert.ok(relation("delta", 6, 10));
  // Every border effect sits on a wall.
  for (const clue of puzzle.clues.filter((c) => c.type === "relation")) {
    const [a, b] = clue.location.cells;
    assert.equal(puzzle.edges[`${a}-${b}`]?.state, "cut", clue.id);
  }
  const tower = puzzle.clues.find((c) => c.ruleId === "watchtower");
  assert.deepEqual([tower.location.x, tower.location.y, tower.value], [3, 0, 3]);
});

test("an imported puzzle solves to the game's own SOLUTION grid", () => {
  const text = crlf([
    "VERSION 1",
    "DIFFICULTY 1",
    "AREA_EQUALS 2",
    "DIMENSIONS 2 2",
    "PUZZLE",
    "+--+--+",
    "|..|..|",
    "+--+-0+",
    "|..|..|",
    "+--+--+",
    "SOLUTION",
    "+##+##+",
    "#     #",
    "+##+##+",
    "#     #",
    "+##+##+"
  ]);
  const { puzzle, solutionWalls } = parseGamePuzzle(text);
  assert.deepEqual([...solutionWalls].sort(), ["0-2", "1-3"]);
  const result = solvePuzzle(puzzle, { limit: 2 });
  assert.equal(result.status, "unique_solution");
  const regionByCell = result.solutions[0].regionByCell;
  assert.equal(regionByCell[0], regionByCell[1]);
  assert.equal(regionByCell[2], regionByCell[3]);
  assert.notEqual(regionByCell[0], regionByCell[2]);
});

test("unknown marks are skipped with a warning instead of failing", () => {
  const text = crlf(["VERSION 1", "SOMETHING_NEW 3", "DIMENSIONS 2 1", "PUZZLE", "+--+--+", "|..?Q9|", "+--+--+"]);
  const { puzzle, warnings } = parseGamePuzzle(text);
  assert.equal(puzzle.width, 2);
  assert.equal(warnings.length, 2);
  assert.match(warnings[0], /SOMETHING_NEW/);
  assert.match(warnings[1], /"\?"/);
});

test("text that is not a game puzzle is rejected with a clear message", () => {
  assert.throws(() => parseGamePuzzle("hello"), /no DIMENSIONS/);
  assert.throws(() => parseGamePuzzle("DIMENSIONS 2 2\n"), /no PUZZLE grid/);
});

test("metadata yields the id, title, description and author", () => {
  const str = (s) => {
    const bytes = new TextEncoder().encode(s);
    const out = new Uint8Array(4 + bytes.length + (s ? 1 : 0));
    new DataView(out.buffer).setInt32(0, s ? bytes.length + 1 : 0, true);
    out.set(bytes, 4);
    return [...out];
  };
  const id = Array.from({ length: 16 }, (_, i) => i);
  const bytes = new Uint8Array([1, 0, 0, 0, ...id, ...str("My Puzzle"), ...str(""), ...str("Someone"), 0, 0, 0, 0]);
  const meta = parseGameMetadata(bytes);
  assert.equal(meta.title, "My Puzzle");
  assert.equal(meta.description, "");
  assert.equal(meta.author, "Someone");
  // Four little-endian uint32s, as in the game's folder names.
  assert.equal(meta.id, "03020100" + "07060504" + "0B0A0908" + "0F0E0D0C");
  assert.equal(parseGameMetadata(new Uint8Array([1, 2, 3])), null);
});

test("picked files are grouped into one puzzle per folder", () => {
  const file = (path) => ({ name: path.split("/").pop(), webkitRelativePath: path });
  const groups = groupGamePuzzleFiles([
    file("workshop/AAA/puzzle"),
    file("workshop/AAA/metadata"),
    file("workshop/AAA/preview.jpg"),
    file("workshop/BBB/puzzle"),
    file("workshop/CCC/metadata")
  ]);
  assert.deepEqual(groups.map((g) => [g.folder, Boolean(g.metadataFile)]), [["workshop/AAA", true], ["workshop/BBB", false]]);
});
