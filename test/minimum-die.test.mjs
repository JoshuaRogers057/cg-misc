import test from "node:test";
import assert from "node:assert/strict";

import { state, hooks, gmUser, FakeDamageRoll, makeActor } from "./foundry-stubs.mjs";
import { registerSettings } from "../scripts/settings.mjs";
import { registerDamageAdvantage, toggleMinimum, toggleGlobal, isMinimum } from "../scripts/damage-advantage.mjs";

registerSettings();
registerDamageAdvantage();
const onDamageRoll = hooks.get("dnd5e.postDamageRollConfiguration");

/** Roll damage for an actor the module knows nothing about, and return the resulting roll. */
function rollFor(formula, options = { type: "necrotic" }) {
  const rolls = [new FakeDamageRoll(formula, {}, options)];
  onDamageRoll(rolls, { subject: { actor: makeActor() } }, {}, {});
  return rolls[0];
}

test.beforeEach(() => {
  state.settings["cg-misc.damageAdvantageEnabled"] = true;
  state.settings["cg-misc.damageAdvantageGlobal"] = false;
  state.settings["cg-misc.damageAdvantageTypes"] = "necrotic";
  state.settings["cg-misc.damageMinimum"] = false;
  state.settings["cg-misc.damageMinimumValue"] = 3;
  state.notifications.length = 0;
  state.messages.length = 0;
  gmUser.isGM = true;
});

test("with the floor off, damage dice are untouched", () => {
  assert.equal(rollFor("2d6 + 3").formula, "2d6 + 3");
});

test("with the floor on, every damage die gets a minimum", async () => {
  await toggleMinimum();

  assert.equal(isMinimum(), true);
  assert.equal(rollFor("2d6 + 3").formula, "2d6min3+3");
});

test("mixed dice in one formula all get the floor, flat modifiers do not", async () => {
  await toggleMinimum(true);

  assert.equal(rollFor("4d6 + 1d8 + 3").formula, "4d6min3+1d8min3+3");
});

test("damage type flavor survives the rewrite", async () => {
  // dnd5e leans on flavor to type damage, so losing it would misapply the whole roll.
  await toggleMinimum(true);

  assert.equal(rollFor("2d6[necrotic]").formula, "2d6min3[necrotic]");
});

test("an existing minimum in the formula is respected, not stacked", async () => {
  await toggleMinimum(true);

  assert.equal(rollFor("2d6min2").formula, "2d6min2", "the author's own floor wins");
});

test("a die that already carries other modifiers keeps them", async () => {
  await toggleMinimum(true);

  assert.equal(rollFor("2d6r1").formula, "2d6r1min3");
});

test("damage with no dice at all is left alone", async () => {
  await toggleMinimum(true);
  const flat = new FakeDamageRoll("5", {}, { type: "necrotic" });
  const rolls = [flat];
  onDamageRoll(rolls, { subject: { actor: makeActor() } }, {}, {});

  assert.equal(rolls[0], flat, "nothing to floor means no replacement roll");
});

test("the floor only touches the configured damage types", async () => {
  await toggleMinimum(true);

  assert.equal(rollFor("2d6", { type: "fire" }).formula, "2d6");
});

test("the two enhancements are independent: floor alone does not roll twice", async () => {
  await toggleMinimum(true);

  const formula = rollFor("2d6 + 3").formula;
  assert.equal(formula, "2d6min3+3");
  assert.ok(!formula.includes("kh"), "advantage is off, so there must be no pool");
});

test("advantage alone does not floor the dice", async () => {
  await toggleGlobal(true);

  assert.equal(rollFor("2d6 + 3").formula, "{2d6 + 3, 2d6 + 3}kh");
});

test("both on: the floor lands inside the pool so each half is floored", async () => {
  await toggleGlobal(true);
  await toggleMinimum(true);

  // Flooring after wrapping would put min3 on the pool itself, which is not the same thing.
  assert.equal(rollFor("2d6 + 3").formula, "{2d6min3+3, 2d6min3+3}kh");
});

test("both on, with a critical: the doubled dice are floored inside the pool", async () => {
  await toggleGlobal(true);
  await toggleMinimum(true);
  const rolls = [
    new FakeDamageRoll("4d6 + 1d8 + 3", {}, { type: "necrotic", isCritical: true, critical: { bonusDamage: "1d8" } })
  ];
  onDamageRoll(rolls, { subject: { actor: makeActor() } }, {}, {});

  assert.equal(rolls[0].formula, "{4d6min3+1d8min3+3, 4d6min3+1d8min3+3}kh");
  assert.equal(rolls[0].options.configured, true, "still required, or the crit bonus doubles up");
});

test("the floor value is configurable", async () => {
  state.settings["cg-misc.damageMinimumValue"] = 2;
  await toggleMinimum(true);

  assert.equal(rollFor("2d6").formula, "2d6min2");
});

test("a floor of 1 changes nothing, since no die rolls below 1", async () => {
  state.settings["cg-misc.damageMinimumValue"] = 1;
  await toggleMinimum(true);
  const original = new FakeDamageRoll("2d6", {}, { type: "necrotic" });
  const rolls = [original];
  onDamageRoll(rolls, { subject: { actor: makeActor() } }, {}, {});

  assert.equal(rolls[0], original);
});

test("the master switch outranks the floor", async () => {
  await toggleMinimum(true);
  state.settings["cg-misc.damageAdvantageEnabled"] = false;

  assert.equal(rollFor("2d6").formula, "2d6");
});

test("toggling the floor announces it and refreshes its own control", async () => {
  ui.controls.rendered.length = 0;
  await toggleMinimum(true);

  assert.equal(state.messages.length, 1);
  assert.match(state.messages[0].content, /DamageMinimum\.AnnounceOn/);
  assert.deepEqual(ui.controls.rendered.at(-1), { toggles: { cgMiscDamageMinimum: true } });
});

test("a player cannot flip the floor", async () => {
  gmUser.isGM = false;

  assert.equal(await toggleMinimum(true), null);
  assert.equal(isMinimum(), false);
});
