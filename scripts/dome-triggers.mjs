import { MODULE_ID, debugLog } from "./constants.mjs";

/**
 * Dome effects that end on an event rather than on the clock, and the one that pays out on a
 * later roll.
 *
 * DAE and times-up between them only implement turn-based special durations - turnStart,
 * turnEnd, their source variants, combatEnd and joinCombat. There is no "until you are attacked"
 * or "until your next hit" in this installation, so those are enforced here instead, off midi's
 * workflow hooks.
 *
 * Effects opt in through their own flags:
 *   flags.cg-misc.expireOnAttacked  ends once an attack is made against the wearer
 *   flags.cg-misc.expireOnHit       ends once the wearer's own attack hits
 *   flags.cg-misc.necroticHunger    heals the wearer for half the damage of their next spell
 */

const midi = () => globalThis.MidiQOL;

/** Remove every effect on an actor carrying `flagKey`. Returns how many went. */
async function expire(actor, flagKey) {
  const doomed = actor?.effects?.filter((e) => e.getFlag(MODULE_ID, flagKey) === true) ?? [];
  const ids = [...doomed].map((e) => e.id).filter(Boolean);
  if (!ids.length) return 0;

  if (actor.isOwner) await actor.deleteEmbeddedDocuments("ActiveEffect", ids);
  else await midi()?.removeEffects({ actorUuid: actor.uuid, effects: ids });

  debugLog(`dome: expired ${ids.length} ${flagKey} effect(s) on ${actor.name}`);
  return ids.length;
}

/**
 * "The first attack made against them has Disadvantage" - the effect has already applied to this
 * roll by the time the attack completes, so removing it here leaves exactly one attack affected.
 */
async function onAttackRollComplete(workflow) {
  try {
    for (const token of workflow?.targets ?? []) {
      if (token?.actor) await expire(token.actor, "expireOnAttacked");
    }
  } catch (err) {
    console.error(`${MODULE_ID} | Failed to expire an attacked-triggered Dome effect`, err);
  }
}

/** Half the damage this workflow actually did to its worst-hit single creature. */
function bestSingleTargetDamage(workflow) {
  const applied = (workflow?.damageList ?? []).map((d) => d?.hpDamage ?? 0).filter((n) => n > 0);
  return applied.length ? Math.max(...applied) : 0;
}

async function onRollComplete(workflow) {
  try {
    const actor = workflow?.actor;
    if (!actor) return;

    // The bonus damage had to survive until the damage roll, so this waits for the whole
    // workflow rather than expiring at AttackRollComplete.
    if (workflow.hitTargets?.size || workflow.hitTargetsEC?.size) await expire(actor, "expireOnHit");

    const hungry = [...(actor.effects ?? [])].filter((e) => e.getFlag(MODULE_ID, "necroticHunger") === true);
    if (!hungry.length) return;
    if (workflow.item?.type !== "spell") return;

    const dealt = bestSingleTargetDamage(workflow);
    if (!dealt) return;

    const healed = Math.floor(dealt / 2);
    if (healed > 0) await actor.applyDamage([{ value: healed, type: "healing" }]);
    await expire(actor, "necroticHunger");

    debugLog(`dome: necrotic hunger healed ${actor.name} for ${healed} (of ${dealt} dealt)`);

    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content: `<p>${game.i18n.format("CGM.Dome.HungerFed", { name: actor.name, amount: healed })}</p>`,
      flags: { [MODULE_ID]: { dome: "necromancy" } }
    });
  } catch (err) {
    console.error(`${MODULE_ID} | Failed to resolve a roll-triggered Dome effect`, err);
  }
}

export function registerDomeTriggers() {
  Hooks.on("midi-qol.AttackRollComplete", (workflow) => onAttackRollComplete(workflow));
  Hooks.on("midi-qol.RollComplete", (workflow) => onRollComplete(workflow));
}
