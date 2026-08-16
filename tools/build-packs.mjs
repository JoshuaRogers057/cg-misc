#!/usr/bin/env node
/**
 * Compile packs/_source/<pack name>/*.json into the LevelDB compendia Foundry actually reads.
 *
 * Foundry stores a v13 pack as one key per document: `!items!<id>` for a document in an Item
 * pack, `!tables!<id>` in a RollTable pack, and a separate key per embedded document, e.g.
 * `!items.effects!<itemId>.<effectId>` or `!tables.results!<tableId>.<resultId>`. The parent's
 * embedded array holds only ids. The source JSON here is written the natural way - embedded
 * documents inline - and this script splits it.
 *
 * Which packs exist is read from module.json, so adding a pack there and a matching source
 * directory is all it takes.
 *
 * Usage:
 *   node tools/build-packs.mjs [--foundry "<path to Foundry's resources/app>"]
 *
 * classic-level is resolved from node_modules if installed, otherwise borrowed from a local
 * Foundry installation, which always ships it.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";

const ROOT = path.resolve(import.meta.dirname, "..");
const SOURCE_ROOT = path.join(ROOT, "packs", "_source");

/** Document type -> the primary key segment and which of its fields hold embedded documents. */
const PACK_TYPES = {
  Item: { primary: "items", embedded: { effects: "effects" } },
  RollTable: { primary: "tables", embedded: { results: "results" } }
};

const FOUNDRY_CANDIDATES = [
  process.env.FOUNDRY_APP,
  "C:/Program Files/Foundry Virtual Tabletop/resources/app",
  "/Applications/Foundry Virtual Tabletop.app/Contents/Resources/app",
  "/usr/share/foundryvtt/resources/app"
];

async function loadClassicLevel() {
  try {
    return (await import("classic-level")).ClassicLevel;
  } catch {
    // Not installed locally; fall through to a Foundry installation.
  }

  const flagIndex = process.argv.indexOf("--foundry");
  const candidates = [flagIndex !== -1 ? process.argv[flagIndex + 1] : null, ...FOUNDRY_CANDIDATES];

  for (const base of candidates) {
    if (!base) continue;
    const entry = path.join(base, "node_modules", "classic-level", "index.js");
    if (existsSync(entry)) return (await import(pathToFileURL(entry).href)).ClassicLevel;
  }

  throw new Error(
    "Could not find classic-level. Either run `npm install classic-level`, or pass "
      + '`--foundry "<path to Foundry\'s resources/app>"`.'
  );
}

async function buildPack(ClassicLevel, pack) {
  const spec = PACK_TYPES[pack.type];
  if (!spec) throw new Error(`Pack "${pack.name}" has unsupported type "${pack.type}"`);

  const sourceDir = path.join(SOURCE_ROOT, pack.name);
  if (!existsSync(sourceDir)) throw new Error(`No source directory for pack "${pack.name}" at ${sourceDir}`);

  const files = (await fs.readdir(sourceDir)).filter((f) => f.endsWith(".json"));
  if (!files.length) throw new Error(`No source documents in ${sourceDir}`);

  const packDir = path.join(ROOT, pack.path);
  // Rebuild from scratch so documents deleted from _source don't survive in the pack.
  await fs.rm(packDir, { recursive: true, force: true });
  await fs.mkdir(packDir, { recursive: true });

  const db = new ClassicLevel(packDir, { keyEncoding: "utf8", valueEncoding: "json" });
  await db.open();

  const batch = db.batch();
  const counts = { documents: 0, embedded: 0 };

  for (const file of files) {
    const doc = JSON.parse(await fs.readFile(path.join(sourceDir, file), "utf8"));
    if (!doc._id) throw new Error(`${pack.name}/${file} has no _id`);

    const flattened = { ...doc };

    for (const [field, collection] of Object.entries(spec.embedded)) {
      const children = Array.isArray(doc[field]) ? doc[field] : [];
      for (const child of children) {
        if (!child._id) throw new Error(`${pack.name}/${file} has a ${field} entry with no _id`);
        batch.put(`!${spec.primary}.${collection}!${doc._id}.${child._id}`, child);
        counts.embedded++;
      }
      flattened[field] = children.map((c) => c._id);
    }

    batch.put(`!${spec.primary}!${doc._id}`, flattened);
    counts.documents++;
  }

  await batch.write();
  await db.close();

  console.log(
    `Built ${pack.path}: ${counts.documents} ${pack.type} document(s), ${counts.embedded} embedded.`
  );
}

async function main() {
  const ClassicLevel = await loadClassicLevel();
  const manifest = JSON.parse(await fs.readFile(path.join(ROOT, "module.json"), "utf8"));

  for (const pack of manifest.packs ?? []) await buildPack(ClassicLevel, pack);
}

await main();
