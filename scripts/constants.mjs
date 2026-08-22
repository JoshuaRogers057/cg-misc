export const MODULE_ID = "cg-misc";
export const MODULE_TITLE = "Champions Guild Misc";

/** Keys stored under `flags.<MODULE_ID>` on various documents. */
export const FLAG = {
  /** On an Actor: the damage types that roll twice and keep the higher total. */
  DAMAGE_ADVANTAGE: "damageAdvantage",
  /** On an ActiveEffect: marks the effect the API owns, so toggle() can find it again. */
  DAMAGE_ADVANTAGE_MARKER: "damageAdvantageMarker",
  /** On a Roll's options: marks a roll this module already wrapped, so it never wraps twice. */
  WRAPPED: "wrapped",
  /** On a RollTable: which Dome trigger it answers to. Lets a world table override the module's. */
  DOME_TABLE: "domeTable"
};

/** Compendium packs this module ships, without the module id prefix. */
export const PACK = {
  EFFECTS: "cg-misc-effects",
  TABLES: "cg-misc-tables"
};

/** The Dome's four triggers. These strings are the flag values, so they are public surface. */
export const DOME = {
  HEALING: "healing",
  NECROMANCY: "necromancy",
  WILD: "wild",
  REST: "rest"
};

/** Ids of the shipped tables, so they can be fetched without indexing the whole pack. */
export const DOME_TABLE_ID = {
  [DOME.WILD]: "cgmiscdometbl001",
  [DOME.NECROMANCY]: "cgmiscdometbl002",
  [DOME.HEALING]: "cgmiscdometbl003",
  [DOME.REST]: "cgmiscdometbl004"
};

export const SETTING = {
  /** Master switch. Off means this module touches no roll at all. */
  DAMAGE_ADVANTAGE_ENABLED: "damageAdvantageEnabled",
  /** The world-wide switch: while on, every actor has advantage on TYPES. */
  DAMAGE_ADVANTAGE_GLOBAL: "damageAdvantageGlobal",
  /** Damage types every enhancement applies to. Shared by both switches. */
  DAMAGE_ADVANTAGE_TYPES: "damageAdvantageTypes",
  /** The second, independent enhancement: a floor under each damage die. */
  DAMAGE_MINIMUM: "damageMinimum",
  /** The floor itself. 3 means any 1 or 2 counts as a 3. */
  DAMAGE_MINIMUM_VALUE: "damageMinimumValue",
  /** The Dome: spells and short rests roll on its tables. */
  DOME: "dome",
  DEBUG: "debug"
};

/** Scene-control toggle names, also the keys used to refresh their state. */
export const TOOL = {
  ADVANTAGE: "cgMiscDamageAdvantage",
  MINIMUM: "cgMiscDamageMinimum",
  DOME: "cgMiscDome",
  DOME_TEST: "cgMiscDomeTest"
};

/**
 * `flags.cg-misc.damageAdvantage` - the Active Effect change key. This is the string a GM
 * types into an effect, so it is part of the module's public surface: renaming it breaks
 * every effect already built in a world.
 */
export const DAMAGE_ADVANTAGE_KEY = `flags.${MODULE_ID}.${FLAG.DAMAGE_ADVANTAGE}`;

export function debugLog(...args) {
  try {
    if (game.settings.get(MODULE_ID, SETTING.DEBUG)) console.log(`${MODULE_ID} |`, ...args);
  } catch {
    // Settings aren't registered until init; anything logging before then isn't worth a throw.
  }
}
