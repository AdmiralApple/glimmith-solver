import { parseGameMetadata, parseGamePuzzle } from "../core/game-format.js";

/**
 * Groups files picked from the game's folders into puzzles. A game puzzle is a
 * folder holding a `puzzle` text file and usually a `metadata` file. Works for
 * a picked `workshop` folder (many puzzles), a single puzzle folder, or files
 * picked directly.
 * @param {Iterable<File>} files
 * @returns {{ folder: string, puzzleFile: File, metadataFile: File|null }[]}
 */
export function groupGamePuzzleFiles(files) {
  const byFolder = new Map();
  for (const file of files) {
    const path = file.webkitRelativePath || file.name;
    const slash = path.lastIndexOf("/");
    const folder = slash >= 0 ? path.slice(0, slash) : "";
    const name = (slash >= 0 ? path.slice(slash + 1) : path).toLowerCase();
    if (name !== "puzzle" && name !== "metadata") continue;
    const entry = byFolder.get(folder) ?? { folder, puzzleFile: null, metadataFile: null };
    if (name === "puzzle") entry.puzzleFile = file;
    else entry.metadataFile = file;
    byFolder.set(folder, entry);
  }
  return [...byFolder.values()].filter((entry) => entry.puzzleFile);
}

/**
 * Reads and parses each grouped puzzle. Entries that fail to parse are kept
 * with an `error` so the list can say why.
 */
export async function readGamePuzzleEntries(groups) {
  const entries = await Promise.all(
    groups.map(async ({ folder, puzzleFile, metadataFile }) => {
      const text = await puzzleFile.text();
      const meta = metadataFile ? parseGameMetadata(new Uint8Array(await metadataFile.arrayBuffer())) : null;
      const fallbackTitle = folder.split("/").pop() || puzzleFile.name;
      const entry = {
        folder,
        text,
        meta: meta ?? {},
        title: meta?.title || fallbackTitle,
        author: meta?.author || "",
        description: meta?.description || ""
      };
      try {
        const { puzzle, difficulty } = parseGamePuzzle(text, entry.meta);
        entry.width = puzzle.width;
        entry.height = puzzle.height;
        entry.difficulty = difficulty;
      } catch (error) {
        entry.error = error.message;
      }
      return entry;
    })
  );
  return entries.sort((a, b) => a.title.localeCompare(b.title));
}
