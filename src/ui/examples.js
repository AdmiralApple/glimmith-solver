export const EXAMPLES = Object.freeze([
  example("precision", "Precision", ["precision"], { width: 2, height: 2, rules: { area: 4 } }, "unique_solution"),
  example("rose", "Rose Windows", ["rose_window"], {
    width: 4,
    height: 1,
    symbols: { 0: "A", 1: "B", 2: "A", 3: "B" },
    rules: { area: 2, roseLabels: "AB" }
  }),
  example("shape-bank", "Shape Bank", ["shape_bank"], {
    width: 2,
    height: 2,
    rules: { area: 0, shapeBankText: "O4: 0,0 1,0 0,1 1,1" }
  }),
  example("area-number", "Area Number", ["area_number"], {
    width: 3,
    height: 1,
    rules: { area: 0, area_number: {} },
    clues: [
      cellClue("one", "area_number", 0, { value: 1, params: { value: 1 } }),
      cellClue("two", "area_number", 1, { value: 2, params: { value: 2 } })
    ]
  }),
  example("polyomino", "Polyomino", ["polyomino"], {
    width: 2,
    height: 2,
    rules: { area: 0 },
    // A clue only constrains its own region, so each column gets one.
    clues: [
      cellClue("vertical_domino", "polyomino", 0, {
        params: { shape: [[0, 0], [0, 1]], allowRotations: false, allowReflections: false }
      }),
      cellClue("vertical_domino_right", "polyomino", 1, {
        params: { shape: [[0, 0], [0, 1]], allowRotations: false, allowReflections: false }
      })
    ]
  }),
  example("relations", "Gemini / Delta / Difference / Inequality", ["gemini", "delta", "difference", "inequality"], {
    width: 3,
    height: 1,
    rules: { area: 0, area_number: {}, difference: {}, inequality: {}, gemini: {}, delta: {} },
    clues: [
      cellClue("one", "area_number", 0, { value: 1, params: { value: 1 } }),
      cellClue("two", "area_number", 1, { value: 2, params: { value: 2 } }),
      relationClue("diff", "difference", 0, 1, { value: 1, params: { difference: 1 } }),
      relationClue("lt", "inequality", 0, 1, { params: { direction: "lt" } })
    ]
  }),
  example("mingle", "Mingle Shape", ["mingle_shape"], {
    width: 5,
    height: 1,
    activeCells: [0, 1, 3, 4],
    rules: { area: 2, mingle_shape: {} }
  }),
  example("match-mismatch", "Match / Mismatch", ["match", "mismatch"], {
    width: 4,
    height: 1,
    rules: { area: 2, match: {} }
  }),
  example("range-size", "Range / Size Separation", ["range", "size_separation"], {
    width: 3,
    height: 1,
    rules: { area: 0, range: { min: 1, max: 2 }, size_separation: {} }
  }),
  example("boxy", "Boxy", ["boxy"], {
    width: 2,
    height: 2,
    rules: { area: 4, boxy: {} }
  }),
  example("non-boxy", "Non-Boxy", ["non_boxy"], {
    width: 2,
    height: 2,
    activeCells: [0, 1, 2],
    rules: { area: 3, non_boxy: {} }
  }),
  example("solitude", "Solitude", ["solitude"], {
    width: 2,
    height: 1,
    rules: { area: 1, area_number: {}, solitude: {} },
    clues: [
      cellClue("left", "area_number", 0, { value: 1, params: { value: 1 } }),
      cellClue("right", "area_number", 1, { value: 1, params: { value: 1 } })
    ]
  }),
  example("palisade", "Palisade", ["palisade"], {
    width: 1,
    height: 1,
    rules: { area: 1, palisade: {} },
    clues: [cellClue("full", "palisade", 0, { params: { pattern: "full" } })]
  }),
  example("compass", "Compass", ["compass"], {
    width: 3,
    height: 1,
    rules: { area: 3, compass: {} },
    clues: [cellClue("east_two", "compass", 0, { params: { E: 2 } })]
  }),
  example("watchtower", "Watchtower", ["watchtower"], {
    width: 2,
    height: 2,
    rules: { area: 4, watchtower: {} },
    clues: [watchtowerClue(1, 1, 1)]
  }),
  example("bricky", "Bricky", ["bricky"], {
    width: 2,
    height: 2,
    rules: { area: 0, area_number: {}, bricky: {} },
    clues: [
      cellClue("top_domino", "area_number", 0, { value: 2, params: { value: 2 } }),
      cellClue("bottom_left", "area_number", 2, { value: 1, params: { value: 1 } }),
      cellClue("bottom_right", "area_number", 3, { value: 1, params: { value: 1 } })
    ],
    edgeConstraints: { "0-1": { state: "join" } }
  }),
  example("loopy", "Loopy", ["loopy"], {
    width: 2,
    height: 2,
    activeCells: [0, 3],
    rules: { area: 1, loopy: {} }
  })
]);

export function exampleById(id) {
  const item = EXAMPLES.find((exampleItem) => exampleItem.id === id);
  return item ? JSON.parse(JSON.stringify(item)) : null;
}

function example(id, label, ruleIds, puzzle, expectedStatus = "") {
  return Object.freeze({ id, label, ruleIds: Object.freeze(ruleIds), expectedStatus, puzzle: Object.freeze(puzzle) });
}

function cellClue(id, ruleId, cell, data = {}) {
  return {
    id,
    type: "cell",
    ruleId,
    location: { type: "cell", cell },
    ...data
  };
}

function relationClue(id, ruleId, a, b, data = {}) {
  return {
    id,
    type: "relation",
    ruleId,
    location: { type: "edge", cells: [a, b] },
    regionRefs: [{ cell: a }, { cell: b }],
    ...data
  };
}

function watchtowerClue(x, y, value) {
  return {
    id: `watchtower:${x}:${y}`,
    type: "vertex",
    ruleId: "watchtower",
    location: { type: "vertex", x, y },
    value
  };
}
