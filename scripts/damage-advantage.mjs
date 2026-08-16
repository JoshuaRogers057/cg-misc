import { MODULE_ID, MODULE_TITLE, FLAG, SETTING, DAMAGE_ADVANTAGE_KEY, debugLog } from "./constants.mjs";

/**
 * Damage advantage: while an actor carries `flags.cg-misc.damageAdvantage` naming a damage
 * type, every damage roll they make of that type is rolled twice and the higher TOTAL kept.
 * The 2024 Savage Attacker mechanic, keyed to a damage type instead of to weapons, and with
 * no once-per-turn limit.
 *
 * WHY THIS HOOK, AND WHY THE REPLACEMENT LOOKS THE WAY IT DOES
 *
 * `dnd5e.postDamageRollConfiguration` fires for every damage roll in the system, because all
 * of them route through BasicRoll.build -> BasicRoll.buildConfigure (dnd5e 5.3.3,
 * dnd5e.mjs:68379 and :68396). Activity#rollDamage pushes "damage" onto `config.hookNames`
 * (:17516) and sets `config.subject` to the activity (:17517), so weapon attacks, spell
 * attacks and saving-throw spells all arrive here identically.
 *
 * Three seams that look equivalent are not, and each failed in a way worth recording:
 *
 *  1. `midi-qol.DamageRollComplete` fires from one workflow state on the attack path only.
 *     Weapon attacks are caught; saving-throw spell damage is silently skipped. It also
 *     makes the feature depend on midi-qol, which this module deliberately does not.
 *
 *  2. `dnd5e.preRollDamageV2` is too early. dnd5e applies criticals in
 *     DamageRoll#configureDamage (:68948) by walking `this.terms` and doubling only terms
 *     that are `instanceof DiceTerm`. Wrapping the formula in a pool makes the top-level term
 *     a PoolTerm, the dice inside become invisible to that walk, and criticals SILENTLY STOP
 *     DOUBLING - the roll still looks perfectly fine on the card. Running after configuration
 *     is what makes the pool safe: the critical dice are already baked into `roll.formula`.
 *
 *  3. `flags.midi-qol.advantage.damage.*` is a dead end. In this midi-qol build that flag
 *     appears only in the setup code that populates DAE's field browser; nothing reads it, so
 *     an Active Effect targeting it is a no-op.
 *
 * `options.configured = true` on the replacement is load-bearing. The DamageRoll constructor
 * runs `if (!this.options.configured) this.configureDamage()` (:68812). Without the flag the
 * replacement gets reconfigured, and because the `critical.bonusDamage` terms from the
 * original are now buried inside the pool - out of reach of the filter at the top of
 * configureDamage that strips previously-added ones - they get appended a second time,
 * inflating every crit.
 */

/** Damage types are matched case-insensitively; effects get typed by hand. */
function normalizeType(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

/**
 * Read a flag value into damage type strings. The value can arrive as an array (set via
 * `setFlag`), or as a delimited string, because an Active Effect change value is always
 * stored as a string.
 */
function collectTypes(value, into = new Set()) {
  if (value === null || value === undefined) return into;

  if (value instanceof Set || Array.isArray(value)) {
    for (const entry of value) collectTypes(entry, into);
    return into;
  }

  if (typeof value === "string") {
    for (const part of value.split(/[,;|]/)) {
      const type = normalizeType(part);
      if (type) into.add(type);
    }
  }

  return into;
}

/** The types the world-wide switch is granting, or nothing when it is off. */
export function getGlobalTypes() {
  if (!game.settings.get(MODULE_ID, SETTING.DAMAGE_ADVANTAGE_GLOBAL)) return new Set();
  return collectTypes(game.settings.get(MODULE_ID, SETTING.DAMAGE_ADVANTAGE_TYPES));
}

/**
 * Every damage type this actor currently has advantage on, from all three sources.
 *
 * The world switch applies to every actor and needs no actor at all, so it is collected
 * first and an unresolvable actor still gets it. On top of that, `actor.flags` is where
 * Foundry lands an applied Active Effect change and where a direct `setFlag` writes, and
 * walking `appliedEffects` unions the values from several effects granting different types,
 * which a single OVERRIDE change cannot express on its own.
 */
export function getDamageAdvantageTypes(actor) {
  const types = getGlobalTypes();
  if (!actor) return types;

  collectTypes(foundry.utils.getProperty(actor, DAMAGE_ADVANTAGE_KEY), types);

  for (const effect of actor.appliedEffects ?? []) {
    for (const change of effect.changes ?? []) {
      if (change?.key === DAMAGE_ADVANTAGE_KEY) collectTypes(change.value, types);
    }
  }

  return types;
}

/**
 * The actor making this damage roll. `config.subject` is the activity (Activity#rollDamage
 * sets it), and Activity#actor resolves through its item. The speaker is the last resort for
 * damage rolled outside an activity, e.g. from a chat card button.
 */
function resolveActor(config, message) {
  const subject = config?.subject;
  if (subject?.actor) return subject.actor;
  if (subject?.item?.actor) return subject.item.actor;

  const speaker = message?.data?.speaker;
  return speaker ? ChatMessage.getSpeakerActor(speaker) : null;
}

/**
 * Which of `types` this roll deals, or "" for none.
 *
 * `options.type` is the single type the roll resolved to and is authoritative when set - it
 * is what dnd5e itself uses to apply the damage. `options.types` is the set the roll could
 * still become when the player was never asked to choose. Term flavor is the last resort, for
 * a hand-written formula like `2d6[necrotic] + 1d4[fire]` that carries no typed options at
 * all; that case wraps as a unit, since it is a single roll.
 */
function matchType(roll, types) {
  const chosen = normalizeType(roll?.options?.type);
  if (chosen) return types.has(chosen) ? chosen : "";

  for (const available of roll?.options?.types ?? []) {
    const type = normalizeType(available);
    if (types.has(type)) return type;
  }

  for (const term of roll?.terms ?? []) {
    const flavor = normalizeType(term?.options?.flavor);
    if (flavor && types.has(flavor)) return flavor;
  }

  return "";
}

/**
 * A roll of the same class and data whose formula is the original rolled twice, keeping the
 * higher total. See the file header for why `configured` has to be set.
 */
function buildAdvantageRoll(roll) {
  const formula = roll?.formula;
  if (!formula) return null;

  const options = foundry.utils.deepClone(roll.options ?? {});

  // Skip configureDamage on the replacement - it has already run on the formula we are
  // wrapping, and re-running it would append critical bonus damage a second time.
  options.configured = true;
  // preprocessFormula is a no-op on a pool, but the inner formula is already preprocessed and
  // skipping it keeps the replacement byte-identical to what we asked for.
  options.preprocessed = true;
  options[MODULE_ID] = { ...(options[MODULE_ID] ?? {}), [FLAG.WRAPPED]: true };

  return new roll.constructor(`{${formula}, ${formula}}kh`, roll.data, options);
}

/**
 * Swap in the doubled rolls. Mutating `rolls` in place is the supported route: buildConfigure
 * hands this exact array to the hook and then returns it (dnd5e.mjs:68449-68453).
 */
function onPostDamageRollConfiguration(rolls, config, dialog, message) {
  try {
    if (!game.settings.get(MODULE_ID, SETTING.DAMAGE_ADVANTAGE_ENABLED)) return;
    if (!Array.isArray(rolls) || !rolls.length) return;

    // Not bailing on an unresolvable actor: the world switch applies to everyone, so it must
    // still fire for damage rolled outside an activity, where there is nobody to resolve.
    const actor = resolveActor(config, message);

    const types = getDamageAdvantageTypes(actor);
    if (!types.size) return;

    for (const [index, roll] of rolls.entries()) {
      if (roll?.options?.[MODULE_ID]?.[FLAG.WRAPPED]) continue;

      const type = matchType(roll, types);
      if (!type) continue;

      const advantageRoll = buildAdvantageRoll(roll);
      if (!advantageRoll) continue;

      rolls[index] = advantageRoll;
      debugLog(`damage advantage: ${actor?.name ?? "unknown actor"} rolling ${type} twice -`, advantageRoll.formula);
    }
  } catch (err) {
    // A damage roll that fails to gain advantage is a far better outcome than one that never
    // reaches the table, so never let this escape into buildConfigure.
    console.error(`${MODULE_ID} | Failed to apply damage advantage`, err);
    ui.notifications?.error(
      game.i18n.format("CGM.DamageAdvantage.Error", { module: MODULE_TITLE })
    );
  }
}

/* -------------------------------------------- */
/*  Public API                                  */
/* -------------------------------------------- */

/** The configured damage types, as written in settings. */
function configuredTypes() {
  return game.settings.get(MODULE_ID, SETTING.DAMAGE_ADVANTAGE_TYPES);
}

/** Whether the world-wide switch is currently on. */
export function isGlobal() {
  return game.settings.get(MODULE_ID, SETTING.DAMAGE_ADVANTAGE_GLOBAL) === true;
}

/**
 * Turn the world-wide switch on or off. While on, every actor - PCs, NPCs and monsters alike
 * - has advantage on the configured damage types, with no effect to add or remove.
 *
 * Writing a world setting is GM-only, and the setting's own onChange handles announcing the
 * change and refreshing the scene control on every client.
 * @param {boolean} [force]  Set explicitly instead of flipping.
 * @returns {Promise<boolean|null>}  The new state, or null if it did nothing.
 */
export async function toggleGlobal(force) {
  if (!game.user.isGM) {
    ui.notifications?.warn(game.i18n.localize("CGM.DamageAdvantage.GMOnly"));
    return null;
  }

  const value = typeof force === "boolean" ? force : !isGlobal();
  await game.settings.set(MODULE_ID, SETTING.DAMAGE_ADVANTAGE_GLOBAL, value);

  // The master switch silently outranks this one, so flag the contradiction to whoever flipped
  // it rather than leaving them to wonder why nothing changed.
  if (value && !game.settings.get(MODULE_ID, SETTING.DAMAGE_ADVANTAGE_ENABLED)) {
    ui.notifications?.warn(game.i18n.localize("CGM.DamageAdvantage.AnnounceMasterOff"));
  }

  return value;
}

function resolveActorArg(actor) {
  if (actor instanceof Actor) return actor;
  if (actor?.actor instanceof Actor) return actor.actor; // Token or TokenDocument
  return null;
}

/** The ActiveEffect this module owns on an actor, if it has one. */
function getMarkerEffect(actor) {
  return actor.effects.find((e) => e.getFlag(MODULE_ID, FLAG.DAMAGE_ADVANTAGE_MARKER) === true) ?? null;
}

/**
 * Turn a damage type on or off for an actor, via an Active Effect this module owns. Being a
 * document, the effect replicates to every client on its own and survives a refresh.
 * @param {Actor|Token|TokenDocument} actor  Who to toggle it for.
 * @param {string} [type]                    Damage type; defaults to the configured type.
 * @returns {Promise<string[]|null>}         The types now active, or null if nothing was done.
 */
export async function toggle(actor, type) {
  const target = resolveActorArg(actor);
  if (!target) {
    ui.notifications?.warn(game.i18n.localize("CGM.DamageAdvantage.NoActor"));
    return null;
  }

  if (!target.isOwner) {
    ui.notifications?.warn(game.i18n.format("CGM.DamageAdvantage.NotOwner", { name: target.name }));
    return null;
  }

  const damageType = normalizeType(type) || [...collectTypes(configuredTypes())][0];
  if (!damageType) {
    ui.notifications?.warn(game.i18n.localize("CGM.DamageAdvantage.NoType"));
    return null;
  }

  const effect = getMarkerEffect(target);
  const current = collectTypes(effect?.changes?.find((c) => c.key === DAMAGE_ADVANTAGE_KEY)?.value);

  if (current.has(damageType)) current.delete(damageType);
  else current.add(damageType);

  const types = [...current];

  if (!types.length) {
    if (effect) await effect.delete();
    return types;
  }

  const changes = [
    {
      key: DAMAGE_ADVANTAGE_KEY,
      mode: CONST.ACTIVE_EFFECT_MODES.OVERRIDE,
      value: types.join(","),
      priority: 20
    }
  ];

  if (effect) await effect.update({ changes, disabled: false });
  else {
    await ActiveEffect.implementation.create(
      {
        name: game.i18n.localize("CGM.DamageAdvantage.EffectName"),
        img: "icons/magic/death/skull-energy-light-purple.webp",
        origin: target.uuid,
        changes,
        flags: { [MODULE_ID]: { [FLAG.DAMAGE_ADVANTAGE_MARKER]: true } }
      },
      { parent: target }
    );
  }

  return types;
}

/**
 * The damage types an actor currently has advantage on, from every source.
 * @param {Actor|Token|TokenDocument} actor
 * @returns {string[]}
 */
export function get(actor) {
  return [...getDamageAdvantageTypes(resolveActorArg(actor))];
}

/**
 * Drop the effect this module owns. Types granted by someone else's effect are untouched.
 * @param {Actor|Token|TokenDocument} actor
 * @returns {Promise<boolean>}  Whether an effect was removed.
 */
export async function clear(actor) {
  const target = resolveActorArg(actor);
  if (!target?.isOwner) return false;

  const effect = getMarkerEffect(target);
  if (!effect) return false;

  await effect.delete();
  return true;
}

/* -------------------------------------------- */

export function registerDamageAdvantage() {
  Hooks.on("dnd5e.postDamageRollConfiguration", onPostDamageRollConfiguration);
}

export const damageAdvantageApi = {
  toggleGlobal,
  isGlobal,
  get,
  toggle,
  clear,
  key: DAMAGE_ADVANTAGE_KEY
};
