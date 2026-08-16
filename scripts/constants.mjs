export const MODULE_ID = "cg-misc";
export const MODULE_TITLE = "Champions Guild Misc";

/** Keys stored under `flags.<MODULE_ID>` on various documents. */
export const FLAG = {
  /** On an Actor: the damage types that roll twice and keep the higher total. */
  DAMAGE_ADVANTAGE: "damageAdvantage",
  /** On an ActiveEffect: marks the effect the API owns, so toggle() can find it again. */
  DAMAGE_ADVANTAGE_MARKER: "damageAdvantageMarker",
  /** On a Roll's options: marks a roll this module already wrapped, so it never wraps twice. */
  WRAPPED: "wrapped"
};

export const SETTING = {
  /** Master switch. Off means this module touches no roll at all. */
  DAMAGE_ADVANTAGE_ENABLED: "damageAdvantageEnabled",
  /** The world-wide switch: while on, every actor has advantage on TYPES. */
  DAMAGE_ADVANTAGE_GLOBAL: "damageAdvantageGlobal",
  /** Damage types the global switch grants, and the default for the per-actor toggle. */
  DAMAGE_ADVANTAGE_TYPES: "damageAdvantageTypes",
  DEBUG: "debug"
};

/** Name of the scene-control toggle, also the key used to refresh its state. */
export const TOOL_NAME = "cgMiscDamageAdvantage";

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
