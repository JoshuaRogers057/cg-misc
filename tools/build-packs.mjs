#!/usr/bin/env node
/**
 * Compile packs/_source/*.json into the LevelDB compendium Foundry actually reads.
 *
 * Foundry stores a v13 pack as one key per document: `!items!<itemId>` for the item, and a
 * separate `!items.effects!<itemId>.<effectId>` for each embedded effect, with the parent's
 * `effects` array holding only the effect ids. The source JSON here is written the natural
 * way - effects inline - and this script splits it.
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
const SOURCE_DIR = path.join(ROOT, "packs", "_source");
const PACK_DIR = path.join(ROOT, "packs", "cg-misc-effects");

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

async function main() {
  const ClassicLevel = await loadClassicLevel();

  const files = (await fs.readdir(SOURCE_DIR)).filter((f) => f.endsWith(".json"));
  if (!files.length) throw new Error(`No source documents in ${SOURCE_DIR}`);

  // Rebuild from scratch so documents deleted from _source don't survive in the pack.
  await fs.rm(PACK_DIR, { recursive: true, force: true });
  await fs.mkdir(PACK_DIR, { recursive: true });

  const db = new ClassicLevel(PACK_DIR, { keyEncoding: "utf8", valueEncoding: "json" });
  await db.open();

  const batch = db.batch();
  let items = 0;
  let effects = 0;

  for (const file of files) {
    const doc = JSON.parse(await fs.readFile(path.join(SOURCE_DIR, file), "utf8"));
    if (!doc._id) throw new Error(`${file} has no _id`);

    const embedded = Array.isArray(doc.effects) ? doc.effects : [];
    for (const effect of embedded) {
      if (!effect._id) throw new Error(`${file} has an effect with no _id`);
      batch.put(`!items.effects!${doc._id}.${effect._id}`, effect);
      effects++;
    }

    batch.put(`!items!${doc._id}`, { ...doc, effects: embedded.map((e) => e._id) });
    items++;
  }

  await batch.write();
  await db.close();

  console.log(`Built ${path.relative(ROOT, PACK_DIR)}: ${items} item(s), ${effects} effect(s).`);
}

await main();
