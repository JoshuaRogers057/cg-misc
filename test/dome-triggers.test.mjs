import test from "node:test";
import assert from "node:assert/strict";

import { state, hooks, applied, resetApplied } from "./foundry-stubs.mjs";
import { registerDomeTriggers } from "../scripts/dome-triggers.mjs";
import { NECROMANCY_EFFECTS } from "../scripts/dome-effects.mjs";

registerDomeTriggers();
const onAttackComplete = hooks.get("midi-qol.AttackRollComplete");
const onRollComplete = hooks.get("midi-qol.RollComplete");

/** Track deletions so a test can prove an effect actually went away. */
const deleted = [];

function makeActor({ name = "Subject", uuid = "Actor.subject", effects = [] } = {}) {
  const actor = {
    name,
    uuid,
    isOwner: true,
    effects: effects.map((flags, i) => ({
      id: `eff${i}`,
      getFlag: (scope, key) => (scope === "cg-misc" ? flags[key] : undefined)
    })),
    deleteEmbeddedDocuments: async (_type, ids) => {
      deleted.push({ uuid, ids });
      actor.effects = actor.effects.filter((e) => !ids.includes(e.id));
      return ids;
    },
    applyDamage: async (parts) => applied.healing.push({ uuid, value: parts[0].value })
  };
  return actor;
}

test.beforeEach(() => {
  resetApplied();
  deleted.length = 0;
  state.messages.length = 0;
});

/* -------------------------------------------- */
/*  Expire after the first attack against you   */
/* -------------------------------------------- */

test("Shadow Armor ends once an attack is made against the wearer", async () => {
  const wearer = makeActor({ effects: [{ dome: true, expireOnAttacked: true }] });

  await onAttackComplete({ targets: [{ actor: wearer }] });

  assert.deepEqual(deleted, [{ uuid: "Actor.subject", ids: ["eff0"] }]);
});

test("an unrelated effect is left alone when its wearer is attacked", async () => {
  const wearer = makeActor({ effects: [{ dome: true }] });

  await onAttackComplete({ targets: [{ actor: wearer }] });

  assert.equal(deleted.length, 0);
});

test("both expire-on-attacked results carry the flag", () => {
  // Shadow Armor and Spectral Guardian are the same rule with different flavour.
  for (const id of ["qPcCwml9OrLanALX", "rJaQ1BJuWuM6W2ez"]) {
    assert.equal(NECROMANCY_EFFECTS[id].effect.flags["cg-misc"].expireOnAttacked, true, id);
  }
});

/* -------------------------------------------- */
/*  Expire after your own attack hits           */
/* -------------------------------------------- */

test("the Necrotic Wreath bonus survives until the attack actually hits", async () => {
  const attacker = makeActor({ effects: [{ dome: true, expireOnHit: true }] });

  // A miss must not consume it.
  await onRollComplete({ actor: attacker, hitTargets: new Set(), item: { type: "weapon" } });
  assert.equal(deleted.length, 0, "a miss leaves the bonus in place");

  await onRollComplete({ actor: attacker, hitTargets: new Set(["t1"]), item: { type: "weapon" } });
  assert.deepEqual(deleted, [{ uuid: "Actor.subject", ids: ["eff0"] }]);
});

test("the wreath adds necrotic damage to every kind of attack", () => {
  const changes = NECROMANCY_EFFECTS.dVybL2CBBpUYUUv0.effect.changes;
  const keys = changes.map((c) => c.key);

  for (const kind of ["mwak", "rwak", "msak", "rsak"]) {
    assert.ok(keys.includes(`system.bonuses.${kind}.damage`), `missing ${kind}`);
  }
  assert.ok(changes.every((c) => c.value === "1d4[necrotic]"));
});

/* -------------------------------------------- */
/*  Necromantic Hunger                          */
/* -------------------------------------------- */

test("Necromantic Hunger heals half the damage dealt to one creature", async () => {
  const caster = makeActor({ effects: [{ dome: true, necroticHunger: true }] });

  await onRollComplete({
    actor: caster,
    item: { type: "spell" },
    hitTargets: new Set(),
    // Two targets; the rule is half the damage to one creature, so the worst-hit one counts.
    damageList: [{ hpDamage: 9 }, { hpDamage: 4 }]
  });

  assert.deepEqual(applied.healing, [{ uuid: "Actor.subject", value: 4 }], "half of 9, rounded down");
  assert.deepEqual(deleted, [{ uuid: "Actor.subject", ids: ["eff0"] }], "it is a one-shot");
});

test("Hunger ignores a non-spell and stays available", async () => {
  const caster = makeActor({ effects: [{ dome: true, necroticHunger: true }] });

  await onRollComplete({ actor: caster, item: { type: "weapon" }, hitTargets: new Set(), damageList: [{ hpDamage: 9 }] });

  assert.equal(applied.healing.length, 0);
  assert.equal(deleted.length, 0, "a weapon swing must not consume the next damaging spell");
});

test("Hunger ignores a spell that dealt no damage", async () => {
  const caster = makeActor({ effects: [{ dome: true, necroticHunger: true }] });

  await onRollComplete({ actor: caster, item: { type: "spell" }, hitTargets: new Set(), damageList: [] });

  assert.equal(applied.healing.length, 0);
  assert.equal(deleted.length, 0);
});

test("Hunger announces what it fed on", async () => {
  const caster = makeActor({ effects: [{ dome: true, necroticHunger: true }] });

  await onRollComplete({
    actor: caster,
    item: { type: "spell" },
    hitTargets: new Set(),
    damageList: [{ hpDamage: 7 }]
  });

  assert.match(state.messages.at(-1).content, /HungerFed/);
});

test("a workflow with no actor is ignored rather than throwing", async () => {
  await assert.doesNotReject(() => onRollComplete({}));
  await assert.doesNotReject(() => onAttackComplete({}));
});
