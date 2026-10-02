import { boundsOfShape, normalizeShape } from "../geometry.js";

export const boxyRule = {
  id: "boxy",
  label: "Boxy",
  scope: "region",
  implementationStatus: "ready",
  implemented: true,
  paramsSchema: {},

  validatePuzzle() {
    return [];
  },

  candidateFilter(candidate) {
    return isBoxy(candidate);
  },

  explainElimination(candidate) {
    return isBoxy(candidate) ? null : "Boxy requires the region to exactly fill its bounding rectangle.";
  }
};

export const nonBoxyRule = {
  id: "non_boxy",
  label: "Non-Boxy",
  scope: "region",
  implementationStatus: "ready",
  implemented: true,
  paramsSchema: {},

  validatePuzzle() {
    return [];
  },

  candidateFilter(candidate) {
    return !isBoxy(candidate);
  },

  explainElimination(candidate) {
    return isBoxy(candidate) ? "Non-Boxy forbids filled rectangles, bars, and single cells." : null;
  }
};

function isBoxy(candidate) {
  // shapeCells are board coordinates; measure the bounding box from the region's own corner.
  const cells = normalizeShape(candidate.shapeCells ?? []);
  if (cells.length === 0) return false;
  const bounds = boundsOfShape(cells);
  return candidate.area === bounds.width * bounds.height;
}
