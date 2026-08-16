import { MODULE_ID, debugLog } from "./constants.mjs";
import { DOME_EFFECTS } from "./dome-effects.mjs";

/**
 * Executes the specs in dome-effects.mjs.
 *
 * Everything that touches an actor the acting player may not own goes through midi-qol, whose
 * `createEffects` and `applyTokenDamage` both run GM-side through midi's own relay. That is why
 * this module requires midi rather than carrying its own socket: the relay already exists, and
 * applyTokenDamage puts damage through resistances and immunities instead of subtracting raw
 * hit points.
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

/** Creatures around the caster, per an area spec. Incapacitated ones still take the hit. */
function nearbyActors(caster, { range, disposition }) {
  const token = tokenFor(caster);
  if (!token) {
    debugLog("dome: no token on scene for", caster?.name, "- area effect skipped");
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

async function applyEffect(actor, data) {
  const effect = foundry.utils.deepClone(data);
  effect.origin ??= actor.uuid;
  // DAE reads its duration flags off the effect, and duration:{} would otherwise mean "forever".
  await midi().createEffects({ actorUuid: actor.uuid, effects: [effect] });
}

async function applyStatus(actor, status, duration = {}, dae = {}) {
  const condition = CONFIG.statusEffects.find((s) => s.id === status);
  if (!condition) {
    console.warn(`${MODULE_ID} | Unknown status "${status}"`);
    return;
  }

  await midi().createEffects({
    actorUuid: actor.uuid,
    effects: [
      {
        name: game.i18n.localize(condition.name ?? condition.label),
        img: condition.img ?? condition.icon,
        statuses: [status],
        origin: actor.uuid,
        duration,
        flags: { [MODULE_ID]: { dome: true }, dae: { ...dae } }
      }
    ]
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
 * prompted: the Dome fires often enough that a prompt per creature per cast would stall play,
 * and the roll is public either way.
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

    const subjects = spec.area
      ? nearbyActors(caster, spec.area)
      : trigger === "healing"
        ? healingSubjects(caster)
        : [caster];

    const chosen = spec.random && subjects.length ? [subjects[Math.floor(Math.random() * subjects.length)]] : subjects;

    const note = await runSpec(spec, chosen, caster);
    if (note) notes.push(note);
  }

  return notes.join(" | ");
}
