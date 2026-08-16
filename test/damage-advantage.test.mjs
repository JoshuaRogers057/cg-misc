import test from "node:test";
import assert from "node:assert/strict";

import { state, hooks, FakeDamageRoll, makeActor } from "./foundry-stubs.mjs";
import { registerDamageAdvantage } from "../scripts/damage-advantage.mjs";

registerDamageAdvantage();
const onDamageRoll = hooks.get("dnd5e.postDamageRollConfiguration");

/** Drive the hook the way BasicRoll.buildConfigure does, and hand back the mutated array. */
function roll(rolls, { actor, speaker = false } = {}) {
  state.notifications.length = 0;
  state.speakerActor = speaker ? actor : null;
  const config = speaker ? {} : { subject: { actor } };
  const message = { data: { speaker: speaker ? { actor: "id" } : undefined } };
  onDamageRoll(rolls, config, {}, message);
  return rolls;
}

const damageRoll = (formula, options = {}) => new FakeDamageRoll(formula, {}, options);

test.beforeEach(() => {
  state.settings["cg-misc.damageAdvantageEnabled"] = true;
});

test("necrotic weapon attack is rolled twice, keeping the higher total", () => {
  const actor = makeActor({ effectTypes: ["necrotic"] });
  const [result] = roll([damageRoll("2d6 + 3", { type: "necrotic" })], { actor });

  assert.equal(result.formula, "{2d6 + 3, 2d6 + 3}kh");
  assert.equal(result.options.type, "necrotic", "damage type must survive, dnd5e applies damage by it");
});

test("necrotic saving-throw spell is caught too, via the speaker fallback", () => {
  // The case the midi-qol hook silently skipped: no attack workflow, actor only on the speaker.
  const actor = makeActor({ effectTypes: ["necrotic"] });
  const [result] = roll([damageRoll("8d6", { type: "necrotic" })], { actor, speaker: true });

  assert.equal(result.formula, "{8d6, 8d6}kh");
});

test("a critical wraps the already-doubled dice and will not re-append bonus damage", () => {
  // By this hook the formula is post-configureDamage: dice doubled, crit bonus already in.
  const actor = makeActor({ effectTypes: ["necrotic"] });
  const original = damageRoll("4d6 + 3 + 1d8", {
    type: "necrotic",
    isCritical: true,
    critical: { bonusDamage: "1d8" }
  });
  const [result] = roll([original], { actor });

  assert.equal(result.formula, "{4d6 + 3 + 1d8, 4d6 + 3 + 1d8}kh");
  assert.equal(result.options.configured, true, "without this the crit bonus is appended a second time");
  assert.equal(result.options.isCritical, true, "the chat card styles the roll off this");
  assert.deepEqual(result.options.critical, { bonusDamage: "1d8" });
});

test("only the matching part of a multi-type spell is wrapped", () => {
  const actor = makeActor({ effectTypes: ["necrotic"] });
  const necrotic = damageRoll("3d6", { type: "necrotic" });
  const fire = damageRoll("3d6", { type: "fire" });
  const result = roll([necrotic, fire], { actor });

  assert.equal(result[0].formula, "{3d6, 3d6}kh");
  assert.equal(result[1], fire, "the non-matching roll must be the very same object");
});

test("a non-matching damage type is left alone", () => {
  const actor = makeActor({ effectTypes: ["necrotic"] });
  const original = damageRoll("2d6", { type: "radiant" });

  assert.equal(roll([original], { actor })[0], original);
});

test("an actor with no marker is left alone", () => {
  const original = damageRoll("2d6", { type: "necrotic" });

  assert.equal(roll([original], { actor: makeActor() })[0], original);
});

test("advantage is granted when the type was never chosen but is on offer", () => {
  const actor = makeActor({ effectTypes: ["necrotic"] });
  const [result] = roll([damageRoll("2d6", { types: ["necrotic", "radiant"] })], { actor });

  assert.equal(result.formula, "{2d6, 2d6}kh");
});

test("a chosen type beats a stray term flavor", () => {
  // options.type is what dnd5e applies the damage as, so it has to win outright.
  const actor = makeActor({ effectTypes: ["necrotic"] });
  const original = damageRoll("2d6", {
    type: "fire",
    _terms: [{ options: { flavor: "Necrotic" } }]
  });

  assert.equal(roll([original], { actor })[0], original);
});

test("term flavor is used when the roll carries no typed options", () => {
  const actor = makeActor({ effectTypes: ["necrotic"] });
  const [result] = roll([damageRoll("2d6", { _terms: [{ options: { flavor: "Necrotic" } }] })], { actor });

  assert.equal(result.formula, "{2d6, 2d6}kh");
});

test("types are read from the flag, from several effects, and from delimited strings", () => {
  const cases = [
    makeActor({ flagTypes: ["necrotic"] }),
    makeActor({ flagTypes: "necrotic" }),
    makeActor({ effectTypes: ["radiant,necrotic"] }),
    makeActor({ effectTypes: ["radiant", "necrotic"] }),
    makeActor({ flagTypes: "radiant", effectTypes: ["necrotic"] }),
    makeActor({ effectTypes: [" Necrotic "] })
  ];

  for (const actor of cases) {
    const [result] = roll([damageRoll("2d6", { type: "necrotic" })], { actor });
    assert.equal(result.formula, "{2d6, 2d6}kh", `failed for ${JSON.stringify(actor.flags)}`);
  }
});

test("an actor can hold advantage on more than one type at once", () => {
  const actor = makeActor({ effectTypes: ["necrotic", "radiant"] });
  const result = roll([damageRoll("2d6", { type: "necrotic" }), damageRoll("1d8", { type: "radiant" })], { actor });

  assert.equal(result[0].formula, "{2d6, 2d6}kh");
  assert.equal(result[1].formula, "{1d8, 1d8}kh");
});

test("a roll is never wrapped twice", () => {
  const actor = makeActor({ effectTypes: ["necrotic"] });
  const rolls = roll([damageRoll("2d6", { type: "necrotic" })], { actor });
  const wrapped = rolls[0];

  onDamageRoll(rolls, { subject: { actor } }, {}, {});

  assert.equal(rolls[0], wrapped, "the second pass must be a no-op");
  assert.equal(rolls[0].formula, "{2d6, 2d6}kh");
});

test("turning the setting off disables the feature without disabling the module", () => {
  state.settings["cg-misc.damageAdvantageEnabled"] = false;
  const actor = makeActor({ effectTypes: ["necrotic"] });
  const original = damageRoll("2d6", { type: "necrotic" });

  assert.equal(roll([original], { actor })[0], original);
});

test("a failure inside the hook surfaces a notification instead of breaking the roll", () => {
  const actor = makeActor({ effectTypes: ["necrotic"] });
  const poisoned = damageRoll("2d6", { type: "necrotic" });
  Object.defineProperty(poisoned, "constructor", {
    get() {
      throw new Error("boom");
    }
  });

  assert.doesNotThrow(() => roll([poisoned], { actor }));
  assert.equal(state.notifications.at(-1)?.[0], "error");
});

test("the hook never returns false, which would cancel the roll", () => {
  const actor = makeActor({ effectTypes: ["necrotic"] });

  assert.notEqual(onDamageRoll([damageRoll("2d6", { type: "necrotic" })], { subject: { actor } }, {}, {}), false);
  assert.notEqual(onDamageRoll([], {}, {}, {}), false);
});
