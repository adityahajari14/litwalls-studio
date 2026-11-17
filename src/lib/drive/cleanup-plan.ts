/**
 * Which old Drive folders can go. Pure: it is handed a listing of everything
 * Studio has on Drive and decides, so the rules can be tested without Drive.
 *
 * The folders in question are the ones the old uploader made by matching on
 * NAME — "Ferrari F1 #01" — which several posters ended up sharing. Once each
 * of those posters has been re-filed into a folder of its own, the shared one
 * is a pile of duplicates nobody points at.
 *
 * A folder is removed only if ALL of these hold:
 *   - it is a poster folder: <root>/<collection>/<this>, never a collection
 *     folder or the root;
 *   - it is not tagged to a product (every folder the current uploader makes
 *     is tagged, so an untagged one can only be from the old code);
 *   - no poster on this machine points at it, as its folder or as the folder
 *     its product's link goes to;
 *   - it holds no subfolders (poster folders never do, so one that does was
 *     made by a person, not by Studio);
 *   - every original artwork in it also exists, byte for byte (same MD5), in
 *     a folder that is staying. The originals are the one thing that cannot
 *     be re-made; the print PNGs beside them are rendered from the original
 *     and are re-rendered on every filing anyway.
 * Anything else is kept, with the reason, so nothing goes quietly.
 */

export type DriveFolderEntry = {
  id: string;
  name: string;
  parents: string[];
  /** The product key from the folder's app property, if it has one. */
  productTag: string | null;
};

export type DriveFileEntry = {
  id: string;
  name: string;
  parents: string[];
  md5: string | null;
};

export type CleanupFolder = {
  id: string;
  name: string;
  collection: string;
  files: number;
};

export type CleanupPlan = {
  remove: CleanupFolder[];
  keep: (CleanupFolder & { reason: string })[];
};

/** An original artwork, as the uploader names it: original.jpg, original.png… */
function isOriginal(name: string): boolean {
  return /^original(\.[^.]+)?$/i.test(name);
}

export function planCleanup(input: {
  rootId: string;
  folders: DriveFolderEntry[];
  files: DriveFileEntry[];
  /** Every folder id a poster on this machine points at. */
  referenced: ReadonlySet<string>;
}): CleanupPlan {
  const { rootId, folders, files, referenced } = input;

  const collections = new Map(
    folders.filter((f) => f.parents.includes(rootId)).map((f) => [f.id, f.name]),
  );
  const posterFolders = folders.filter((f) => f.parents.some((p) => collections.has(p)));
  const isLegacy = (f: DriveFolderEntry) => !f.productTag && !referenced.has(f.id);

  const legacy = posterFolders.filter(isLegacy);
  const legacyIds = new Set(legacy.map((f) => f.id));
  const staying = new Set(posterFolders.filter((f) => !legacyIds.has(f.id)).map((f) => f.id));

  // Every artwork that is safe in a folder that stays.
  const keptHashes = new Set(
    files
      .filter((file) => file.md5 && file.parents.some((p) => staying.has(p)))
      .map((file) => file.md5 as string),
  );

  const plan: CleanupPlan = { remove: [], keep: [] };
  for (const folder of legacy) {
    const inside = files.filter((file) => file.parents.includes(folder.id));
    const entry: CleanupFolder = {
      id: folder.id,
      name: folder.name,
      collection: collections.get(folder.parents.find((p) => collections.has(p))!) ?? "",
      files: inside.length,
    };

    if (folders.some((f) => f.parents.includes(folder.id))) {
      plan.keep.push({ ...entry, reason: "has subfolders — not made by Studio" });
      continue;
    }
    const orphan = inside.find(
      (file) => isOriginal(file.name) && !(file.md5 && keptHashes.has(file.md5)),
    );
    if (orphan) {
      plan.keep.push({
        ...entry,
        // Either a poster still waiting to be re-filed, or one whose batch was
        // deleted here — in which case this folder is the only copy left.
        reason: `its ${orphan.name} is in no other folder, so this may be the only copy`,
      });
      continue;
    }
    plan.remove.push(entry);
  }

  const byName = (a: CleanupFolder, b: CleanupFolder) =>
    a.collection.localeCompare(b.collection) || a.name.localeCompare(b.name);
  plan.remove.sort(byName);
  plan.keep.sort(byName);
  return plan;
}
