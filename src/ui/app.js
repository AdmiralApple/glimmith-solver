import { activeAdjacencyEdges, boundsOfShape, cellLabel, edgeKey, idx, normalizeShape, parseEdgeKey, xy } from "../core/geometry.js";
import {
  createPuzzle,
  cycleCellSymbol,
  normalizePuzzle,
  resizePuzzle,
  placeBorderEffect,
  removeBorderEffects,
  setCellSymbol,
  setEdgeState,
  TETROMINO_PRESET,
  toggleCellActive
} from "../core/puzzle.js";
import { solvePuzzle } from "../core/solver.js";
import { allVertexBorderDegrees, selectedBorderSegments } from "../core/boundary.js";
import { generateCandidateDiagnostics } from "../core/candidates.js";
import {
  applyLogicalStep,
  describeCandidatesForCell,
  explainAllLogicalSteps,
  explainCandidateViolations,
  findNextLogicalStep,
  formatExplanationTrace,
  isStepApplyable,
  summarizeSolution
} from "../core/explain.js";
import { validatePuzzle } from "../core/validation.js";
import { RULE_REGISTRY } from "../core/rules/registry.js";
import { RULE_GROUPS, RULE_HELP } from "./rule-ui-metadata.js";
import { applyThemePreference, loadThemePreference, saveThemePreference } from "./theme.js";
import {
  appendShapeBankEntry,
  removeShapeBankEntryAt,
  shapeBankEntryFromCells,
  shapeBankTextToEntries,
  shapePreviewViewBox
} from "./shape-bank-ui.js";
import { inspectorStateForSelection } from "./inspector-state.js";
import { hasUiCandidateSource } from "./candidate-source.js";
import { parseVertexKey, vertexKey } from "./board-hit-testing.js";
import { applyWallSegment, CORNER_HOVER_FRACTION, cornersCrossed, locateBoardPoint, resolveHotkey } from "./hotkeys.js";
import { loadWorkingPuzzle, saveWorkingPuzzle } from "./working-puzzle.js";
import { boardSizeWarning, parseBoardDimension } from "./board-size.js";
import { parseGamePuzzle } from "../core/game-format.js";
import { groupGamePuzzleFiles, readGamePuzzleEntries } from "./game-import.js";
import { EXAMPLES, exampleById } from "./examples.js";
import { canRedo, canUndo, cloneState, createHistory, recordHistory, redoHistory, undoHistory } from "./history.js";
import {
  deleteSavedPuzzle,
  exportSavedPuzzleCollection,
  importSavedPuzzleCollection,
  listSavedPuzzles,
  loadSavedPuzzle,
  savePuzzle
} from "./saved-puzzles.js";

const CELL = 46;
const SVG_PAD = 10;
const MINI_GRID_SIZE = 5;
const RELATION_TOOLS = Object.freeze(["gemini", "delta", "difference", "inequality"]);
/** Board tool that places each clue rule's clues; used for the rule cards' Place buttons. */
const RULE_PLACEMENT_TOOLS = Object.freeze({
  area_number: "areaNumber",
  difference: "difference",
  polyomino: "polyomino",
  gemini: "gemini",
  delta: "delta",
  palisade: "palisade",
  compass: "compass",
  watchtower: "watchtower",
  inequality: "inequality"
});
const RULE_FILTER_KEY = "glimmith.ruleFilter";
const DEFAULT_BANK_SHAPE = "O4: 0,0 1,0 0,1 1,1";

const restoredPuzzle = loadWorkingPuzzle();
let puzzle = restoredPuzzle ?? createPuzzle(6, 6);
let puzzleHistory = createHistory(puzzle);
let currentTool = "cell";
let currentSolution = null;
let lastStep = null;
let selectedCell = null;
let selectedClueId = null;
let lastCandidateSummary = null;
let explanationTrace = [];
let relationFirstCell = null;
let ruleFilter = "all";
const HOTKEY_MODE_TIMEOUT_MS = 2500;
const AREA_DIGIT_CHAIN_MS = 800;
// A pointer within 0.2 of a tile of a grid corner selects the corner, not the tile.
const VERTEX_HOVER_RADIUS = CORNER_HOVER_FRACTION * CELL;
const VERTEX_DIAMOND_SIZE = 7;
let hoverTarget = null;
let hotkeyMode = null;
let hotkeyModeTimer = null;
let lastAreaDigit = { cell: null, value: 0, at: 0 };
let wallStroke = null;
let suppressBoardClick = false;
let lastChangeDescription = "Initial puzzle";
let shapeDraftCells = new Set(["0,0", "1,0", "0,1", "1,1"]);
let polyominoDraftCells = new Set(["0,0", "1,0", "0,1"]);
let traceImage = {
  href: "",
  opacity: 0.35,
  x: 0,
  y: 0,
  scale: 1,
  rotation: 0,
  locked: false,
  gridOpacity: 1,
  cellOpacity: 0.72
};

const el = {
  boardSvg: document.getElementById("boardSvg"),
  widthInput: document.getElementById("widthInput"),
  heightInput: document.getElementById("heightInput"),
  boardSizeWarning: document.getElementById("boardSizeWarning"),
  resizeButton: document.getElementById("resizeButton"),
  rulePalette: document.getElementById("rulePalette"),
  areaInput: document.getElementById("areaInput"),
  roseInput: document.getElementById("roseInput"),
  rotationsInput: document.getElementById("rotationsInput"),
  reflectionsInput: document.getElementById("reflectionsInput"),
  shapeEquivRotationsInput: document.getElementById("shapeEquivRotationsInput"),
  shapeEquivReflectionsInput: document.getElementById("shapeEquivReflectionsInput"),
  areaClueValueInput: document.getElementById("areaClueValueInput"),
  differenceValueInput: document.getElementById("differenceValueInput"),
  inequalityDirectionInput: document.getElementById("inequalityDirectionInput"),
  relationPickHint: document.getElementById("relationPickHint"),
  watchtowerValueInput: document.getElementById("watchtowerValueInput"),
  palisadePatternInput: document.getElementById("palisadePatternInput"),
  compassNInput: document.getElementById("compassNInput"),
  compassEInput: document.getElementById("compassEInput"),
  compassSInput: document.getElementById("compassSInput"),
  compassWInput: document.getElementById("compassWInput"),
  polyominoClueGrid: document.getElementById("polyominoClueGrid"),
  polyominoRotationsInput: document.getElementById("polyominoRotationsInput"),
  polyominoReflectionsInput: document.getElementById("polyominoReflectionsInput"),
  clearPolyominoButton: document.getElementById("clearPolyominoButton"),
  shapeBankInput: document.getElementById("shapeBankInput"),
  shapeNameInput: document.getElementById("shapeNameInput"),
  shapeMiniGrid: document.getElementById("shapeMiniGrid"),
  addShapeButton: document.getElementById("addShapeButton"),
  clearShapeDraftButton: document.getElementById("clearShapeDraftButton"),
  tetrominoButton: document.getElementById("tetrominoButton"),
  screenshotInput: document.getElementById("screenshotInput"),
  screenshotOpacityInput: document.getElementById("screenshotOpacityInput"),
  screenshotXInput: document.getElementById("screenshotXInput"),
  screenshotYInput: document.getElementById("screenshotYInput"),
  screenshotScaleInput: document.getElementById("screenshotScaleInput"),
  screenshotRotationInput: document.getElementById("screenshotRotationInput"),
  screenshotLockInput: document.getElementById("screenshotLockInput"),
  fitScreenshotButton: document.getElementById("fitScreenshotButton"),
  resetScreenshotButton: document.getElementById("resetScreenshotButton"),
  gridOpacityInput: document.getElementById("gridOpacityInput"),
  cellFillOpacityInput: document.getElementById("cellFillOpacityInput"),
  clearScreenshotButton: document.getElementById("clearScreenshotButton"),
  maxNodesInput: document.getElementById("maxNodesInput"),
  maxSecondsInput: document.getElementById("maxSecondsInput"),
  cancelSolveButton: document.getElementById("cancelSolveButton"),
  undoButton: document.getElementById("undoButton"),
  resetButton: document.getElementById("resetButton"),
  resetDialog: document.getElementById("resetDialog"),
  importGameButton: document.getElementById("importGameButton"),
  gameImportDialog: document.getElementById("gameImportDialog"),
  gameFolderButton: document.getElementById("gameFolderButton"),
  gameFileButton: document.getElementById("gameFileButton"),
  gameFolderInput: document.getElementById("gameFolderInput"),
  gameFileInput: document.getElementById("gameFileInput"),
  gamePuzzleList: document.getElementById("gamePuzzleList"),
  gamePuzzleText: document.getElementById("gamePuzzleText"),
  gamePasteImportButton: document.getElementById("gamePasteImportButton"),
  gameImportStatus: document.getElementById("gameImportStatus"),
  redoButton: document.getElementById("redoButton"),
  solveButton: document.getElementById("solveButton"),
  nextStepButton: document.getElementById("nextStepButton"),
  explainAllButton: document.getElementById("explainAllButton"),
  applyStepButton: document.getElementById("applyStepButton"),
  showCandidatesButton: document.getElementById("showCandidatesButton"),
  exportTraceButton: document.getElementById("exportTraceButton"),
  copyTraceButton: document.getElementById("copyTraceButton"),
  clearSolutionButton: document.getElementById("clearSolutionButton"),
  boundaryGraphToggle: document.getElementById("boundaryGraphToggle"),
  exportJsonButton: document.getElementById("exportJsonButton"),
  importJsonButton: document.getElementById("importJsonButton"),
  exampleSelect: document.getElementById("exampleSelect"),
  loadExampleButton: document.getElementById("loadExampleButton"),
  exampleDetails: document.getElementById("exampleDetails"),
  savedPuzzleNameInput: document.getElementById("savedPuzzleNameInput"),
  savePuzzleButton: document.getElementById("savePuzzleButton"),
  savedPuzzleSelect: document.getElementById("savedPuzzleSelect"),
  loadSavedPuzzleButton: document.getElementById("loadSavedPuzzleButton"),
  deleteSavedPuzzleButton: document.getElementById("deleteSavedPuzzleButton"),
  exportSavedPuzzlesButton: document.getElementById("exportSavedPuzzlesButton"),
  importSavedPuzzlesButton: document.getElementById("importSavedPuzzlesButton"),
  savedPuzzleHint: document.getElementById("savedPuzzleHint"),
  jsonBox: document.getElementById("jsonBox"),
  validationBox: document.getElementById("validationBox"),
  copyValidationButton: document.getElementById("copyValidationButton"),
  statusBox: document.getElementById("statusBox"),
  solutionText: document.getElementById("solutionText"),
  noSolutionBox: document.getElementById("noSolutionBox"),
  themeToggle: document.getElementById("themeToggle"),
  currentToolName: document.getElementById("currentToolName"),
  currentToolDescription: document.getElementById("currentToolDescription"),
  currentToolParams: document.getElementById("currentToolParams"),
  inspectorBox: document.getElementById("inspectorBox"),
  shapeBankList: document.getElementById("shapeBankList"),
  ruleFilter: document.getElementById("ruleFilter"),
  activeRuleCount: document.getElementById("activeRuleCount"),
  ruleFilterEmpty: document.getElementById("ruleFilterEmpty"),
  ruleSettingsStore: document.getElementById("ruleSettingsStore")
};

setupTheme();
buildRulePalette();
setRuleFilter(loadRuleFilter());
renderExampleOptions();
renderSavedPuzzleOptions();
bindEvents();
syncFormFromPuzzle();
render();
if (restoredPuzzle) renderStatus("Restored your last puzzle from this browser.", "good");

function bindEvents() {
  bindHotkeys();
  el.themeToggle.addEventListener("change", (event) => {
    if (event.target.name !== "themePreference") return;
    const preference = saveThemePreference(event.target.value);
    applyThemePreference(preference);
  });

  el.resetButton.addEventListener("click", () => el.resetDialog.showModal());
  bindGameImport();
  el.resetDialog.addEventListener("close", () => {
    if (el.resetDialog.returnValue === "reset") resetPuzzle();
  });

  el.undoButton.addEventListener("click", undoPuzzleEdit);
  el.redoButton.addEventListener("click", redoPuzzleEdit);
  document.addEventListener("keydown", (event) => {
    const key = event.key.toLowerCase();
    const modifier = event.ctrlKey || event.metaKey;
    if (!modifier) return;
    if (key === "z" && !event.shiftKey) {
      event.preventDefault();
      undoPuzzleEdit();
    } else if (key === "y" || (key === "z" && event.shiftKey)) {
      event.preventDefault();
      redoPuzzleEdit();
    }
  });

  el.loadExampleButton.addEventListener("click", () => {
    const example = exampleById(el.exampleSelect.value);
    if (!example) return;
    selectedCell = null;
    selectedClueId = null;
    relationFirstCell = null;
    explanationTrace = [];
    commitPuzzle(example.puzzle, `Loaded example ${example.label}`, { syncForm: true });
    renderStatus(`Loaded example: ${example.label}.`, "good");
    render();
  });

  el.exampleSelect.addEventListener("change", () => renderExampleDetails());

  el.savePuzzleButton.addEventListener("click", () => {
    updateRulesFromForm(false, { recordHistory: false });
    try {
      const entry = savePuzzle(localStorage, el.savedPuzzleNameInput.value, puzzle);
      renderSavedPuzzleOptions(entry.id);
      renderStatus(`Saved puzzle "${entry.name}".`, "good");
    } catch (error) {
      renderStatus(error.message, "bad");
    }
  });

  el.loadSavedPuzzleButton.addEventListener("click", () => {
    const saved = loadSavedPuzzle(localStorage, el.savedPuzzleSelect.value);
    if (!saved) {
      renderStatus("Choose a saved puzzle to load.", "warn");
      return;
    }
    selectedCell = null;
    selectedClueId = null;
    relationFirstCell = null;
    commitPuzzle(saved, "Loaded saved puzzle", { syncForm: true });
    renderStatus("Saved puzzle loaded.", "good");
    render();
  });

  el.deleteSavedPuzzleButton.addEventListener("click", () => {
    const id = el.savedPuzzleSelect.value;
    if (!id) {
      renderStatus("Choose a saved puzzle to delete.", "warn");
      return;
    }
    deleteSavedPuzzle(localStorage, id);
    renderSavedPuzzleOptions();
    renderStatus("Saved puzzle deleted.", "good");
  });

  el.exportSavedPuzzlesButton.addEventListener("click", () => {
    el.jsonBox.value = exportSavedPuzzleCollection(localStorage);
    renderStatus("Saved-puzzle collection exported into the JSON box.", "good");
  });

  el.importSavedPuzzlesButton.addEventListener("click", () => {
    try {
      const imported = importSavedPuzzleCollection(localStorage, el.jsonBox.value);
      renderSavedPuzzleOptions();
      renderStatus(`Imported ${imported.length} saved puzzle${imported.length === 1 ? "" : "s"}.`, "good");
    } catch (error) {
      renderStatus(`Saved-puzzle import failed: ${error.message}`, "bad");
    }
  });

  el.copyValidationButton.addEventListener("click", async () => {
    const text = validationReportText();
    try {
      await navigator.clipboard.writeText(text);
      renderStatus("Validation report copied.", "good");
    } catch {
      el.jsonBox.value = text;
      renderStatus("Clipboard unavailable; validation report placed in the JSON box.", "warn");
    }
  });

  document.querySelectorAll(".tool").forEach((button) => {
    button.addEventListener("click", () => setCurrentTool(button.dataset.tool));
  });

  el.resizeButton.addEventListener("click", () => {
    const width = parseBoardDimension(el.widthInput.value, puzzle.width);
    const height = parseBoardDimension(el.heightInput.value, puzzle.height);
    commitPuzzle(resizePuzzle(puzzle, width, height, { fillNew: document.getElementById("fillNewInput").checked }), `Resized board to ${width}x${height}`, { syncForm: true });
    render();
  });
  el.widthInput.addEventListener("input", updateBoardSizeWarning);
  el.heightInput.addEventListener("input", updateBoardSizeWarning);

  el.rulePalette.addEventListener("change", (event) => {
    const toggle = event.target.closest("[data-rule-toggle]");
    if (toggle) {
      setRuleEnabled(toggle.dataset.ruleToggle, toggle.checked);
      return;
    }
    const mingleOption = event.target.closest("[data-mingle-option]");
    if (mingleOption) updateMingleOption(mingleOption.dataset.mingleOption, mingleOption.checked);
    const rangeOption = event.target.closest("[data-range-option]");
    if (rangeOption) updateRangeOption(rangeOption.dataset.rangeOption, rangeOption.value);
  });

  el.ruleFilter.addEventListener("change", (event) => {
    if (event.target.name === "ruleFilter") setRuleFilter(event.target.value);
  });
  el.rulePalette.addEventListener("focusout", () => {
    // Settings stay open while being edited; re-check once focus leaves a card.
    setTimeout(updateRulePalette, 0);
  });

  el.rulePalette.addEventListener("click", (event) => {
    const toolButton = event.target.closest("[data-select-tool]");
    if (!toolButton) return;
    setCurrentTool(toolButton.dataset.selectTool);
    renderStatus(toolButton.dataset.status ?? "Tool selected.", "");
  });

  el.areaInput.addEventListener("change", () => updateRulesFromForm(true, { label: "Changed Precision area", enable: ["precision"] }));
  el.roseInput.addEventListener("input", () => updateRulesFromForm(true, { label: "Changed Rose labels", enable: ["rose_window"] }));
  el.rotationsInput.addEventListener("change", () => updateRulesFromForm(true, { label: "Changed Shape Bank rotation setting" }));
  el.reflectionsInput.addEventListener("change", () => updateRulesFromForm(true, { label: "Changed Shape Bank reflection setting" }));
  el.shapeEquivRotationsInput.addEventListener("change", () => updateRulesFromForm(true, { label: "Changed shape-comparison rotation setting" }));
  el.shapeEquivReflectionsInput.addEventListener("change", () => updateRulesFromForm(true, { label: "Changed shape-comparison reflection setting" }));
  el.shapeBankInput.addEventListener("input", () => updateRulesFromForm(true, { label: "Edited Shape Bank text", enable: ["shape_bank"] }));
  el.shapeBankList.addEventListener("click", (event) => {
    const deleteButton = event.target.closest("[data-delete-shape-index]");
    if (!deleteButton) return;
    el.shapeBankInput.value = removeShapeBankEntryAt(el.shapeBankInput.value, Number(deleteButton.dataset.deleteShapeIndex));
    updateRulesFromForm(false, { label: "Deleted Shape Bank entry", enable: ["shape_bank"] });
    renderStatus("Shape removed from the Shape Bank.", "good");
    render();
  });

  el.inspectorBox.addEventListener("click", (event) => {
    const deleteButton = event.target.closest("[data-delete-clue-id]");
    if (deleteButton) {
      commitPuzzle(removeClueById(deleteButton.dataset.deleteClueId), "Deleted clue");
      selectedClueId = null;
      renderStatus("Clue removed.", "good");
      render();
    }
  });

  el.inspectorBox.addEventListener("change", (event) => {
    const target = event.target;
    const clueId = target.dataset.clueId;
    if (!clueId) return;

    if (target.dataset.areaValue !== undefined) {
      const value = Math.max(1, Number(target.value) || 1);
      commitPuzzle(updateClueById(clueId, (clue) => ({ ...clue, value, params: { ...(clue.params ?? {}), value } })), "Edited Area Number clue");
      render();
    }
    if (target.dataset.polyOption) {
      commitPuzzle(updateClueById(clueId, (clue) => ({
        ...clue,
        params: { ...(clue.params ?? {}), [target.dataset.polyOption]: target.checked }
      })), "Edited Polyomino clue");
      render();
    }
    if (target.dataset.differenceValue !== undefined) {
      const value = Math.max(0, Number(target.value) || 0);
      commitPuzzle(updateClueById(clueId, (clue) => ({ ...clue, value, params: { ...(clue.params ?? {}), difference: value } })), "Edited Difference relation clue");
      render();
    }
    if (target.dataset.inequalityDirection !== undefined) {
      const direction = target.value === "gt" ? "gt" : "lt";
      commitPuzzle(updateClueById(clueId, (clue) => ({ ...clue, params: { ...(clue.params ?? {}), direction } })), "Edited Inequality relation clue");
      render();
    }
    if (target.dataset.palisadePattern !== undefined) {
      commitPuzzle(updateClueById(clueId, (clue) => ({ ...clue, params: { ...(clue.params ?? {}), pattern: target.value } })), "Edited Palisade clue");
      render();
    }
    if (target.dataset.compassDirection) {
      const direction = target.dataset.compassDirection;
      const value = target.value === "" ? undefined : Math.max(0, Number(target.value) || 0);
      commitPuzzle(updateClueById(clueId, (clue) => {
        const params = { ...(clue.params ?? {}) };
        if (value === undefined) delete params[direction];
        else params[direction] = value;
        return { ...clue, params };
      }), "Edited Compass clue");
      render();
    }
    if (target.dataset.watchtowerValue !== undefined) {
      const value = clamp(Number(target.value) || 1, 1, 4);
      commitPuzzle(updateClueById(clueId, (clue) => ({ ...clue, value })), "Edited Watchtower clue");
      render();
    }
  });

  for (const input of [
    el.areaClueValueInput,
    el.differenceValueInput,
    el.inequalityDirectionInput,
    el.watchtowerValueInput,
    el.palisadePatternInput,
    el.compassNInput,
    el.compassEInput,
    el.compassSInput,
    el.compassWInput,
    el.polyominoRotationsInput,
    el.polyominoReflectionsInput
  ]) {
    input.addEventListener("change", () => renderToolBanner());
  }

  el.polyominoClueGrid.addEventListener("click", (event) => {
    toggleDraftCell(polyominoDraftCells, event.target.dataset.miniCell);
    renderPolyominoGrid();
  });
  el.shapeMiniGrid.addEventListener("click", (event) => {
    toggleDraftCell(shapeDraftCells, event.target.dataset.miniCell);
    renderShapeMiniGrid();
  });
  el.clearPolyominoButton.addEventListener("click", () => {
    polyominoDraftCells = new Set(["0,0"]);
    renderPolyominoGrid();
  });
  el.clearShapeDraftButton.addEventListener("click", () => {
    shapeDraftCells = new Set(["0,0"]);
    renderShapeMiniGrid();
  });
  el.addShapeButton.addEventListener("click", () => {
    const entry = shapeBankEntryFromCells(el.shapeNameInput.value, shapeCellsFromDraft(shapeDraftCells));
    if (entry.cells.length === 0) {
      renderStatus("Draw at least one shape-bank cell before adding a shape.", "warn");
      return;
    }
    el.shapeBankInput.value = appendShapeBankEntry(el.shapeBankInput.value, entry);
    updateRulesFromForm(false, { label: "Added Shape Bank entry", enable: ["shape_bank"] });
    el.shapeNameInput.value = `Shape${shapeBankLineCount() + 1}`;
    renderStatus("Drawn shape added to the Shape Bank.", "good");
    render();
  });

  el.screenshotInput.addEventListener("change", () => {
    const file = el.screenshotInput.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      traceImage.href = String(reader.result ?? "");
      renderStatus("Screenshot loaded for manual tracing.", "good");
      render();
    });
    reader.readAsDataURL(file);
  });
  for (const input of [
    el.screenshotOpacityInput,
    el.screenshotXInput,
    el.screenshotYInput,
    el.screenshotScaleInput,
    el.screenshotRotationInput,
    el.gridOpacityInput,
    el.cellFillOpacityInput
  ]) {
    input.addEventListener("input", () => {
      updateTraceFromForm();
      render();
    });
  }
  el.screenshotLockInput.addEventListener("change", () => {
    updateTraceFromForm();
    updateTraceControls();
    renderStatus(traceImage.locked ? "Screenshot transform locked while drawing." : "Screenshot transform unlocked.", "");
    render();
  });
  el.fitScreenshotButton.addEventListener("click", () => {
    traceImage.x = 0;
    traceImage.y = 0;
    traceImage.scale = 1;
    traceImage.rotation = 0;
    updateTraceControls();
    renderStatus("Screenshot fitted to the board.", "good");
    render();
  });
  el.resetScreenshotButton.addEventListener("click", () => {
    traceImage.x = 0;
    traceImage.y = 0;
    traceImage.scale = 1;
    traceImage.rotation = 0;
    traceImage.opacity = 0.35;
    traceImage.gridOpacity = 1;
    traceImage.cellOpacity = 0.72;
    updateTraceControls();
    renderStatus("Screenshot transform reset.", "good");
    render();
  });
  el.clearScreenshotButton.addEventListener("click", () => {
    traceImage.href = "";
    el.screenshotInput.value = "";
    renderStatus("Screenshot cleared.", "");
    render();
  });

  el.boundaryGraphToggle.addEventListener("change", () => render());

  el.tetrominoButton.addEventListener("click", () => {
    commitPuzzle({ ...puzzle, rules: { ...puzzle.rules, shapeBankText: TETROMINO_PRESET } }, "Loaded tetromino Shape Bank", { syncForm: true });
    syncFormFromPuzzle();
    renderStatus("Tetromino shape bank loaded. Leave Precision area at 4 or set it to 0 to allow all bank shapes.", "warn");
    render();
  });

  el.boardSvg.addEventListener("click", (event) => {
    if (suppressBoardClick) {
      suppressBoardClick = false;
      return;
    }
    const clueId = event.target.dataset.clueId;
    const edge = event.target.dataset.edge;
    const vertex = event.target.dataset.vertex;
    const cell = event.target.dataset.cell;
    if (clueId && currentTool === "eraseClue") {
      commitPuzzle(removeClueById(clueId), "Erased clue");
      selectedClueId = null;
      renderStatus("Clue removed.", "good");
      render();
      return;
    }
    if (clueId) {
      selectedClueId = clueId;
      selectedCell = cell === undefined ? selectedCell : Number(cell);
      render();
      return;
    }
    if (vertex && currentTool === "watchtower") {
      const parsed = parseVertexKey(vertex);
      if (!parsed) return;
      const value = clamp(Number(el.watchtowerValueInput.value) || 1, 1, 4);
      commitPuzzle(upsertVertexClue("watchtower", parsed, { value }), `Placed Watchtower clue at (${parsed.x}, ${parsed.y})`);
      selectedClueId = `watchtower:${parsed.x}:${parsed.y}`;
      renderStatus(`Watchtower ${value} placed at vertex (${parsed.x}, ${parsed.y}).`, "good");
      render();
      return;
    }
    if (edge && currentTool === "join") {
      const [a, b] = parseEdgeKey(edge);
      const joined = puzzle.edges[edge]?.state === "join";
      // A joined border is not a wall, so it cannot keep a border effect.
      const next = joined ? setEdgeState(puzzle, a, b, null) : removeBorderEffects(setEdgeState(puzzle, a, b, "join"), a, b);
      commitPuzzle(next, `${joined ? "Cleared" : "Set"} join ${cellLabel(a, puzzle.width)}-${cellLabel(b, puzzle.width)}`);
      render();
      return;
    }
    if (edge && currentTool === "eraseClue") {
      const [a, b] = parseEdgeKey(edge);
      if (!deleteClueAtTarget({ type: "edge", a, b })) renderStatus("No relation clue on that border.", "warn");
      render();
      return;
    }
    if (edge && isRelationTool(currentTool)) {
      const [a, b] = parseEdgeKey(edge);
      const ruleId = currentTool;
      commitPuzzle(upsertRelationClue(ruleId, a, b), `Placed ${ruleLabel(ruleId)} relation clue`);
      relationFirstCell = null;
      renderStatus(`${ruleLabel(ruleId)} relation clue placed on an edge.`, "good");
      render();
      return;
    }
    if (cell === undefined) return;
    handleCellClick(Number(cell));
  });

  el.solveButton.addEventListener("click", async () => {
    updateRulesFromForm(false, { recordHistory: false });
    const solved = puzzle;
    const result = await runSolverTask("solve", { limit: 2, maxNodes: maxNodes(), maxMillis: maxMillis() }, "Solving…");
    if (!result || puzzle !== solved) return;
    currentSolution = result.solutions[0] ?? null;
    lastStep = null;
    el.applyStepButton.disabled = true;
    showSolveResult(result);
    render();
  });

  el.nextStepButton.addEventListener("click", async () => {
    updateRulesFromForm(false, { recordHistory: false });
    const asked = puzzle;
    const result = await runSolverTask("nextStep", { maxNodes: maxNodes(), maxMillis: maxMillis() }, "Looking for the next step…");
    if (!result || puzzle !== asked) return;
    lastStep = result.step ?? null;
    el.applyStepButton.disabled = !isStepApplyable(lastStep);
    showStepResult(result);
    render();
  });

  el.explainAllButton.addEventListener("click", async () => {
    updateRulesFromForm(false, { recordHistory: false });
    const asked = puzzle;
    const result = await runSolverTask("explainAll", { maxNodes: maxNodes(), maxMillis: maxMillis() }, "Building the explanation…");
    if (!result || puzzle !== asked) return;
    explanationTrace = result.steps;
    commitPuzzle(result.puzzle, "Applied full explanation trace");
    lastStep = null;
    el.solutionText.textContent = `${result.text}\n\nTrace status: ${result.status}. ${result.message}`;
    renderStatus(`Built ${result.steps.length} explanation step${result.steps.length === 1 ? "" : "s"}.`, result.steps.length ? "good" : "warn");
    render();
  });

  el.cancelSolveButton.addEventListener("click", cancelSolverTask);

  el.applyStepButton.addEventListener("click", () => {
    if (!lastStep) return;
    commitPuzzle(applyLogicalStep(puzzle, lastStep), "Applied logical step");
    explanationTrace.push(lastStep);
    lastStep = null;
    el.applyStepButton.disabled = true;
    renderStatus("Applied the logical step.", "good");
    render();
  });

  el.showCandidatesButton.addEventListener("click", () => {
    updateRulesFromForm(false, { recordHistory: false });
    if (selectedCell === null) {
      renderStatus("Select a cell on the board first.", "warn");
      return;
    }
    const result = describeCandidatesForCell(puzzle, selectedCell, { maxNodes: maxNodes() });
    lastCandidateSummary = { cell: selectedCell, count: result.count };
    showCandidatesForSelectedCell(result);
    renderInspector();
  });

  el.exportTraceButton.addEventListener("click", () => {
    el.jsonBox.value = JSON.stringify(explanationTrace, null, 2);
    renderStatus("Explanation trace JSON exported into the text area.", explanationTrace.length ? "good" : "warn");
  });

  el.copyTraceButton.addEventListener("click", async () => {
    const text = formatExplanationTrace(explanationTrace, puzzle.width);
    try {
      await navigator.clipboard.writeText(text);
      renderStatus("Explanation trace copied as text.", "good");
    } catch {
      el.jsonBox.value = text;
      renderStatus("Clipboard was unavailable, so the trace text was placed in the text area.", "warn");
    }
  });

  el.clearSolutionButton.addEventListener("click", () => {
    currentSolution = null;
    lastStep = null;
    el.applyStepButton.disabled = true;
    renderStatus("Overlay cleared.", "");
    render();
  });

  el.exportJsonButton.addEventListener("click", () => {
    updateRulesFromForm(false, { recordHistory: false });
    el.jsonBox.value = JSON.stringify(puzzle, null, 2);
    renderStatus("Puzzle JSON exported into the text area.", "good");
    render();
  });

  el.importJsonButton.addEventListener("click", () => {
    try {
      const rawPuzzle = JSON.parse(el.jsonBox.value);
      const validation = validatePuzzle(rawPuzzle);
      commitPuzzle(validation.puzzle, "Imported puzzle JSON", { syncForm: true });
      if (validation.ok) {
        renderStatus("Puzzle JSON imported.", "good");
      } else {
        renderStatus(`Puzzle JSON imported with validation issues:\n${validation.errors.join("\n")}`, "bad");
      }
      render();
    } catch (error) {
      renderStatus(`Import failed: ${error.message}`, "bad");
    }
  });
}

function setupTheme() {
  const preference = loadThemePreference();
  const input = el.themeToggle.querySelector(`input[value="${preference}"]`) ?? el.themeToggle.querySelector('input[value="system"]');
  if (input) input.checked = true;
  applyThemePreference(preference);

  const media = window.matchMedia?.("(prefers-color-scheme: dark)");
  media?.addEventListener?.("change", () => {
    const checked = el.themeToggle.querySelector('input[name="themePreference"]:checked');
    if ((checked?.value ?? "system") === "system") applyThemePreference("system");
  });
}

function renderExampleOptions() {
  el.exampleSelect.innerHTML = EXAMPLES.map(
    (example) => `<option value="${escapeHtml(example.id)}">${escapeHtml(example.label)}</option>`
  ).join("");
  renderExampleDetails();
}

function renderExampleDetails() {
  const example = EXAMPLES.find((item) => item.id === el.exampleSelect.value);
  if (!example) {
    el.exampleDetails.textContent = "No example selected.";
    return;
  }
  const rules = example.ruleIds.map(ruleLabel).join(", ");
  const expected = example.expectedStatus ? ` Expected solve status: ${example.expectedStatus}.` : "";
  el.exampleDetails.textContent = `Covers: ${rules}.${expected}`;
}

function renderSavedPuzzleOptions(selectedId = "") {
  const saved = listSavedPuzzles(localStorage);
  el.savedPuzzleSelect.innerHTML = saved.length
    ? saved.map((entry) => `<option value="${escapeHtml(entry.id)}">${escapeHtml(entry.name)}</option>`).join("")
    : `<option value="">No saved puzzles</option>`;
  if (selectedId) el.savedPuzzleSelect.value = selectedId;
  el.savedPuzzleHint.textContent = saved.length
    ? `${saved.length} saved puzzle${saved.length === 1 ? "" : "s"} in this browser.`
    : "Saved puzzles persist in this browser's localStorage.";
}

function handleCellClick(cell) {
  selectedCell = cell;
  selectedClueId = null;
  if (!puzzle.active[cell] && currentTool !== "cell") {
    renderStatus(`Cell ${cellLabel(cell, puzzle.width)} is inactive. Activate it before placing clues.`, "warn");
    return;
  }

  if (currentTool === "cell") {
    commitPuzzle(toggleCellActive(puzzle, cell), `Toggled cell ${cellLabel(cell, puzzle.width)}`);
    render();
    return;
  }

  if (currentTool === "symbol") {
    commitPuzzle(cycleCellSymbol(puzzle, cell), `Changed symbol on ${cellLabel(cell, puzzle.width)}`);
    render();
    return;
  }

  if (currentTool === "areaNumber") {
    const value = Math.max(1, Number(el.areaClueValueInput.value) || 1);
    commitPuzzle(upsertCellClue("area_number", cell, { value, params: { value } }), `Placed Area Number clue on ${cellLabel(cell, puzzle.width)}`);
    renderStatus(`Area Number ${value} placed on ${cellLabel(cell, puzzle.width)}.`, "good");
    render();
    return;
  }

  if (currentTool === "polyomino") {
    const shape = shapeCellsFromDraft(polyominoDraftCells);
    if (shape.length === 0) {
      renderStatus("Draw a polyomino clue shape before placing it.", "warn");
      return;
    }
    commitPuzzle(upsertCellClue("polyomino", cell, {
      params: {
        shape,
        allowRotations: el.polyominoRotationsInput.checked,
        allowReflections: el.polyominoReflectionsInput.checked
      }
    }), `Placed Polyomino clue on ${cellLabel(cell, puzzle.width)}`);
    renderStatus(`Polyomino clue placed on ${cellLabel(cell, puzzle.width)}.`, "good");
    render();
    return;
  }

  if (currentTool === "palisade") {
    const pattern = el.palisadePatternInput.value;
    commitPuzzle(upsertCellClue("palisade", cell, { params: { pattern } }), `Placed Palisade clue on ${cellLabel(cell, puzzle.width)}`);
    renderStatus(`Palisade ${pattern} clue placed on ${cellLabel(cell, puzzle.width)}.`, "good");
    render();
    return;
  }

  if (currentTool === "compass") {
    const params = compassParamsFromForm();
    commitPuzzle(upsertCellClue("compass", cell, { params }), `Placed Compass clue on ${cellLabel(cell, puzzle.width)}`);
    renderStatus(`Compass clue placed on ${cellLabel(cell, puzzle.width)}.`, "good");
    render();
    return;
  }

  if (isRelationTool(currentTool)) {
    handleRelationCellClick(cell);
    return;
  }

  if (currentTool === "join") {
    renderStatus("Join border: click a border between two cells, not the cell itself.", "warn");
    return;
  }

  if (currentTool === "eraseClue") {
    const clue = (cellCluesByCell().get(cell) ?? []).find((item) => ["area_number", "polyomino", "palisade", "compass"].includes(item.ruleId));
    if (!clue) {
      renderStatus(`No removable clue on ${cellLabel(cell, puzzle.width)}.`, "warn");
      return;
    }
    commitPuzzle(removeClueById(clue.id), `Removed clue from ${cellLabel(cell, puzzle.width)}`);
    renderStatus("Clue removed.", "good");
    render();
  }
}

function handleRelationCellClick(cell) {
  if (relationFirstCell === null) {
    relationFirstCell = cell;
    updateRelationHint();
    render();
    return;
  }
  if (relationFirstCell === cell) {
    relationFirstCell = null;
    updateRelationHint();
    render();
    return;
  }

  const ruleId = currentTool;
  if (!areCellsOrthogonallyAdjacent(relationFirstCell, cell)) {
    renderStatus(
      `${ruleLabel(ruleId)} relation clues are edge-adjacent. Click an orthogonally adjacent cell sharing an edge with ${cellLabel(relationFirstCell, puzzle.width)}.`,
      "warn"
    );
    updateRelationHint();
    render();
    return;
  }
  commitPuzzle(upsertRelationClue(ruleId, relationFirstCell, cell), `Placed ${ruleLabel(ruleId)} relation clue`);
  renderStatus(`${ruleLabel(ruleId)} relation clue placed.`, "good");
  relationFirstCell = null;
  render();
}

/**
 * Copies the rule fields into the puzzle. Precision, Rose Windows and Shape Bank
 * are switched on by their value, so their fields only apply while the rule is
 * on (or when options.enable names it). That way a rule that is off keeps its
 * last value in the field, ready for when it is switched back on.
 */
function updateRulesFromForm(doRender = true, options = {}) {
  const on = (id) => isRuleActive(id) || (options.enable ?? []).includes(id);
  const next = {
    ...puzzle,
    rules: {
      ...puzzle.rules,
      area: on("precision") ? Math.max(1, Number(el.areaInput.value) || 1) : 0,
      roseLabels: on("rose_window") ? sanitizeRoseLabels(el.roseInput.value) : "",
      allowRotations: el.rotationsInput.checked,
      allowReflections: el.reflectionsInput.checked,
      shapeEquivalenceAllowRotations: el.shapeEquivRotationsInput.checked,
      shapeEquivalenceAllowReflections: el.shapeEquivReflectionsInput.checked,
      shapeBankText: on("shape_bank") ? el.shapeBankInput.value : ""
    }
  };
  if (options.recordHistory === false) {
    puzzle = normalizePuzzle(next);
    puzzleHistory = { ...puzzleHistory, present: cloneState(puzzle) };
    clearComputed();
  } else {
    commitPuzzle(next, options.label ?? "Updated rule settings");
  }
  if (doRender) render();
}

function syncFormFromPuzzle() {
  el.widthInput.value = String(puzzle.width);
  el.heightInput.value = String(puzzle.height);
  updateBoardSizeWarning();
  // A switched-off rule keeps its last value in the field.
  if (Number(puzzle.rules.area) > 0) el.areaInput.value = String(puzzle.rules.area);
  if (puzzle.rules.roseLabels) el.roseInput.value = puzzle.rules.roseLabels;
  el.rotationsInput.checked = puzzle.rules.allowRotations !== false;
  el.reflectionsInput.checked = puzzle.rules.allowReflections !== false;
  el.shapeEquivRotationsInput.checked = puzzle.rules.shapeEquivalenceAllowRotations !== false;
  el.shapeEquivReflectionsInput.checked = puzzle.rules.shapeEquivalenceAllowReflections !== false;
  if (puzzle.rules.shapeBankText) el.shapeBankInput.value = puzzle.rules.shapeBankText;
  updateTraceControls();
  updateRelationHint();
}

function isRelationTool(tool) {
  return RELATION_TOOLS.includes(tool);
}

/** Shows a small advisory under the size fields for large boards; never blocks resizing. */
function updateBoardSizeWarning() {
  const width = parseBoardDimension(el.widthInput.value, puzzle.width);
  const height = parseBoardDimension(el.heightInput.value, puzzle.height);
  const warning = boardSizeWarning(width, height);
  el.boardSizeWarning.textContent = warning;
  el.boardSizeWarning.hidden = !warning;
}

function setCurrentTool(tool, doRender = true) {
  if (tool !== currentTool) relationFirstCell = null;
  currentTool = tool;
  document.querySelectorAll(".tool").forEach((button) => {
    button.classList.toggle("active", button.dataset.tool === tool);
  });
  updateRelationHint();
  if (doRender) render();
}

function setRuleEnabled(id, enabled) {
  const rule = RULE_REGISTRY[id];
  if (!rule?.implemented) return;
  const previous = cloneState(puzzle);

  if (enabled) {
    enableRule(id);
  } else {
    disableRule(id);
  }

  const next = normalizePuzzle(puzzle);
  puzzle = previous;
  commitPuzzle(next, `${enabled ? "Enabled" : "Disabled"} ${rule.label}`, { syncForm: true });
  render();
  const field = enabled ? { precision: el.areaInput, rose_window: el.roseInput }[id] : null;
  if (field) {
    field.focus();
    field.select();
  }
}

function sanitizeRoseLabels(value) {
  return String(value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function loadRuleFilter() {
  try {
    return localStorage.getItem(RULE_FILTER_KEY) === "active" ? "active" : "all";
  } catch {
    return "all";
  }
}

function enableRule(id) {
  if (id === "precision") {
    puzzle.rules.area = Math.max(1, Number(el.areaInput.value) || Number(puzzle.rules.area) || 4);
    return;
  }
  if (id === "rose_window") {
    puzzle.rules.roseLabels = puzzle.rules.roseLabels || sanitizeRoseLabels(el.roseInput.value) || "A";
    return;
  }
  if (id === "shape_bank") {
    puzzle.rules.shapeBankText = puzzle.rules.shapeBankText || el.shapeBankInput.value || DEFAULT_BANK_SHAPE;
    return;
  }
  if (id === "mingle_shape") {
    puzzle.rules.mingle_shape = puzzle.rules.mingle_shape ?? {
      allowRotations: puzzle.rules.shapeEquivalenceAllowRotations !== false,
      allowReflections: puzzle.rules.shapeEquivalenceAllowReflections !== false
    };
    return;
  }
  if (id === "area_number") {
    puzzle.rules.area_number = puzzle.rules.area_number ?? {};
    setCurrentTool("areaNumber", false);
    return;
  }
  if (id === "polyomino") {
    puzzle.rules.polyomino = puzzle.rules.polyomino ?? {};
    setCurrentTool("polyomino", false);
    return;
  }
  if (id === "palisade") {
    puzzle.rules.palisade = puzzle.rules.palisade ?? {};
    setCurrentTool("palisade", false);
    return;
  }
  if (id === "compass") {
    puzzle.rules.compass = puzzle.rules.compass ?? {};
    setCurrentTool("compass", false);
    return;
  }
  if (id === "watchtower") {
    puzzle.rules.watchtower = puzzle.rules.watchtower ?? {};
    setCurrentTool("watchtower", false);
    return;
  }
  if (isRelationTool(id)) {
    puzzle.rules[id] = puzzle.rules[id] ?? {};
    setCurrentTool(id, false);
    return;
  }
  if (id === "range") {
    puzzle.rules.range = puzzle.rules.range ?? { min: 1, max: Math.max(1, Number(puzzle.rules.area) || 4) };
    return;
  }
  if (["match", "mismatch", "solitude", "size_separation", "boxy", "non_boxy", "bricky", "loopy"].includes(id)) {
    puzzle.rules[id] = puzzle.rules[id] ?? {};
  }
}

function disableRule(id) {
  if (id === "precision") {
    puzzle.rules.area = 0;
    return;
  }
  if (id === "rose_window") {
    puzzle.rules.roseLabels = "";
    return;
  }
  if (id === "shape_bank") {
    puzzle.rules.shapeBankText = "";
    return;
  }

  const rules = { ...puzzle.rules };
  delete rules[id];
  const clues = (puzzle.clues ?? []).filter((clue) => clue.ruleId !== id);
  const edgeConstraints = clearEdgeRelationsForRule(id, puzzle.edgeConstraints ?? puzzle.edges ?? {});
  puzzle = normalizePuzzle({ ...puzzle, rules, clues, edgeConstraints, edges: edgeConstraints });
}

function updateMingleOption(option, checked) {
  const config = { ...(puzzle.rules.mingle_shape ?? {}) };
  config[option] = checked;
  commitPuzzle({ ...puzzle, rules: { ...puzzle.rules, mingle_shape: config } }, "Changed Mingle Shape options");
  render();
}

function updateRangeOption(option, value) {
  const config = { ...(puzzle.rules.range ?? {}) };
  const number = Number(value);
  if (value === "") delete config[option];
  else config[option] = Number.isInteger(number) ? number : value;
  commitPuzzle({ ...puzzle, rules: { ...puzzle.rules, range: config } }, "Changed Range options");
  render();
}

function clearComputed() {
  currentSolution = null;
  lastStep = null;
  lastCandidateSummary = null;
  if (el.noSolutionBox) {
    el.noSolutionBox.hidden = true;
    el.noSolutionBox.innerHTML = "";
  }
  el.applyStepButton.disabled = true;
}

function commitPuzzle(nextPuzzle, label = "Edited puzzle", options = {}) {
  const normalized = normalizePuzzle(nextPuzzle);
  puzzleHistory = recordHistory(puzzleHistory, normalized, label);
  puzzle = cloneState(puzzleHistory.present);
  lastChangeDescription = label;
  clearComputed();
  if (options.syncForm) syncFormFromPuzzle();
  renderHistoryControls();
}

let gameImportEntries = [];

function bindGameImport() {
  el.importGameButton.addEventListener("click", () => {
    el.gameImportStatus.textContent = "";
    el.gameImportDialog.showModal();
  });
  el.gameFolderButton.addEventListener("click", () => el.gameFolderInput.click());
  el.gameFileButton.addEventListener("click", () => el.gameFileInput.click());
  el.gameFolderInput.addEventListener("change", () => loadGamePuzzleFiles(el.gameFolderInput));
  el.gameFileInput.addEventListener("change", () => loadGamePuzzleFiles(el.gameFileInput));
  el.gamePuzzleList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-game-entry]");
    if (!button) return;
    const entry = gameImportEntries[Number(button.dataset.gameEntry)];
    if (entry) importGamePuzzle(entry.text, entry.meta);
  });
  el.gamePasteImportButton.addEventListener("click", () => importGamePuzzle(el.gamePuzzleText.value, {}));
  el.gameImportDialog.addEventListener("click", (event) => {
    const copy = event.target.closest("[data-copy-text]");
    if (!copy) return;
    const text = document.getElementById(copy.dataset.copyText)?.textContent ?? "";
    navigator.clipboard?.writeText(text).then(
      () => {
        copy.textContent = "Copied";
        setTimeout(() => (copy.textContent = "Copy"), 1500);
      },
      () => (el.gameImportStatus.textContent = "Couldn't copy; select the path and copy it manually.")
    );
  });
}

async function loadGamePuzzleFiles(input) {
  const groups = groupGamePuzzleFiles(input.files ?? []);
  input.value = "";
  if (groups.length === 0) {
    gameImportEntries = [];
    el.gamePuzzleList.innerHTML = "";
    el.gameImportStatus.textContent = "No game puzzles found there. Pick the workshop folder, one puzzle's folder, or a file named \"puzzle\".";
    return;
  }
  el.gameImportStatus.textContent = "Reading puzzles…";
  gameImportEntries = await readGamePuzzleEntries(groups);
  if (gameImportEntries.length === 1 && !gameImportEntries[0].error) {
    importGamePuzzle(gameImportEntries[0].text, gameImportEntries[0].meta);
    return;
  }
  el.gameImportStatus.textContent = `Found ${gameImportEntries.length} puzzles. Pick one to open it.`;
  el.gamePuzzleList.innerHTML = gameImportEntries
    .map((entry, index) => {
      const details = entry.error
        ? `<span class="game-puzzle-error">${escapeHtml(entry.error)}</span>`
        : [
            entry.author ? `by ${escapeHtml(entry.author)}` : "",
            `${entry.width}×${entry.height}`,
            entry.difficulty !== null && entry.difficulty !== undefined ? `difficulty ${entry.difficulty}` : ""
          ].filter(Boolean).join(" · ");
      return `<button type="button" class="game-puzzle-entry" data-game-entry="${index}" ${entry.error ? "disabled" : ""} title="${escapeHtml(entry.description)}">
        <strong>${escapeHtml(entry.title)}</strong><span>${details}</span>
      </button>`;
    })
    .join("");
}

/** Replaces the board with a puzzle read from the game's text format. Undo brings the old one back. */
function importGamePuzzle(text, meta = {}) {
  let parsed;
  try {
    parsed = parseGamePuzzle(text, meta);
  } catch (error) {
    el.gameImportStatus.textContent = error.message;
    return;
  }
  const title = meta.title || "game puzzle";
  selectedCell = null;
  selectedClueId = null;
  relationFirstCell = null;
  explanationTrace = [];
  commitPuzzle(parsed.puzzle, `Imported "${title}" from the game`, { syncForm: true });
  if (meta.title) el.savedPuzzleNameInput.value = meta.title;
  el.gameImportDialog.close();
  const note = parsed.warnings.length ? ` Note: ${parsed.warnings.join(" ")}` : "";
  renderStatus(`Imported "${title}" (${parsed.puzzle.width}×${parsed.puzzle.height}) from The Artisan of Glimmith.${note}`, parsed.warnings.length ? "warn" : "good");
  render();
}

function resetPuzzle() {
  selectedCell = null;
  selectedClueId = null;
  relationFirstCell = null;
  explanationTrace = [];
  setHotkeyMode(null);
  commitPuzzle(createPuzzle(6, 6), "Reset puzzle", { syncForm: true });
  renderStatus("Puzzle reset to a blank 6x6 board. Use Undo to bring it back.", "warn");
  render();
}

function undoPuzzleEdit() {
  if (!canUndo(puzzleHistory)) return;
  puzzleHistory = undoHistory(puzzleHistory);
  puzzle = cloneState(puzzleHistory.present);
  lastChangeDescription = `Undo: ${puzzleHistory.lastLabel}`;
  selectedClueId = null;
  clearComputed();
  syncFormFromPuzzle();
  renderStatus(lastChangeDescription, "warn");
  render();
}

function redoPuzzleEdit() {
  if (!canRedo(puzzleHistory)) return;
  puzzleHistory = redoHistory(puzzleHistory);
  puzzle = cloneState(puzzleHistory.present);
  lastChangeDescription = `Redo: ${puzzleHistory.lastLabel}`;
  selectedClueId = null;
  clearComputed();
  syncFormFromPuzzle();
  renderStatus(lastChangeDescription, "warn");
  render();
}

function renderHistoryControls() {
  el.undoButton.disabled = !canUndo(puzzleHistory);
  el.redoButton.disabled = !canRedo(puzzleHistory);
}

function render() {
  saveWorkingPuzzle(puzzle);
  renderHistoryControls();
  renderBoard();
  renderToolBanner();
  updateRulePalette();
  renderShapeBankList();
  renderShapeMiniGrid();
  renderPolyominoGrid();
  renderValidation();
  renderInspector();
  updateRelationHint();
}

function renderToolBanner() {
  const info = toolInfo(currentTool);
  el.currentToolName.textContent = info.name;
  el.currentToolDescription.textContent = info.description;
  el.currentToolParams.textContent = info.params;
}

function toolInfo(tool) {
  const common = {
    cell: {
      name: "Active / hole cells",
      description: "Click a cell to toggle whether it belongs to the puzzle mask.",
      params: "Click the same cell again to undo the toggle."
    },
    symbol: {
      name: "Cycle symbols",
      description: "Click an active cell to cycle symbols used by Rose Windows.",
      params: `Current cycle is blank, A, B, C, D. Click until the symbol is removed.`
    },
    join: {
      name: "Join border",
      description: "Click a border between active cells to mark that both cells are in the same region.",
      params: "Click a joined border again to clear it. Walls are drawn by dragging from corner to corner."
    },
    ...Object.fromEntries(RELATION_TOOLS.map((ruleId) => [ruleId, {
      name: `${ruleLabel(ruleId)} clue`,
      description: "Click an edge, or click two edge-adjacent active cells, to add a relation clue between their eventual regions.",
      params: `${ruleLabel(ruleId)}${relationToolParameterText(ruleId)}. Delete relation clues with Erase clue, the Delete key, or the inspector.`
    }])),
    areaNumber: {
      name: "Area number clue",
      description: "Click an active cell to place or replace its Area Number clue.",
      params: `Value ${Math.max(1, Number(el.areaClueValueInput.value) || 1)}. Edit or remove selected clues in the inspector.`
    },
    polyomino: {
      name: "Polyomino clue",
      description: "Click an active cell to place the drawn polyomino clue.",
      params: `${polyominoDraftCells.size} drawn cells, rotations ${el.polyominoRotationsInput.checked ? "on" : "off"}, reflections ${el.polyominoReflectionsInput.checked ? "on" : "off"}.`
    },
    palisade: {
      name: "Palisade clue",
      description: "Click an active cell to place a side-border pattern clue.",
      params: `Pattern ${el.palisadePatternInput.value}. Click again with another pattern to replace it.`
    },
    compass: {
      name: "Compass clue",
      description: "Click an active cell to place directional own-region count restrictions.",
      params: compassToolParameterText()
    },
    watchtower: {
      name: "Watchtower clue",
      description: "Click a grid vertex to place a clue counting distinct regions touching that vertex.",
      params: `Value ${clamp(Number(el.watchtowerValueInput.value) || 1, 1, 4)}. Edit or remove selected Watchtower clues in the inspector.`
    },
    eraseClue: {
      name: "Erase clue",
      description: "Click an Area Number, Polyomino, Palisade, Compass, Watchtower, or relation clue to remove it.",
      params: "Click a clue or a border with a relation clue. Walls are erased by dragging along them starting on a wall; joins with the Join border tool."
    }
  };
  return common[tool] ?? common.cell;
}

function relationToolParameterText(ruleId) {
  if (ruleId === "difference") return `, value ${Number(el.differenceValueInput.value) || 0}`;
  if (ruleId === "inequality") {
    return el.inequalityDirectionInput.value === "gt" ? ", first region > second region" : ", first region < second region";
  }
  return "";
}

/**
 * Builds the rule cards once. Each card holds its rule's toggle, a Place button
 * for clue rules, and a settings slot that receives the matching block from
 * #ruleSettingsStore. Cards are then updated in place by updateRulePalette(),
 * so inputs inside them keep focus and listeners across renders.
 */
function buildRulePalette() {
  const seen = new Set();
  const groupHtml = (title, ids) => `<section class="rule-group" data-rule-group="${escapeHtml(title)}">
      <h3>${escapeHtml(title)}</h3>
      <div class="group-settings-slot"></div>
      <div class="rule-group-grid">${ids.map((id) => ruleCardHtml(RULE_REGISTRY[id])).join("")}</div>
    </section>`;
  const groups = RULE_GROUPS.map((group) => {
    const ids = group.ids.filter((id) => RULE_REGISTRY[id]);
    ids.forEach((id) => seen.add(id));
    return groupHtml(group.title, ids);
  });
  const ungrouped = Object.keys(RULE_REGISTRY).filter((id) => !seen.has(id));
  if (ungrouped.length) groups.push(groupHtml("Other", ungrouped));
  el.rulePalette.innerHTML = groups.join("");

  for (const block of [...el.ruleSettingsStore.querySelectorAll("[data-settings-for]")]) {
    const slot = el.rulePalette.querySelector(`[data-rule-settings="${block.dataset.settingsFor}"]`);
    if (slot) slot.append(block);
  }
  for (const block of [...el.ruleSettingsStore.querySelectorAll("[data-group-settings]")]) {
    const slot = el.rulePalette.querySelector(`[data-rule-group="${block.dataset.groupSettings}"] .group-settings-slot`);
    if (slot) slot.append(block);
  }
}

function ruleCardHtml(rule) {
  const disabled = !rule.implemented;
  const tool = RULE_PLACEMENT_TOOLS[rule.id];
  const hasSettings = Boolean(el.ruleSettingsStore.querySelector(`[data-settings-for="${rule.id}"]`));
  const placeButton = tool && !disabled
    ? `<button type="button" class="rule-place" data-select-tool="${tool}" data-status="${escapeHtml(rule.label)} placement tool selected.">Place</button>`
    : "";
  const badge = disabled ? `<span class="rule-badge">${escapeHtml(rule.implementationStatus)}</span>` : "";
  const disabledReason = disabled
    ? `<p class="rule-help">${escapeHtml(
        rule.implementationStatus === "blocked"
          ? "Placeholder only. Solver rejects this rule because semantics are unverified."
          : "Known and ready, but not implemented in the solver yet."
      )}</p>`
    : "";
  return `<section class="rule-card ${disabled ? "disabled" : ""}" data-rule-card="${escapeHtml(rule.id)}" aria-disabled="${disabled}">
    <div class="rule-card-head">
      <label class="rule-toggle"><input type="checkbox" data-rule-toggle="${escapeHtml(rule.id)}" ${disabledAttr(disabled)} /><span>${escapeHtml(rule.label)}</span></label>
      <span class="rule-count" hidden></span>
      ${badge}${placeButton}
    </div>
    <p class="rule-help">${escapeHtml(ruleHelp(rule.id))}</p>
    ${disabledReason}
    ${hasSettings ? `<div class="rule-settings" data-rule-settings="${escapeHtml(rule.id)}" hidden></div>` : ""}
  </section>`;
}

/** Syncs every card with the puzzle: on/off, clue counts, open settings, current tool, and the filter. */
function updateRulePalette() {
  const showActiveOnly = ruleFilter === "active";
  let activeCount = 0;
  let visibleCount = 0;
  for (const card of el.rulePalette.querySelectorAll("[data-rule-card]")) {
    const id = card.dataset.ruleCard;
    const active = isRuleActive(id);
    const toolHere = Boolean(RULE_PLACEMENT_TOOLS[id]) && RULE_PLACEMENT_TOOLS[id] === currentTool;
    const focused = card.contains(document.activeElement) && document.activeElement !== document.body;
    if (active) activeCount += 1;

    const toggle = card.querySelector("[data-rule-toggle]");
    toggle.checked = active;
    card.classList.toggle("active", active);
    card.classList.toggle("tool-current", toolHere);

    const clueCount = (puzzle.clues ?? []).filter((clue) => clue.ruleId === id).length;
    const countEl = card.querySelector(".rule-count");
    countEl.hidden = clueCount === 0;
    countEl.textContent = String(clueCount);
    countEl.title = `${clueCount} clue${clueCount === 1 ? "" : "s"} placed`;
    toggle.title = active && clueCount > 0 ? `Turning this off removes its ${clueCount} clue${clueCount === 1 ? "" : "s"}.` : "";

    const place = card.querySelector(".rule-place");
    if (place) {
      place.classList.toggle("primary", toolHere);
      place.textContent = toolHere ? "Placing" : "Place";
    }

    const settings = card.querySelector("[data-rule-settings]");
    if (settings) settings.hidden = !(active || toolHere || focused);

    card.hidden = showActiveOnly && !active && !toolHere && !focused;
    if (!card.hidden) visibleCount += 1;
  }
  for (const group of el.rulePalette.querySelectorAll("[data-rule-group]")) {
    group.hidden = !group.querySelector("[data-rule-card]:not([hidden])");
  }
  el.activeRuleCount.textContent = String(activeCount);
  el.ruleFilterEmpty.hidden = visibleCount > 0;
  syncRuleOptionInputs();
}

/** Range and Mingle Shape inputs mirror puzzle rules; a field being edited is left alone. */
function syncRuleOptionInputs() {
  const range = puzzle.rules.range ?? {};
  for (const input of el.rulePalette.querySelectorAll("[data-range-option]")) {
    if (input === document.activeElement) continue;
    input.value = range[input.dataset.rangeOption] ?? "";
  }
  const mingle = puzzle.rules.mingle_shape ?? {};
  const fallback = {
    allowRotations: puzzle.rules.shapeEquivalenceAllowRotations,
    allowReflections: puzzle.rules.shapeEquivalenceAllowReflections
  };
  for (const input of el.rulePalette.querySelectorAll("[data-mingle-option]")) {
    const option = input.dataset.mingleOption;
    input.checked = (mingle[option] ?? fallback[option] ?? true) !== false;
  }
}

function setRuleFilter(value) {
  ruleFilter = value === "active" ? "active" : "all";
  try {
    localStorage.setItem(RULE_FILTER_KEY, ruleFilter);
  } catch {
    // Storage may be unavailable; the filter still works for this session.
  }
  for (const input of el.ruleFilter.querySelectorAll("input[name='ruleFilter']")) input.checked = input.value === ruleFilter;
  updateRulePalette();
}

function renderShapeBankList() {
  const { entries, errors } = shapeBankTextToEntries(el.shapeBankInput.value);
  if (entries.length === 0) {
    const errorText = errors.length ? `<p class="shape-errors">${errors.map(escapeHtml).join("<br />")}</p>` : "";
    el.shapeBankList.innerHTML = `<div class="empty-state">No shapes in the bank yet. Draw one below or paste raw text.</div>${errorText}`;
    return;
  }
  const cards = entries
    .map(
      (entry, index) => `<article class="shape-card">
        <div class="shape-card-preview">${shapePreviewSvg(entry.cells)}</div>
        <div class="shape-card-body">
          <strong>${escapeHtml(entry.name || `Shape${index + 1}`)}</strong>
          <span>${entry.cells.length} cell${entry.cells.length === 1 ? "" : "s"}</span>
        </div>
        <button type="button" class="icon-button" data-delete-shape-index="${index}" aria-label="Delete ${escapeHtml(entry.name)}">Delete</button>
      </article>`
    )
    .join("");
  const errorText = errors.length ? `<p class="shape-errors">${errors.map(escapeHtml).join("<br />")}</p>` : "";
  el.shapeBankList.innerHTML = `${cards}${errorText}`;
}

function shapePreviewSvg(cells) {
  const preview = shapePreviewViewBox(cells);
  const size = 18;
  const width = preview.width * size;
  const height = preview.height * size;
  const rects = preview.cells
    .map(([x, y]) => `<rect x="${x * size + 1}" y="${y * size + 1}" width="${size - 2}" height="${size - 2}" rx="3"></rect>`)
    .join("");
  return `<svg class="shape-preview" viewBox="0 0 ${width} ${height}" aria-hidden="true">${rects}</svg>`;
}

function renderShapeMiniGrid() {
  renderMiniGrid(el.shapeMiniGrid, shapeDraftCells);
}

function renderPolyominoGrid() {
  renderMiniGrid(el.polyominoClueGrid, polyominoDraftCells);
}

function renderMiniGrid(container, selectedCells) {
  let html = "";
  for (let y = 0; y < MINI_GRID_SIZE; y += 1) {
    for (let x = 0; x < MINI_GRID_SIZE; x += 1) {
      const key = `${x},${y}`;
      const classes = ["mini-cell", selectedCells.has(key) ? "active" : "", key === "0,0" ? "origin" : ""].join(" ");
      html += `<button type="button" class="${classes}" data-mini-cell="${key}" title="${key}"></button>`;
    }
  }
  container.innerHTML = html;
}

function renderValidation() {
  const validation = validatePuzzle(puzzle);
  const groups = {
    "Board issues": [],
    "Rule issues": [],
    "Clue issues": [],
    "Shape-bank issues": [],
    "Solver / candidate-source issues": []
  };
  const validationErrors = validation.errors.filter((error) => {
    return (
      error !== 'Rule "area_number" requires at least one area number clue.' &&
      error !== 'Rule "polyomino" requires at least one polyomino clue.'
    );
  });
  if (puzzle.activeCells.length === 0) groups["Board issues"].push("Add at least one active cell before solving.");
  if (Number(puzzle.rules.area) <= 0 && !hasCandidateSource()) {
    groups["Rule issues"].push("Precision needs a positive area.");
  } else if (!hasCandidateSource()) {
    groups["Solver / candidate-source issues"].push(
      "Add Precision area, Shape Bank shapes, Area Number clues, Polyomino clues, or Range bounds so the solver can generate candidates."
    );
  }
  if (puzzle.rules.shape_bank && !puzzle.shapeBank?.text?.trim() && (puzzle.shapeBank?.entries ?? []).length === 0) {
    groups["Shape-bank issues"].push("Draw or paste at least one shape.");
  }
  if (puzzle.rules.area_number && !hasRuleClue("area_number")) {
    groups["Clue issues"].push("Place at least one Area Number clue.");
  }
  if (puzzle.rules.polyomino && !hasRuleClue("polyomino")) {
    groups["Clue issues"].push("Place at least one Polyomino clue.");
  }
  for (const error of validationErrors) {
    groups[categorizeValidationMessage(error)].push(actionableValidationMessage(error));
  }
  if ((validationErrors.length > 0 || Object.values(groups).some((items) => items.length > 0)) && lastChangeDescription) {
    groups["Solver / candidate-source issues"].push(`Latest change: ${lastChangeDescription}.`);
  }

  const messages = Object.entries(groups).filter(([, items]) => items.length > 0);
  if (messages.length === 0) {
    el.validationBox.textContent = "No validation issues.";
    el.validationBox.className = "validation-box good";
    return;
  }

  el.validationBox.innerHTML = messages
    .map(([title, items]) => `<section class="validation-group"><h3>${escapeHtml(title)}</h3><ul>${items.map((message) => `<li>${escapeHtml(message)}</li>`).join("")}</ul></section>`)
    .join("");
  el.validationBox.className = `validation-box ${validationErrors.length ? "bad" : "warn"}`;
}

function categorizeValidationMessage(message) {
  if (/shape bank|shape-bank|shape_bank|shape/i.test(message)) return "Shape-bank issues";
  if (/clue|relation|cell clue|polyomino|area number/i.test(message)) return "Clue issues";
  if (/candidate|source|solver/i.test(message)) return "Solver / candidate-source issues";
  if (/active|cell|width|height|board/i.test(message)) return "Board issues";
  return "Rule issues";
}

function actionableValidationMessage(message) {
  if (/Unknown rule id/i.test(message)) return `${message} Remove it from JSON or add a supported registry entry.`;
  if (/not implemented/i.test(message)) return `${message} Disable this rule before solving.`;
  return message;
}

function validationReportText() {
  const validation = validatePuzzle(puzzle);
  const lines = [
    "Glimmith validation report",
    `Latest change: ${lastChangeDescription}`,
    `Board: ${puzzle.width}x${puzzle.height}`,
    `Active rules: ${Object.values(RULE_REGISTRY).filter((rule) => isRuleActive(rule.id)).map((rule) => rule.label).join(", ") || "none"}`,
    ""
  ];
  if (validation.errors.length === 0) {
    lines.push("No validation issues.");
  } else {
    lines.push("Validation issues:");
    for (const error of validation.errors) lines.push(`- ${actionableValidationMessage(error)}`);
  }
  return lines.join("\n");
}

function renderInspector() {
  const state = inspectorStateForSelection(puzzle, {
    selectedClueId,
    selectedCell,
    candidateSummary: lastCandidateSummary
  });

  if (!state) {
    const info = toolInfo(currentTool);
    el.inspectorBox.innerHTML = `<div class="empty-state">
      <strong>${escapeHtml(info.name)}</strong>
      <p>${escapeHtml(info.description)}</p>
      <p>${escapeHtml(info.params)}</p>
    </div>`;
    return;
  }

  if (state.type === "cell") {
    el.inspectorBox.innerHTML = cellInspectorHtml(state);
    return;
  }
  if (state.type === "relation_clue") {
    el.inspectorBox.innerHTML = relationInspectorHtml(state);
    return;
  }
  if (state.type === "vertex_clue") {
    el.inspectorBox.innerHTML = vertexClueInspectorHtml(state);
    return;
  }
  if (state.type === "cell_clue") {
    el.inspectorBox.innerHTML = cellClueInspectorHtml(state.clue, state.label);
  }
}

function cellInspectorHtml(state) {
  const candidateText =
    state.candidateCount === null ? "Use Show candidates for selected cell to calculate this." : `${state.candidateCount} candidate${state.candidateCount === 1 ? "" : "s"}`;
  const area = state.areaNumberClue ? cellClueInspectorHtml(state.areaNumberClue, state.label) : `<p class="muted">No Area Number clue on this cell.</p>`;
  const poly = state.polyominoClue ? cellClueInspectorHtml(state.polyominoClue, state.label) : `<p class="muted">No Polyomino clue on this cell.</p>`;
  return `<div class="inspector-stack">
    <section class="inspector-card">
      <h3>${escapeHtml(state.label)}</h3>
      <dl class="compact-list">
        <dt>Cell state</dt><dd>${state.active ? "Active" : "Hole"}</dd>
        <dt>Candidate count</dt><dd>${escapeHtml(candidateText)}</dd>
      </dl>
    </section>
    <section class="inspector-card">
      <h3>Area Number</h3>
      ${area}
    </section>
    <section class="inspector-card">
      <h3>Polyomino</h3>
      ${poly}
    </section>
    <section class="inspector-card">
      <h3>Other cell clues</h3>
      ${state.otherCellClues.length ? state.otherCellClues.map((clue) => cellClueInspectorHtml(clue, state.label)).join("") : `<p class="muted">No Palisade or Compass clue on this cell.</p>`}
    </section>
  </div>`;
}

function cellClueInspectorHtml(clue, label) {
  if (clue.ruleId === "area_number") {
    const value = Number(clue.value ?? clue.params?.value ?? clue.params?.area ?? 1);
    return `<div class="inspector-stack">
      <label class="stacked">Value
        <input type="number" min="1" max="20" value="${value}" data-clue-id="${escapeHtml(clue.id)}" data-area-value />
      </label>
      <button type="button" data-delete-clue-id="${escapeHtml(clue.id)}">Remove clue</button>
    </div>`;
  }
  if (clue.ruleId === "polyomino") {
    const cells = clue.params?.shape ?? [];
    const rotations = clue.params?.allowRotations !== false;
    const reflections = clue.params?.allowReflections !== false;
    return `<div class="inspector-stack">
      <p>${escapeHtml(label)} polyomino clue, ${cells.length} cell${cells.length === 1 ? "" : "s"}.</p>
      <label class="checkbox-row single"><input type="checkbox" ${checkedAttr(rotations)} data-clue-id="${escapeHtml(clue.id)}" data-poly-option="allowRotations" /> Allow rotations</label>
      <label class="checkbox-row single"><input type="checkbox" ${checkedAttr(reflections)} data-clue-id="${escapeHtml(clue.id)}" data-poly-option="allowReflections" /> Allow reflections</label>
      <button type="button" data-delete-clue-id="${escapeHtml(clue.id)}">Remove clue</button>
    </div>`;
  }
  if (clue.ruleId === "palisade") {
    const pattern = clue.params?.pattern ?? "empty";
    const options = ["empty", "one_sided", "corner", "opposite", "three_sided", "full"]
      .map((value) => `<option value="${value}" ${value === pattern ? "selected" : ""}>${value}</option>`)
      .join("");
    return `<div class="inspector-stack">
      <label class="stacked">Pattern
        <select data-clue-id="${escapeHtml(clue.id)}" data-palisade-pattern>${options}</select>
      </label>
      <button type="button" data-delete-clue-id="${escapeHtml(clue.id)}">Remove clue</button>
    </div>`;
  }
  if (clue.ruleId === "compass") {
    const params = clue.params ?? {};
    return `<div class="inspector-stack">
      ${["N", "E", "S", "W"].map((direction) => `<label class="stacked">${direction}
        <input type="number" min="0" max="20" value="${escapeHtml(params[direction] ?? "")}" data-clue-id="${escapeHtml(clue.id)}" data-compass-direction="${direction}" />
      </label>`).join("")}
      <button type="button" data-delete-clue-id="${escapeHtml(clue.id)}">Remove clue</button>
    </div>`;
  }
  return `<p>${escapeHtml(ruleLabel(clue.ruleId))} clue.</p>
    <button type="button" data-delete-clue-id="${escapeHtml(clue.id)}">Remove clue</button>`;
}

function relationInspectorHtml(state) {
  const differenceInput =
    state.ruleId === "difference"
      ? `<label class="stacked">Difference value
          <input type="number" min="0" max="20" value="${state.differenceValue ?? 0}" data-clue-id="${escapeHtml(state.clue.id)}" data-difference-value />
        </label>`
      : "";
  const inequalityInput =
    state.ruleId === "inequality"
      ? `<label class="stacked">Direction
          <select data-clue-id="${escapeHtml(state.clue.id)}" data-inequality-direction>
            <option value="lt" ${state.clue.params?.direction === "gt" ? "" : "selected"}>First region &lt; second region</option>
            <option value="gt" ${state.clue.params?.direction === "gt" ? "selected" : ""}>First region &gt; second region</option>
          </select>
        </label>`
      : "";
  return `<div class="inspector-stack">
    <section class="inspector-card">
      <h3>${escapeHtml(ruleLabel(state.ruleId))}</h3>
      <dl class="compact-list">
        <dt>Referenced cells</dt><dd>${escapeHtml(state.labels.join(" and ") || "Unknown")}</dd>
        <dt>Rule type</dt><dd>${escapeHtml(state.ruleId)}</dd>
      </dl>
      ${differenceInput}
      ${inequalityInput}
      <button type="button" data-delete-clue-id="${escapeHtml(state.clue.id)}">Delete relation clue</button>
    </section>
  </div>`;
}

function vertexClueInspectorHtml(state) {
  if (state.ruleId === "watchtower") {
    return `<div class="inspector-stack">
      <section class="inspector-card">
        <h3>Watchtower</h3>
        <dl class="compact-list">
          <dt>Vertex</dt><dd>${escapeHtml(state.label)}</dd>
          <dt>Rule type</dt><dd>watchtower</dd>
        </dl>
        <label class="stacked">Value
          <input type="number" min="1" max="4" value="${clamp(state.value, 1, 4)}" data-clue-id="${escapeHtml(state.clue.id)}" data-watchtower-value />
        </label>
        <button type="button" data-delete-clue-id="${escapeHtml(state.clue.id)}">Delete Watchtower clue</button>
      </section>
    </div>`;
  }
  return `<div class="inspector-stack">
    <section class="inspector-card">
      <h3>${escapeHtml(ruleLabel(state.ruleId))}</h3>
      <p>${escapeHtml(state.label)} vertex clue.</p>
      <button type="button" data-delete-clue-id="${escapeHtml(state.clue.id)}">Remove clue</button>
    </section>
  </div>`;
}

function renderBoard() {
  const widthPx = puzzle.width * CELL + SVG_PAD * 2;
  const heightPx = puzzle.height * CELL + SVG_PAD * 2;
  const regionByCell = currentSolution?.regionByCell ?? {};
  const stepEdgeKey = lastStep?.edge ? edgeKey(lastStep.edge[0], lastStep.edge[1]) : null;
  const cellClues = cellCluesByCell();
  el.boardSvg.style.setProperty("--grid-opacity", String(traceImage.gridOpacity));
  el.boardSvg.style.setProperty("--trace-cell-opacity", String(traceImage.cellOpacity));

  let html = "";
  html += `<rect x="0" y="0" width="${widthPx}" height="${heightPx}" rx="12" fill="var(--board-bg)"></rect>`;
  html += traceImageSvg(widthPx, heightPx);

  for (let y = 0; y < puzzle.height; y += 1) {
    for (let x = 0; x < puzzle.width; x += 1) {
      const cell = idx(x, y, puzzle.width);
      const active = puzzle.active[cell];
      const rx = SVG_PAD + x * CELL;
      const ry = SVG_PAD + y * CELL;
      const regionId = regionByCell[cell];
      const fill = active && regionId ? regionColor(regionId) : "";
      const classes = [
        "cell",
        traceImage.href ? "trace-cell" : "",
        active ? "active-cell" : "inactive-cell",
        selectedCell === cell ? "selected-cell" : "",
        relationFirstCell === cell ? "relation-pick-cell" : "",
        regionId ? "solution-cell" : ""
      ].join(" ");
      const label = cellLabel(cell, puzzle.width);
      html += `<rect class="${classes}" data-cell="${cell}" x="${rx}" y="${ry}" width="${CELL}" height="${CELL}" rx="4" ${fill ? `style="fill:${fill}"` : ""}><title>${label}</title></rect>`;
      if (active && puzzle.symbols[cell]) {
        html += `<text class="cell-symbol" x="${rx + CELL / 2}" y="${ry + CELL / 2}">${escapeHtml(puzzle.symbols[cell])}</text>`;
      }
      html += cellClueSvg(cellClues.get(cell) ?? [], rx, ry);
      if (active && regionId) {
        html += `<text class="region-label" x="${rx + CELL - 5}" y="${ry + CELL - 5}">${regionId}</text>`;
      }
    }
  }

  html += relationCluesSvg();
  html += boundaryGraphOverlaySvg();
  let edgeBadges = "";

  for (const [a, b] of activeAdjacencyEdges(puzzle)) {
    const key = edgeKey(a, b);
    const constraint = puzzle.edges[key] ?? { state: null, relation: null };
    const isStep = key === stepEdgeKey;
    const line = edgeLine(a, b);
    const visualType = constraint.relation ?? constraint.state;
    if (visualType || isStep) {
      const cssType = isStep && lastStep ? lastStep.state : visualType;
      html += `<line class="edge-visible edge-${cssType}" x1="${line.x1}" y1="${line.y1}" x2="${line.x2}" y2="${line.y2}"></line>`;
      if (constraint.relation) {
        const gemini = constraint.relation === "sameShape";
        edgeBadges += edgeBadgeSvg(line.mx, line.my, gemini ? "G" : "D", gemini ? "badge-gemini" : "badge-delta");
      }
      if (isStep && lastStep?.state) {
        const join = lastStep.state === "join";
        edgeBadges += edgeBadgeSvg(line.mx, line.my, join ? "J" : "C", join ? "badge-join" : "badge-cut");
      }
    }
    html += `<line class="edge-hit" data-edge="${key}" x1="${line.x1}" y1="${line.y1}" x2="${line.x2}" y2="${line.y2}"><title>Border ${cellLabel(a, puzzle.width)}-${cellLabel(b, puzzle.width)}</title></line>`;
  }
  html += edgeBadges;
  html += relationClueLabelsSvg();

  html += vertexHitTargetsSvg();
  html += vertexCluesSvg();
  html += `<g class="hover-layer"></g>`;

  el.boardSvg.setAttribute("viewBox", `0 0 ${widthPx} ${heightPx}`);
  el.boardSvg.setAttribute("width", String(widthPx));
  el.boardSvg.setAttribute("height", String(heightPx));
  el.boardSvg.innerHTML = html;
  renderHoverOverlay();
}

/**
 * Draws the pointer highlight: a white diamond when a grid corner is targeted,
 * otherwise an outline on the hovered tile. Never both.
 */
function renderHoverOverlay() {
  const layer = el.boardSvg.querySelector(".hover-layer");
  if (!layer) return;
  const target = hoverTarget;
  if (target?.type === "vertex") {
    const cx = SVG_PAD + target.x * CELL;
    const cy = SVG_PAD + target.y * CELL;
    const s = VERTEX_DIAMOND_SIZE;
    layer.innerHTML = `<polygon class="hover-vertex" points="${cx},${cy - s} ${cx + s},${cy} ${cx},${cy + s} ${cx - s},${cy}"></polygon>`;
  } else if (target?.type === "cell" && target.cell < puzzle.width * puzzle.height) {
    const { x, y } = xy(target.cell, puzzle.width);
    layer.innerHTML = `<rect class="hover-cell" x="${SVG_PAD + x * CELL}" y="${SVG_PAD + y * CELL}" width="${CELL}" height="${CELL}" rx="4"></rect>`;
  } else {
    layer.innerHTML = "";
  }
}

function traceImageSvg(widthPx, heightPx) {
  if (!traceImage.href) return "";
  const boardWidth = puzzle.width * CELL;
  const boardHeight = puzzle.height * CELL;
  const cx = SVG_PAD + boardWidth / 2;
  const cy = SVG_PAD + boardHeight / 2;
  const transform = `translate(${traceImage.x} ${traceImage.y}) translate(${cx} ${cy}) rotate(${traceImage.rotation}) scale(${traceImage.scale}) translate(${-cx} ${-cy})`;
  return `<g class="trace-image" opacity="${traceImage.opacity}" transform="${transform}">
    <image href="${escapeHtml(traceImage.href)}" x="${SVG_PAD}" y="${SVG_PAD}" width="${boardWidth}" height="${boardHeight}" preserveAspectRatio="none"></image>
  </g>`;
}

function cellClueSvg(clues, rx, ry) {
  let html = "";
  const areaClue = clues.find((clue) => clue.ruleId === "area_number");
  if (areaClue) {
    const value = areaClue.value ?? areaClue.params?.value ?? areaClue.params?.area;
    html += `<circle class="cell-clue-bg" data-clue-id="${escapeHtml(areaClue.id)}" data-cell="${areaClue.location.cell}" cx="${rx + 12}" cy="${ry + 12}" r="10"><title>Area Number clue ${escapeHtml(value)}</title></circle>`;
    html += `<text class="cell-clue" data-clue-id="${escapeHtml(areaClue.id)}" data-cell="${areaClue.location.cell}" x="${rx + 12}" y="${ry + 12}">${escapeHtml(value)}</text>`;
  }
  const polyClue = clues.find((clue) => clue.ruleId === "polyomino");
  if (polyClue) {
    html += polyominoClueShapeSvg(polyClue, rx, ry);
  }
  const palisadeClue = clues.find((clue) => clue.ruleId === "palisade");
  if (palisadeClue) {
    html += `<circle class="cell-clue-bg" data-clue-id="${escapeHtml(palisadeClue.id)}" data-cell="${palisadeClue.location.cell}" cx="${rx + 12}" cy="${ry + CELL - 12}" r="10"><title>Palisade clue</title></circle>`;
    html += `<text class="cell-clue" data-clue-id="${escapeHtml(palisadeClue.id)}" data-cell="${palisadeClue.location.cell}" x="${rx + 12}" y="${ry + CELL - 12}">S</text>`;
  }
  const compassClue = clues.find((clue) => clue.ruleId === "compass");
  if (compassClue) {
    html += `<circle class="cell-clue-bg" data-clue-id="${escapeHtml(compassClue.id)}" data-cell="${compassClue.location.cell}" cx="${rx + CELL - 12}" cy="${ry + CELL - 12}" r="10"><title>Compass clue</title></circle>`;
    html += `<text class="cell-clue" data-clue-id="${escapeHtml(compassClue.id)}" data-cell="${compassClue.location.cell}" x="${rx + CELL - 12}" y="${ry + CELL - 12}">C</text>`;
  }
  return html;
}

function polyominoClueShapeSvg(clue, rx, ry) {
  const shape = normalizeShape(clue.params?.shape ?? []);
  if (shape.length === 0) {
    return `<circle class="cell-clue-bg poly-clue-bg" data-clue-id="${escapeHtml(clue.id)}" data-cell="${clue.location.cell}" cx="${rx + CELL / 2}" cy="${ry + CELL / 2}" r="10"><title>Polyomino clue</title></circle>
      <text class="cell-clue" data-clue-id="${escapeHtml(clue.id)}" data-cell="${clue.location.cell}" x="${rx + CELL / 2}" y="${ry + CELL / 2}">P</text>`;
  }
  const bounds = boundsOfShape(shape);
  const maxSize = CELL * 0.85;
  const unit = Math.min(maxSize / bounds.width, maxSize / bounds.height);
  const width = bounds.width * unit;
  const height = bounds.height * unit;
  const x0 = rx + (CELL - width) / 2;
  const y0 = ry + (CELL - height) / 2;
  const attrs = `data-clue-id="${escapeHtml(clue.id)}" data-cell="${clue.location.cell}"`;
  const rects = shape
    .map(([x, y]) => `<rect class="poly-clue-cell" ${attrs} x="${x0 + x * unit + 1}" y="${y0 + y * unit + 1}" width="${Math.max(1, unit - 2)}" height="${Math.max(1, unit - 2)}" rx="3"></rect>`)
    .join("");
  return `<g class="poly-clue-shape" ${attrs}>
    <title>Polyomino clue shape</title>
    ${rects}
    <rect class="poly-clue-hit" ${attrs} x="${x0}" y="${y0}" width="${width}" height="${height}" rx="4"></rect>
  </g>`;
}

function relationClueCenters(clue) {
  const cells = relationCellsFromClue(clue);
  if (!cells) return null;
  const left = cellCenter(cells[0]);
  const right = cellCenter(cells[1]);
  return { left, right, mx: (left.x + right.x) / 2, my: (left.y + right.y) / 2 };
}

function visibleRelationClues() {
  return (puzzle.clues ?? []).filter((clue) => clue.type === "relation" && clue.source !== "edgeConstraints");
}

/** Dashed connector lines; drawn under walls. */
function relationCluesSvg() {
  let html = "";
  for (const clue of visibleRelationClues()) {
    const centers = relationClueCenters(clue);
    if (!centers) continue;
    const { left, right } = centers;
    html += `<line class="relation-clue-line" data-clue-id="${escapeHtml(clue.id)}" x1="${left.x}" y1="${left.y}" x2="${right.x}" y2="${right.y}"><title>${escapeHtml(ruleLabel(clue.ruleId))} relation clue</title></line>`;
  }
  return html;
}

/** Relation labels; drawn over walls so they stay readable on any wall color. */
function relationClueLabelsSvg() {
  let html = "";
  for (const clue of visibleRelationClues()) {
    const centers = relationClueCenters(clue);
    if (!centers) continue;
    html += edgeBadgeSvg(centers.mx, centers.my, relationClueLabel(clue), `badge-${clue.ruleId}`);
  }
  return html;
}

/**
 * A small pill-shaped label on a border: solid background, colored outline,
 * ink-colored text. Clicks pass through to the border underneath.
 */
function edgeBadgeSvg(x, y, text, typeClass = "") {
  const label = String(text);
  const height = 16;
  const width = Math.max(height, 8 + label.length * 7);
  return `<g class="edge-badge ${typeClass}">`
    + `<rect x="${x - width / 2}" y="${y - height / 2}" width="${width}" height="${height}" rx="${height / 2}"></rect>`
    + `<text x="${x}" y="${y}">${escapeHtml(label)}</text></g>`;
}

function vertexCluesSvg() {
  let html = "";
  for (const clue of puzzle.clues ?? []) {
    if (clue.type !== "vertex") continue;
    const x = Number(clue.location?.x);
    const y = Number(clue.location?.y);
    if (!Number.isInteger(x) || !Number.isInteger(y)) continue;
    const cx = SVG_PAD + x * CELL;
    const cy = SVG_PAD + y * CELL;
    const value = clue.ruleId === "watchtower" ? Number(clue.value ?? 1) : "?";
    html += `<circle class="watchtower-clue-bg" data-clue-id="${escapeHtml(clue.id)}" data-vertex="${vertexKey(x, y)}" cx="${cx}" cy="${cy}" r="11"><title>${escapeHtml(ruleLabel(clue.ruleId))} clue at vertex (${x}, ${y})</title></circle>`;
    html += `<text class="watchtower-clue" data-clue-id="${escapeHtml(clue.id)}" data-vertex="${vertexKey(x, y)}" x="${cx}" y="${cy}">${escapeHtml(value)}</text>`;
  }
  return html;
}

function boundaryGraphOverlaySvg() {
  if (!el.boundaryGraphToggle.checked || !currentSolution) return "";
  const segments = selectedBorderSegments(currentSolution.regions, puzzle);
  const degrees = allVertexBorderDegrees(currentSolution.regions, puzzle);
  const lines = segments.map((segment) => {
    const line = segmentLine(segment);
    return `<line class="boundary-segment" x1="${line.x1}" y1="${line.y1}" x2="${line.x2}" y2="${line.y2}"></line>`;
  });
  const vertices = degrees.map(({ x, y, degree }) => {
    const cx = SVG_PAD + x * CELL;
    const cy = SVG_PAD + y * CELL;
    return `<circle class="boundary-vertex degree-${degree}" cx="${cx}" cy="${cy}" r="${degree >= 3 ? 6 : 4}"></circle>`;
  });
  return `<g class="boundary-overlay">${lines.join("")}${vertices.join("")}</g>`;
}

function vertexHitTargetsSvg() {
  if (currentTool !== "watchtower" && !el.boundaryGraphToggle.checked) return "";
  const degreeByKey = new Map();
  if (el.boundaryGraphToggle.checked && currentSolution) {
    for (const item of allVertexBorderDegrees(currentSolution.regions, puzzle)) {
      degreeByKey.set(vertexKey(item.x, item.y), item.degree);
    }
  }
  let html = "";
  for (let y = 0; y <= puzzle.height; y += 1) {
    for (let x = 0; x <= puzzle.width; x += 1) {
      const key = vertexKey(x, y);
      const degree = degreeByKey.get(key);
      const title = degree === undefined ? `Vertex (${x}, ${y})` : `Vertex (${x}, ${y}), border degree ${degree}`;
      html += `<circle class="vertex-hit" data-vertex="${key}" cx="${SVG_PAD + x * CELL}" cy="${SVG_PAD + y * CELL}" r="${VERTEX_HOVER_RADIUS}"><title>${escapeHtml(title)}</title></circle>`;
    }
  }
  return html;
}

function edgeLine(a, b) {
  const ca = xy(a, puzzle.width);
  const cb = xy(b, puzzle.width);
  if (ca.y === cb.y) {
    const x = SVG_PAD + Math.max(ca.x, cb.x) * CELL;
    const y = SVG_PAD + ca.y * CELL;
    return { x1: x, y1: y + 5, x2: x, y2: y + CELL - 5, mx: x, my: y + CELL / 2 };
  }
  const x = SVG_PAD + ca.x * CELL;
  const y = SVG_PAD + Math.max(ca.y, cb.y) * CELL;
  return { x1: x + 5, y1: y, x2: x + CELL - 5, y2: y, mx: x + CELL / 2, my: y };
}

function segmentLine(segment) {
  if (segment.orientation === "h") {
    const y = SVG_PAD + segment.y * CELL;
    return { x1: SVG_PAD + segment.x * CELL, y1: y, x2: SVG_PAD + (segment.x + 1) * CELL, y2: y };
  }
  const x = SVG_PAD + segment.x * CELL;
  return { x1: x, y1: SVG_PAD + segment.y * CELL, x2: x, y2: SVG_PAD + (segment.y + 1) * CELL };
}

function upsertCellClue(ruleId, cell, data) {
  const rules = { ...puzzle.rules, [ruleId]: puzzle.rules[ruleId] ?? {} };
  const clues = (puzzle.clues ?? []).filter((clue) => !(clue.ruleId === ruleId && clue.location?.cell === cell));
  clues.push({
    id: `${ruleId}:${cell}`,
    type: "cell",
    ruleId,
    location: { type: "cell", cell },
    ...data
  });
  return normalizePuzzle({ ...puzzle, rules, clues });
}

function upsertRelationClue(ruleId, firstCell, secondCell) {
  const key = edgeKey(firstCell, secondCell);
  const clue = {
    id: `relation:${ruleId}:${key}`,
    type: "relation",
    ruleId,
    location: { type: "edge", cells: [firstCell, secondCell] },
    regionRefs: [{ cell: firstCell }, { cell: secondCell }]
  };
  if (ruleId === "difference") {
    const value = Math.max(0, Number(el.differenceValueInput.value) || 0);
    clue.value = value;
    clue.params = { difference: value };
  }
  if (ruleId === "inequality") {
    clue.params = { direction: el.inequalityDirectionInput.value === "gt" ? "gt" : "lt" };
  }
  // Replaces any other effect on this border and makes the border a wall.
  return placeBorderEffect(puzzle, clue);
}

function upsertVertexClue(ruleId, vertex, data) {
  const rules = { ...puzzle.rules, [ruleId]: puzzle.rules[ruleId] ?? {} };
  const clues = (puzzle.clues ?? []).filter(
    (clue) => !(clue.ruleId === ruleId && clue.type === "vertex" && Number(clue.location?.x) === vertex.x && Number(clue.location?.y) === vertex.y)
  );
  clues.push({
    id: `${ruleId}:${vertex.x}:${vertex.y}`,
    type: "vertex",
    ruleId,
    location: { type: "vertex", x: vertex.x, y: vertex.y },
    ...data
  });
  return normalizePuzzle({ ...puzzle, rules, clues });
}

function removeClueById(clueId) {
  const clues = (puzzle.clues ?? []).filter((clue) => clue.id !== clueId);
  return normalizePuzzle({ ...puzzle, clues });
}

function updateClueById(clueId, updater) {
  const clues = (puzzle.clues ?? []).map((clue) => (clue.id === clueId ? updater(clue) : clue));
  return normalizePuzzle({ ...puzzle, clues });
}

function cellCluesByCell() {
  const byCell = new Map();
  for (const clue of puzzle.clues ?? []) {
    if (clue.type !== "cell" || clue.location?.cell === undefined) continue;
    const cell = Number(clue.location.cell);
    const list = byCell.get(cell) ?? [];
    list.push(clue);
    byCell.set(cell, list);
  }
  return byCell;
}

function relationCellsFromClue(clue) {
  const refs = clue.regionRefs ?? clue.regions;
  if (Array.isArray(refs) && refs.length === 2) {
    const cells = refs.map((ref) => Number(typeof ref === "object" ? ref.cell : ref));
    return cells.every(Number.isInteger) ? cells : null;
  }
  if (Array.isArray(clue.location?.cells) && clue.location.cells.length === 2) {
    const cells = clue.location.cells.map(Number);
    return cells.every(Number.isInteger) ? cells : null;
  }
  if (Array.isArray(clue.cells) && clue.cells.length === 2) {
    const cells = clue.cells.map(Number);
    return cells.every(Number.isInteger) ? cells : null;
  }
  return null;
}

function relationClueLabel(clue) {
  if (clue.ruleId === "gemini") return "G";
  if (clue.ruleId === "delta") return "D";
  if (clue.ruleId === "difference") return String(clue.value ?? clue.params?.difference ?? 0);
  if (clue.ruleId === "inequality") return clue.params?.direction === "gt" ? ">" : "<";
  return ruleLabel(clue.ruleId);
}

function cellCenter(cell) {
  const point = xy(cell, puzzle.width);
  return {
    x: SVG_PAD + point.x * CELL + CELL / 2,
    y: SVG_PAD + point.y * CELL + CELL / 2
  };
}

function clearEdgeRelationsForRule(ruleId, edgeConstraints) {
  const relation = ruleId === "gemini" ? "sameShape" : ruleId === "delta" ? "differentShape" : null;
  if (!relation) return edgeConstraints;
  const next = {};
  for (const [key, value] of Object.entries(edgeConstraints)) {
    const constraint = { ...value };
    if (constraint.relation === relation) constraint.relation = null;
    if (constraint.state || constraint.relation) next[key] = constraint;
  }
  return next;
}

function toggleDraftCell(targetSet, key) {
  if (!key) return;
  if (targetSet.has(key)) targetSet.delete(key);
  else targetSet.add(key);
}

function shapeCellsFromDraft(targetSet) {
  const cells = [...targetSet].map((key) => key.split(",").map(Number));
  return cells.length ? normalizeShape(cells) : [];
}

function compassParamsFromForm() {
  const params = {};
  for (const [direction, input] of [
    ["N", el.compassNInput],
    ["E", el.compassEInput],
    ["S", el.compassSInput],
    ["W", el.compassWInput]
  ]) {
    if (input.value === "") continue;
    params[direction] = Math.max(0, Number(input.value) || 0);
  }
  return params;
}

function compassToolParameterText() {
  const params = compassParamsFromForm();
  const labels = Object.entries(params).map(([direction, value]) => `${direction} ${value}`);
  return labels.length ? labels.join(", ") : "No directional restrictions; still counts as a cell clue.";
}

function shapeBankLineCount() {
  return String(el.shapeBankInput.value ?? "")
    .split(/\r?\n/)
    .filter((line) => line.trim() && !line.trim().startsWith("#")).length;
}

function updateTraceFromForm() {
  traceImage.opacity = clamp(Number(el.screenshotOpacityInput.value), 0, 1);
  traceImage.x = Number(el.screenshotXInput.value) || 0;
  traceImage.y = Number(el.screenshotYInput.value) || 0;
  traceImage.scale = clamp(Number(el.screenshotScaleInput.value) || 1, 0.1, 5);
  traceImage.rotation = Number(el.screenshotRotationInput.value) || 0;
  traceImage.locked = Boolean(el.screenshotLockInput.checked);
  traceImage.gridOpacity = clamp(Number(el.gridOpacityInput.value), 0, 1);
  traceImage.cellOpacity = clamp(Number(el.cellFillOpacityInput.value), 0, 1);
}

function updateTraceControls() {
  el.screenshotOpacityInput.value = String(traceImage.opacity);
  el.screenshotXInput.value = String(traceImage.x);
  el.screenshotYInput.value = String(traceImage.y);
  el.screenshotScaleInput.value = String(traceImage.scale);
  el.screenshotRotationInput.value = String(traceImage.rotation);
  el.screenshotLockInput.checked = traceImage.locked;
  el.gridOpacityInput.value = String(traceImage.gridOpacity);
  el.cellFillOpacityInput.value = String(traceImage.cellOpacity);
  for (const input of [el.screenshotXInput, el.screenshotYInput, el.screenshotScaleInput, el.screenshotRotationInput]) {
    input.disabled = traceImage.locked;
  }
  el.fitScreenshotButton.disabled = traceImage.locked;
  el.resetScreenshotButton.disabled = traceImage.locked;
}

function updateRelationHint() {
  el.relationPickHint.hidden = !isRelationTool(currentTool);
  if (!isRelationTool(currentTool)) {
    el.relationPickHint.textContent = "Choose Gemini, Delta, Difference or Inequality, then click an edge or two edge-adjacent active cells.";
    return;
  }
  if (relationFirstCell === null) {
    el.relationPickHint.textContent = `Click an edge, or click the first cell, for an edge-adjacent ${ruleLabel(currentTool)} relation clue.`;
    return;
  }
  el.relationPickHint.textContent = `First cell: ${cellLabel(relationFirstCell, puzzle.width)}. Click an edge-adjacent second cell.`;
}

function hasCandidateSource() {
  return hasUiCandidateSource(puzzle);
}

function areCellsOrthogonallyAdjacent(a, b) {
  const left = xy(a, puzzle.width);
  const right = xy(b, puzzle.width);
  return Math.abs(left.x - right.x) + Math.abs(left.y - right.y) === 1;
}

function hasRuleClue(ruleId) {
  return (puzzle.clues ?? []).some((clue) => clue.ruleId === ruleId);
}

function isRuleActive(id) {
  if (id === "precision") return Number(puzzle.rules.precision?.area ?? puzzle.rules.area) > 0;
  if (id === "rose_window") return Boolean(puzzle.rules.rose_window);
  if (id === "shape_bank") return Boolean(puzzle.rules.shape_bank);
  return puzzle.rules[id] !== undefined;
}

function ruleHelp(id) {
  return RULE_HELP[id] ?? "Registered rule.";
}

function ruleLabel(id) {
  return RULE_REGISTRY[id]?.label ?? id;
}

function showSolveResult(result) {
  const errors = result.errors.length ? `\n\nWarnings/errors:\n${result.errors.join("\n")}` : "";
  const engine = result.candidatePlan?.kind === "borders" ? "Solver: border search" : `Candidates: ${result.candidates.length}`;
  const base = `Status: ${humanStatus(result.status)}\n${engine}\nSearch nodes: ${result.nodeCount}${result.truncated ? "\nSearch stopped at a limit or after enough solutions." : ""}`;

  if (!currentSolution) {
    renderStatus(base + errors, result.status === "no_solution" ? "bad" : "warn");
    if (result.status === "no_solution") showNoSolutionDebug(result);
    else if (el.noSolutionBox) el.noSolutionBox.hidden = true;
    el.solutionText.textContent = "";
    return;
  }

  const summary = summarizeSolution(currentSolution, puzzle);
  const statusClass = result.status === "unique_solution" ? "good" : "warn";
  renderStatus(base + errors, statusClass);
  if (el.noSolutionBox) el.noSolutionBox.hidden = true;
  el.solutionText.textContent = `${summary}\n\n${result.status === "multiple_solutions" ? "At least two solutions exist. The overlay shows the first one found." : "Overlay shows the solution found."}`;
}

function showStepResult(result) {
  if (result.step) {
    renderStatus(`${result.step.title}\n\n${result.step.reason}`, "good");
    el.solutionText.textContent = formatStepDetails(result.step);
    return;
  }
  const statusClass = result.status === "no_solution" ? "bad" : "warn";
  renderStatus(result.message, statusClass);
  if (result.base?.solutions?.[0]) {
    currentSolution = result.base.solutions[0];
    el.solutionText.textContent = summarizeSolution(currentSolution, puzzle);
  }
}

function showCandidatesForSelectedCell(result) {
  const lines = [
    `Selected cell: ${result.label}`,
    `Candidate count: ${result.count}`,
    result.errors.length ? `Solver warnings/errors: ${result.errors.join("; ")}` : ""
  ].filter(Boolean);

  for (const candidate of result.candidates) {
    const source = candidate.ruleId ? ` via ${ruleLabel(candidate.ruleId)}` : "";
    const name = candidate.sourceName ? ` (${candidate.sourceName})` : "";
    lines.push(`- #${candidate.id}: ${candidate.labels.join(", ")}; area ${candidate.area}; shape ${candidate.shapeKey}${source}${name}`);
  }

  el.solutionText.textContent = lines.join("\n");
  renderStatus(`Showing ${result.count} candidate${result.count === 1 ? "" : "s"} for ${result.label}.`, result.count ? "good" : "warn");
}

function showNoSolutionDebug(result) {
  if (!el.noSolutionBox) return;
  el.noSolutionBox.hidden = false;
  el.noSolutionBox.innerHTML = noSolutionDebugHtml(result);
}

function noSolutionDebugHtml(result) {
  const validation = validatePuzzle(puzzle);
  if (result.candidatePlan?.kind === "borders") {
    const activeRules = Object.values(RULE_REGISTRY).filter((rule) => isRuleActive(rule.id)).map((rule) => rule.label);
    return [
      debugSection("Validation", validation.errors.length ? validation.errors : ["No validation errors."]),
      debugSection("Solver", ["The border search tried every possibility and none satisfies all rules.", ...(result.errors ?? [])]),
      debugSection("Active rules", activeRules.length ? activeRules : ["No rules are active."])
    ].join("");
  }
  let diagnostics = null;
  let violations = [];
  const diagnosticLimit = Math.min(maxNodes(), 20000);
  try {
    diagnostics = generateCandidateDiagnostics(puzzle, { maxCandidates: diagnosticLimit });
    violations = explainCandidateViolations(puzzle, { maxCandidates: diagnosticLimit }).slice(0, 6);
  } catch (error) {
    diagnostics = { errors: [`Candidate diagnostics failed: ${error.message}`], plan: result.candidatePlan ?? null, raw: [], accepted: [], rejected: [] };
  }

  const acceptedByCell = new Map();
  for (const cell of puzzle.activeCells ?? []) acceptedByCell.set(cell, 0);
  for (const candidate of diagnostics.accepted ?? []) {
    for (const cell of candidate.cells ?? []) acceptedByCell.set(cell, (acceptedByCell.get(cell) ?? 0) + 1);
  }
  const zeroCells = [...acceptedByCell.entries()].filter(([, count]) => count === 0).map(([cell]) => cellLabel(cell, puzzle.width));
  const activeRules = Object.values(RULE_REGISTRY)
    .filter((rule) => isRuleActive(rule.id))
    .map((rule) => rule.label);
  const plan = diagnostics.plan ?? result.candidatePlan ?? null;

  return [
    debugSection("Validation", validation.errors.length ? validation.errors : ["No validation errors."]),
    debugSection("Candidate source", [
      plan ? `Kind: ${plan.kind}${plan.ruleId ? ` via ${ruleLabel(plan.ruleId)}` : ""}.` : "No candidate-source plan was available.",
      ...(diagnostics.errors ?? [])
    ]),
    debugSection("Candidate counts", [
      `Generated before filtering: ${(diagnostics.raw ?? []).length}.`,
      `Accepted after filtering: ${(diagnostics.accepted ?? []).length}.`,
      `Directly rejected: ${(diagnostics.rejected ?? []).length}.`
    ]),
    debugSection("Cells with zero accepted candidates", zeroCells.length ? zeroCells : ["None."]),
    debugSection(
      "First direct candidate rejections",
      violations.length ? violations.map((step) => `${ruleLabel(step.ruleId)}: ${step.reason}`) : ["No direct candidate rejections were available."]
    ),
    debugSection("Active rules", activeRules.length ? activeRules : ["No rules are active."])
  ].join("");
}

function debugSection(title, items) {
  return `<section><h3>${escapeHtml(title)}</h3><ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></section>`;
}

function formatStepDetails(step) {
  const proof = step.proof ? `Proof: ${step.proof.result} under ${JSON.stringify(step.proof.assumption)}.` : "";
  const rule = step.ruleId ? `Rule: ${ruleLabel(step.ruleId)}.` : "Rule: exact-cover consistency.";
  const apply = isStepApplyable(step) ? "Use Apply step to add this deduction to the puzzle state." : "This explanation is informative and has no direct state change.";
  return `${step.reason}\n\n${rule}\n${proof}\n${apply}`;
}

function renderStatus(text, kind) {
  el.statusBox.textContent = text;
  el.statusBox.className = `status ${kind ?? ""}`;
}

function humanStatus(status) {
  return {
    unique_solution: "unique solution",
    multiple_solutions: "multiple solutions",
    no_solution: "no solution",
    search_limit: "search limit reached",
    solution_found: "solution found"
  }[status] ?? status;
}

function regionColor(regionId) {
  const hue = (regionId * 47) % 360;
  return `hsl(${hue}, 78%, 82%)`;
}

function maxMillis() {
  return Math.max(1, Number(el.maxSecondsInput.value) || 60) * 1000;
}

// ---- Solver worker: long searches run off the main thread and can be cancelled.

let solverWorker = null;
let solverTaskId = 0;
let pendingSolverTask = null;

function solverWorkerInstance() {
  if (solverWorker) return solverWorker;
  try {
    solverWorker = new Worker(new URL("./solver-worker.js", import.meta.url), { type: "module" });
  } catch {
    solverWorker = null;
    return null;
  }
  solverWorker.addEventListener("message", (event) => {
    const { id, ok, result, error } = event.data;
    if (!pendingSolverTask || pendingSolverTask.id !== id) return;
    const task = pendingSolverTask;
    finishSolverTask();
    if (ok) task.resolve(result);
    else {
      renderStatus(`Solver error: ${error}`, "bad");
      task.resolve(null);
    }
  });
  solverWorker.addEventListener("error", (event) => {
    // Module workers are unavailable (e.g. opened from file://): run on the page instead.
    event.preventDefault();
    const task = pendingSolverTask;
    solverWorker.terminate();
    solverWorker = false;
    finishSolverTask();
    if (task) task.resolve(runSolverTaskHere(task.task, task.options));
  });
  return solverWorker;
}

/** Same work as the worker, on the page; used only when workers are unavailable. */
function runSolverTaskHere(task, options) {
  const snapshot = JSON.parse(JSON.stringify(puzzle));
  if (task === "solve") return solvePuzzle(snapshot, options);
  if (task === "nextStep") return findNextLogicalStep(snapshot, options);
  return explainAllLogicalSteps(snapshot, options);
}

/** Runs a solver task in the worker. Resolves with the result, or null if cancelled or failed. */
function runSolverTask(task, options, busyText) {
  if (pendingSolverTask) cancelSolverTask();
  const worker = solverWorker === false ? null : solverWorkerInstance();
  if (!worker) return Promise.resolve(runSolverTaskHere(task, options));
  const id = ++solverTaskId;
  setSolverBusy(true);
  renderStatus(`${busyText} (up to ${Math.round(options.maxMillis / 1000)} s; Cancel stops it)`, "");
  return new Promise((resolve) => {
    pendingSolverTask = { id, task, options, resolve };
    worker.postMessage({ id, task, puzzle: JSON.parse(JSON.stringify(puzzle)), options });
  });
}

function cancelSolverTask() {
  if (!pendingSolverTask) return;
  const task = pendingSolverTask;
  // Terminating is the only way to stop a running search; a fresh worker starts next time.
  solverWorker?.terminate();
  solverWorker = null;
  finishSolverTask();
  renderStatus("Stopped.", "warn");
  task.resolve(null);
}

function finishSolverTask() {
  pendingSolverTask = null;
  setSolverBusy(false);
}

function setSolverBusy(busy) {
  el.cancelSolveButton.hidden = !busy;
  for (const button of [el.solveButton, el.nextStepButton, el.explainAllButton]) button.disabled = busy;
}

function maxNodes() {
  return Math.max(1000, Number(el.maxNodesInput.value) || 250000);
}

function checkedAttr(value) {
  return value ? "checked" : "";
}

function disabledAttr(value) {
  return value ? "disabled" : "";
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

// ---- In-game-editor hotkeys -------------------------------------------------

function boardPointFromEvent(event) {
  const ctm = el.boardSvg.getScreenCTM();
  if (!ctm) return null;
  const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(ctm.inverse());
  return { x: point.x, y: point.y };
}

function setHotkeyMode(mode) {
  hotkeyMode = mode;
  clearTimeout(hotkeyModeTimer);
  if (mode) hotkeyModeTimer = setTimeout(() => setHotkeyMode(null), HOTKEY_MODE_TIMEOUT_MS);
  el.boardSvg.dataset.hotkeyMode = mode ?? "";
}

function bindHotkeys() {
  el.boardSvg.addEventListener("pointermove", (event) => {
    const point = boardPointFromEvent(event);
    hoverTarget = point ? locateBoardPoint(point, puzzle) : null;
    renderHoverOverlay();
  });
  el.boardSvg.addEventListener("pointerleave", () => {
    hoverTarget = null;
    renderHoverOverlay();
  });

  el.boardSvg.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    const point = boardPointFromEvent(event);
    const target = point ? locateBoardPoint(point, puzzle) : null;
    if (target?.cell === undefined) return;
    handleCellClickWithTool(target.cell, "cell");
  });

  // Walls are drawn live: pressing on a corner starts a stroke, and every
  // corner the pointer then reaches draws (or erases) the wall to it at once.
  el.boardSvg.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    const point = boardPointFromEvent(event);
    const target = point ? locateBoardPoint(point, puzzle) : null;
    if (target?.type !== "vertex") return;
    event.preventDefault();
    wallStroke = { last: target, lastPoint: point, mode: null, changed: false, moved: false, segments: 0 };
  });
  el.boardSvg.addEventListener("pointermove", (event) => {
    if (!wallStroke) return;
    if (!(event.buttons & 1)) {
      finishWallStroke();
      return;
    }
    const point = boardPointFromEvent(event);
    if (!point) return;
    let redraw = false;
    for (const corner of cornersCrossed(wallStroke.lastPoint, point, puzzle)) {
      if (corner.x === wallStroke.last.x && corner.y === wallStroke.last.y) continue;
      const result = applyWallSegment(puzzle, wallStroke.last, corner, wallStroke.mode);
      wallStroke.mode = result.mode;
      if (result.changed) {
        if (!wallStroke.changed) clearComputed();
        puzzle = result.puzzle;
        wallStroke.changed = true;
        wallStroke.segments += 1;
        redraw = true;
      }
      wallStroke.last = corner;
      wallStroke.moved = true;
    }
    wallStroke.lastPoint = point;
    if (redraw) renderBoard();
  });
  window.addEventListener("pointerup", finishWallStroke);
  window.addEventListener("pointercancel", finishWallStroke);

  document.addEventListener("keydown", (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.target.closest?.("input, textarea, select, [contenteditable]")) return;
    const action = resolveHotkey(event.key, {
      target: hoverTarget,
      mode: hotkeyMode,
      width: puzzle.width,
      currentPalisade: hoveredPalisadePattern()
    });
    if (!action) return;
    event.preventDefault();
    runHotkeyAction(action);
  });
}

/** Ends a wall stroke: records it as one undo step and swallows the click that follows. */
function finishWallStroke() {
  const stroke = wallStroke;
  if (!stroke) return;
  wallStroke = null;
  // A press on a corner is a wall gesture, so the trailing click must not also
  // toggle a cell or hit a border. Watchtower keeps plain corner clicks.
  if (stroke.moved || currentTool !== "watchtower") {
    suppressBoardClick = true;
    setTimeout(() => {
      suppressBoardClick = false;
    }, 0);
  }
  if (!stroke.changed) return;
  const erased = stroke.mode === "erase";
  commitPuzzle(puzzle, erased ? "Erased walls" : "Drew walls");
  renderStatus(`${erased ? "Erased" : "Drew"} ${stroke.segments} wall segment${stroke.segments === 1 ? "" : "s"}.`, "good");
  render();
}

function hoveredPalisadePattern() {
  if (hoverTarget?.cell === undefined) return null;
  const clue = (puzzle.clues ?? []).find((item) => item.ruleId === "palisade" && item.location?.cell === hoverTarget.cell);
  return clue?.params?.pattern ?? null;
}

function handleCellClickWithTool(cell, tool) {
  const previous = currentTool;
  currentTool = tool;
  try {
    handleCellClick(cell);
  } finally {
    currentTool = previous;
  }
}

function runHotkeyAction(action) {
  const where = (cell) => cellLabel(cell, puzzle.width);
  switch (action.type) {
    case "clearMode":
      setHotkeyMode(null);
      renderStatus("Hotkey mode cleared.", "warn");
      return;
    case "setMode": {
      setHotkeyMode(action.mode);
      const hint = {
        rose: "Rose Window: hover a cell and press 1-5.",
        palisade: "Palisade: hover a cell and press 0-4 (2 twice for opposite).",
        compass: "Compass: hover near a cell side and press 0-9."
      }[action.mode];
      renderStatus(hint, "good");
      return;
    }
    case "selectRelation":
      setCurrentTool(action.ruleId);
      renderStatus(`${ruleLabel(action.ruleId)} selected. Hover a border and press the key, or click a border.`, "good");
      return;
    case "relation":
      commitPuzzle(upsertRelationClue(action.ruleId, action.a, action.b), `Placed ${ruleLabel(action.ruleId)} relation clue`);
      renderStatus(`${ruleLabel(action.ruleId)} relation clue placed on an edge.`, "good");
      break;
    case "difference":
      el.differenceValueInput.value = String(action.value);
      commitPuzzle(upsertRelationClue("difference", action.a, action.b), `Placed Difference ${action.value}`);
      renderStatus(`Difference ${action.value} placed on an edge.`, "good");
      break;
    case "inequality":
      el.inequalityDirectionInput.value = action.direction;
      commitPuzzle(upsertRelationClue("inequality", action.a, action.b), "Placed Inequality clue");
      renderStatus("Inequality clue placed on an edge.", "good");
      break;
    case "watchtower":
      el.watchtowerValueInput.value = String(action.value);
      commitPuzzle(upsertVertexClue("watchtower", action.vertex, { value: action.value }), `Placed Watchtower ${action.value}`);
      selectedClueId = `watchtower:${action.vertex.x}:${action.vertex.y}`;
      renderStatus(`Watchtower ${action.value} placed at vertex (${action.vertex.x}, ${action.vertex.y}).`, "good");
      break;
    case "polyomino":
      if (action.cell === null) {
        setCurrentTool("polyomino");
        renderStatus("Polyomino tool selected. Draw the clue shape, then hover a cell and press P.", "good");
        return;
      }
      handleCellClickWithTool(action.cell, "polyomino");
      return;
    case "areaNumber": {
      const now = Date.now();
      const chained = lastAreaDigit.cell === action.cell && now - lastAreaDigit.at < AREA_DIGIT_CHAIN_MS;
      const value = chained ? Math.min(99, lastAreaDigit.value * 10 + action.digit) : action.digit;
      lastAreaDigit = { cell: action.cell, value, at: now };
      if (value < 1) {
        renderStatus("Area numbers start at 1. Type 1-9, or two digits for 10 and up.", "warn");
        return;
      }
      if (!puzzle.active[action.cell]) {
        renderStatus(`Cell ${where(action.cell)} is inactive. Activate it before placing clues.`, "warn");
        return;
      }
      el.areaClueValueInput.value = String(value);
      commitPuzzle(upsertCellClue("area_number", action.cell, { value, params: { value } }), `Placed Area Number ${value} on ${where(action.cell)}`);
      renderStatus(`Area Number ${value} placed on ${where(action.cell)}.`, "good");
      break;
    }
    case "rose":
      if (!puzzle.active[action.cell]) return;
      commitPuzzle(setCellSymbol(puzzle, action.cell, action.symbol), `Set symbol ${action.symbol} on ${where(action.cell)}`);
      renderStatus(`Rose Window symbol ${action.symbol} set on ${where(action.cell)}.`, "good");
      setHotkeyMode(hotkeyMode);
      break;
    case "palisade":
      if (!puzzle.active[action.cell]) return;
      el.palisadePatternInput.value = action.pattern;
      commitPuzzle(upsertCellClue("palisade", action.cell, { params: { pattern: action.pattern } }), `Placed Palisade on ${where(action.cell)}`);
      renderStatus(`Palisade ${action.pattern} placed on ${where(action.cell)}.`, "good");
      setHotkeyMode(hotkeyMode);
      break;
    case "compass": {
      if (!puzzle.active[action.cell]) return;
      const existing = (puzzle.clues ?? []).find((item) => item.ruleId === "compass" && item.location?.cell === action.cell);
      const params = { ...(existing?.params ?? {}), [action.side]: action.value };
      commitPuzzle(upsertCellClue("compass", action.cell, { params }), `Set Compass ${action.side} ${action.value} on ${where(action.cell)}`);
      renderStatus(`Compass ${action.side} ${action.value} set on ${where(action.cell)}.`, "good");
      setHotkeyMode(hotkeyMode);
      break;
    }
    case "delete":
      if (!deleteClueAtTarget(action.target)) {
        renderStatus("No clue under the pointer.", "warn");
        return;
      }
      break;
    default:
      return;
  }
  render();
}

function deleteClueAtTarget(target) {
  const clues = puzzle.clues ?? [];
  let remove = [];
  let next = puzzle;
  if (target.type === "vertex") {
    remove = clues.filter((clue) => clue.type === "vertex" && Number(clue.location?.x) === target.x && Number(clue.location?.y) === target.y);
  } else if (target.type === "edge") {
    // Removes the effect but keeps the wall it sits on.
    next = removeBorderEffects(puzzle, target.a, target.b);
    if (next !== puzzle) remove.push(null);
  } else if (target.type === "cell") {
    remove = (cellCluesByCell().get(target.cell) ?? []).filter((clue) => ["area_number", "polyomino", "palisade", "compass"].includes(clue.ruleId));
  }
  if (remove.length === 0) return false;
  const ids = new Set(remove.filter(Boolean).map((clue) => clue.id));
  commitPuzzle({ ...next, clues: (next.clues ?? []).filter((clue) => !ids.has(clue.id)) }, "Removed clue");
  selectedClueId = null;
  renderStatus("Clue removed.", "good");
  return true;
}
