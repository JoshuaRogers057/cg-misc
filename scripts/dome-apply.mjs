import { MODULE_ID, debugLog } from "./constants.mjs";
import { DOME_EFFECTS } from "./dome-effects.mjs";

/**
 * Executes the specs in dome-effects.mjs.
 *
 * Effects are created directly when this client owns the actor, and handed to midi-qol's
 * GM-side relay only when it does not. Going direct where possible keeps the common case (a GM
 * testing, or a player affecting their own character) on a path whose failures actually surface,
 * rather than disappearing into a socket call that returns a bare boolean.
 *
 * Damage still goes through midi's applyTokenDamage, which puts it through resistances and
 * immunities instead of subtracting raw hit points.
 */

const midi = () => globalThis.MidiQOL;

/** The token for an actor on the current scene, if there is one. */
function tokenFor(actor) {
  return actor?.getActiveTokens?.(true)?.[0] ?? null;
}

/**
 * Who a healing result lands on: whoever was targeted when the spell was cast, falling back to
 * the caster so that self-heals and untargeted casts still resolve.
 */
export function healingSubjects(caster) {
  const targeted = [...(game.user?.targets ?? [])].map((t) => t.actor).filter(Boolean);
  return targeted.length ? targeted : [caster].filter(Boolean);
}

/** Creatures around a subject, per an area spec. Incapacitated ones still take the hit. */
function nearbyActors(origin, { range, disposition }) {
  const token = tokenFor(origin);
  if (!token) {
    debugLog("dome: no token on scene for", origin?.name, "- area effect skipped");
    return [];
  }

  const tokens = midi()?.findNearby(disposition, token, range, {
    includeIncapacitated: true,
    includeToken: false
  });

  return (tokens ?? []).map((t) => t.actor).filter(Boolean);
}

/* -------------------------------------------- */
/*  Primitives                                  */
/* -------------------------------------------- */

/** A duration the table states as a roll ("for 1d4 rounds") is rolled at apply time. */
async function resolveDuration(duration = {}) {
  if (!duration.roundsFormula) return duration;

  const { roundsFormula, ...rest } = duration;
  const roll = await new Roll(roundsFormula).evaluate();
  return { ...rest, rounds: Math.max(1, roll.total) };
}

async function applyEffect(actor, data) {
  const effect = foundry.utils.deepClone(data);
  effect.origin ??= actor.uuid;
  effect.duration = await resolveDuration(effect.duration);

  if (actor.isOwner) {
    const created = await actor.createEmbeddedDocuments("ActiveEffect", [effect]);
    debugLog("dome: created", effect.name, "on", actor.name, "->", created?.[0]?.id ?? "nothing");
    return Boolean(created?.length);
  }

  const ok = await midi()?.createEffects({ actorUuid: actor.uuid, effects: [effect] });
  debugLog("dome: relayed", effect.name, "to GM for", actor.name, "->", ok);
  return ok !== false;
}

async function applyStatus(actor, status, duration = {}, dae = {}) {
  // dnd5e's condition ids are the long forms - "blinded", not "blind".
  const preset = CONFIG.statusEffects?.find((s) => s.id === status);
  if (!preset) {
    console.warn(`${MODULE_ID} | Unknown status "${status}" - not applied`);
    return false;
  }

  return applyEffect(actor, {
    name: game.i18n.localize(preset.name ?? preset.label ?? status),
    img: preset.img ?? preset.icon,
    statuses: [status],
    duration,
    flags: { [MODULE_ID]: { dome: true }, dae: { ...dae } }
  });
}

/** Halving healing is not expressible as an effect change, so it rides on our own flag. */
async function applyHalveHealing(actor, { duration = {} } = {}) {
  return applyEffect(actor, {
    name: game.i18n.localize("CGM.Dome.HalvedHealing"),
    img: "icons/svg/daze.svg",
    duration,
    changes: [{ key: `flags.${MODULE_ID}.halveHealing`, mode: 5, value: "1", priority: 20 }],
    flags: { [MODULE_ID]: { dome: true }, dae: {} }
  });
}

async function applyDamage(actors, { formula, type }) {
  const roll = await new Roll(formula).evaluate();
  const tokens = actors.map(tokenFor).filter(Boolean);
  if (!tokens.length) return roll;

  await midi().applyTokenDamage(
    [{ value: roll.total, type, properties: new Set() }],
    roll.total,
    new Set(tokens),
    null,
    new Set(),
    { forceApply: false }
  );

  return roll;
}

async function applyHealing(actors, { formula }) {
  const roll = await new Roll(formula).evaluate();
  for (const actor of actors) await actor.applyDamage([{ value: roll.total, type: "healing" }]);
  return roll;
}

async function addExhaustion(actor, levels) {
  const current = actor.system?.attributes?.exhaustion ?? 0;
  await actor.update({ "system.attributes.exhaustion": current + levels });
}

/**
 * Roll a saving throw for each actor and return those that failed. Rolled here rather than
 * prompted: the Dome fires often enough that a prompt per creature per cast would stall play.
 */
async function rollSaves(actors, { ability, dc }) {
  const failed = [];
  for (const actor of actors) {
    const rolls = await actor.rollSavingThrow({ ability, target: dc }, { configure: false }, {});
    const total = Array.isArray(rolls) ? rolls[0]?.total : rolls?.total;
    // A save that could not be rolled counts as failed rather than silently sparing the target.
    if (!Number.isFinite(total) || total < dc) failed.push(actor);
  }
  return failed;
}

/* -------------------------------------------- */
/*  Dispatch                                    */
/* -------------------------------------------- */

/** Run one spec against a set of subjects. Returns a short description of what happened. */
async function runSpec(spec, subjects, caster) {
  if (!spec || !subjects.length) return "";

  const notes = [];

  if (spec.woundedOnly) {
    subjects = subjects.filter((a) => (a.system?.attributes?.hp?.value ?? 0) < (a.system?.attributes?.hp?.max ?? 0));
    if (!subjects.length) return "";
  }

  if (spec.save) {
    const failed = await rollSaves(subjects, spec.save);
    notes.push(`${failed.length}/${subjects.length} failed DC ${spec.save.dc} ${spec.save.ability.toUpperCase()}`);
    if (spec.save.onFail && failed.length) notes.push(await runSpec(spec.save.onFail, failed, caster));
  }

  if (spec.damage) {
    const roll = await applyDamage(subjects, spec.damage);
    notes.push(`${roll.total} ${spec.damage.type} to ${subjects.length}`);
  }

  if (spec.healing) {
    const roll = await applyHealing(subjects, spec.healing);
    notes.push(`${roll.total} healing to ${subjects.length}`);
  }

  if (spec.effect) {
    for (const actor of subjects) await applyEffect(actor, spec.effect);
    notes.push(`${spec.effect.name} on ${subjects.length}`);
  }

  if (spec.status) {
    for (const actor of subjects) await applyStatus(actor, spec.status, spec.duration, spec.dae);
    notes.push(`${spec.status} on ${subjects.length}`);
  }

  if (spec.halveHealing) {
    for (const actor of subjects) await applyHalveHealing(actor, spec.halveHealing);
    notes.push(`healing halved on ${subjects.length}`);
  }

  if (spec.exhaust) {
    for (const actor of subjects) await addExhaustion(actor, spec.exhaust);
    notes.push(`+${spec.exhaust} exhaustion`);
  }

  return notes.filter(Boolean).join("; ");
}

/**
 * Apply whatever the drawn results call for.
 * @param {string} trigger  Which Dome table was rolled.
 * @param {object[]} results  The drawn TableResult documents.
 * @param {Actor} caster
 * @returns {Promise<string>}  A summary, or "" when the result is text-only.
 */
export async function applyDomeResults(trigger, results, caster) {
  const registry = DOME_EFFECTS[trigger];
  if (!registry || !caster) return "";

  const notes = [];

  for (const result of results) {
    const spec = registry[result.id ?? result._id];
    if (!spec) continue; // cosmetic, or a rule Foundry cannot enforce - the card says it instead

    // A healing result is centred on the creature that was healed, not on the caster: "every
    // creature within 10 feet" means within 10 feet of the patient.
    const primary = trigger === "healing" ? healingSubjects(caster) : [caster];
    const origin = primary[0] ?? caster;

    let subjects = primary;
    if (spec.area) {
      subjects = nearbyActors(origin, spec.area);
      if (spec.area.includeSelf && origin && !subjects.includes(origin)) subjects = [origin, ...subjects];
    }

    const chosen = spec.random && subjects.length ? [subjects[Math.floor(Math.random() * subjects.length)]] : subjects;

    const note = await runSpec(spec, chosen, caster);
    if (note) notes.push(note);
  }

  return notes.join(" | ");
}

/**
 * Halved healing has no Active Effect representation, so it is enforced here: any actor carrying
 * the flag has incoming healing halved before dnd5e applies it.
 */
export function registerDomeHealingModifier() {
  Hooks.on("dnd5e.preCalculateDamage", (actor, damages) => {
    try {
      if (!foundry.utils.getProperty(actor, `flags.${MODULE_ID}.halveHealing`)) return;

      const healingTypes = CONFIG.DND5E?.healingTypes ?? {};
      for (const entry of damages ?? []) {
        if (entry.type in healingTypes) entry.value = Math.floor(entry.value / 2);
      }
    } catch (err) {
      console.error(`${MODULE_ID} | Failed to halve healing`, err);
    }
  });
}
