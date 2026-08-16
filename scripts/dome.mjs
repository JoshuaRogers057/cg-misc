import { MODULE_ID, MODULE_TITLE, SETTING, FLAG, PACK, DOME, DOME_TABLE_ID, debugLog } from "./constants.mjs";

/**
 * The Dome: while it is up, magic and rest inside it warp.
 *
 *   leveled healing spell     -> healing table
 *   leveled necromancy spell  -> necromancy table
 *   any other leveled spell   -> wild magic table
 *   finishing a short rest    -> rest mutation table, once per resting character
 *
 * Cantrips are exempt, and every actor is affected - PCs, NPCs and monsters alike.
 *
 * Both seams are dnd5e's own, so none of this depends on midi-qol:
 *   `dnd5e.postUseActivity` (dnd5e.mjs:16917) fires once per activity use, on the client that
 *   used it, which is exactly the client that should roll.
 *   `dnd5e.restCompleted` (:38317) fires per actor with `config.type` naming the rest.
 *
 * Healing is checked before necromancy, matching the order the triggers were specified. A spell
 * that is both - False Life, say - rolls once, on the healing table. Swapping the two lines in
 * classify() is all it takes to reverse that.
 */

/** Resolved tables, keyed by trigger. Cleared whenever the world's tables change. */
const cache = new Map();

export function isDome() {
  return game.settings.get(MODULE_ID, SETTING.DOME) === true;
}

/**
 * The table for a trigger. A world RollTable carrying the same flag wins over the shipped one,
 * so a GM can customise the results without editing the module or losing them on update.
 */
async function resolveTable(trigger) {
  if (cache.has(trigger)) return cache.get(trigger);

  const world = game.tables?.find((t) => t.getFlag(MODULE_ID, FLAG.DOME_TABLE) === trigger);
  let table = world ?? null;

  if (!table) {
    const pack = game.packs.get(`${MODULE_ID}.${PACK.TABLES}`);
    table = (await pack?.getDocument(DOME_TABLE_ID[trigger])) ?? null;
  }

  cache.set(trigger, table);
  return table;
}

/** A world table being added, renamed or deleted can change which table a trigger resolves to. */
function clearCache() {
  cache.clear();
}

/**
 * Which trigger a spell activity answers to, or "" if the Dome ignores it.
 * @param {Activity} activity
 */
export function classify(activity) {
  const item = activity?.item;
  if (item?.type !== "spell") return "";

  // Cantrips are cast far too often to roll on a d100 each time.
  if ((item.system?.level ?? 0) < 1) return "";

  if (activity.type === "heal") return DOME.HEALING;
  if (item.system?.school === "nec") return DOME.NECROMANCY;
  return DOME.WILD;
}

/**
 * Roll a Dome table and post the result.
 *
 * `RollTable#roll` only reads - it evaluates the formula and matches results - so this works on
 * a compendium document and never tries to write to the pack. `draw()` would, which is why it
 * is not used here; building the message by hand also lets the card say what caused the roll.
 */
async function rollDomeTable(trigger, { actor, cause }) {
  const table = await resolveTable(trigger);
  if (!table) {
    console.error(`${MODULE_ID} | No Dome table found for "${trigger}"`);
    ui.notifications?.error(game.i18n.format("CGM.Dome.MissingTable", { module: MODULE_TITLE, trigger }));
    return null;
  }

  const { roll, results } = await table.roll();
  const text = results.map((r) => r.description || r.name).filter(Boolean).join("<br>");

  debugLog(`dome: ${trigger} table rolled ${roll.total} for ${actor?.name ?? "unknown actor"} (${cause})`);

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    flavor: game.i18n.format("CGM.Dome.Flavor", { table: table.name, cause }),
    content: `<div class="cg-misc-dome"><p>${text || game.i18n.localize("CGM.Dome.NoResult")}</p></div>`,
    rolls: [roll],
    flags: { [MODULE_ID]: { dome: trigger } }
  });

  return results;
}

/* -------------------------------------------- */
/*  Triggers                                    */
/* -------------------------------------------- */

async function onUseActivity(activity) {
  try {
    if (!isDome()) return;

    const trigger = classify(activity);
    if (!trigger) return;

    await rollDomeTable(trigger, { actor: activity.actor, cause: activity.item.name });
  } catch (err) {
    // The spell has already been cast by this point; a failed table roll must not undo it.
    console.error(`${MODULE_ID} | The Dome failed to roll for this spell`, err);
    ui.notifications?.error(game.i18n.format("CGM.Dome.Error", { module: MODULE_TITLE }));
  }
}

async function onRestCompleted(actor, result, config) {
  try {
    if (!isDome()) return;
    if ((config?.type ?? result?.type) !== "short") return;

    await rollDomeTable(DOME.REST, { actor, cause: game.i18n.localize("CGM.Dome.ShortRest") });
  } catch (err) {
    console.error(`${MODULE_ID} | The Dome failed to roll for this rest`, err);
    ui.notifications?.error(game.i18n.format("CGM.Dome.Error", { module: MODULE_TITLE }));
  }
}

export function registerDome() {
  Hooks.on("dnd5e.postUseActivity", (activity) => onUseActivity(activity));
  Hooks.on("dnd5e.restCompleted", (actor, result, config) => onRestCompleted(actor, result, config));

  // A customised world table can appear or vanish at any time, so never trust a stale lookup.
  for (const hook of ["createRollTable", "updateRollTable", "deleteRollTable"]) Hooks.on(hook, clearCache);
}

/**
 * Turn the Dome on or off. GM only - it writes a world setting, whose onChange announces the
 * change and refreshes the scene control on every client.
 * @param {boolean} [force]  Set explicitly instead of flipping.
 * @returns {Promise<boolean|null>}
 */
export async function toggleDome(force) {
  if (!game.user.isGM) {
    ui.notifications?.warn(game.i18n.localize("CGM.Dome.GMOnly"));
    return null;
  }

  const value = typeof force === "boolean" ? force : !isDome();
  await game.settings.set(MODULE_ID, SETTING.DOME, value);
  return value;
}

export const domeApi = { toggle: toggleDome, isActive: isDome, roll: rollDomeTable, classify };
