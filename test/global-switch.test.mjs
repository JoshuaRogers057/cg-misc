import test from "node:test";
import assert from "node:assert/strict";

import { state, hooks, registered, gmUser, FakeDamageRoll, makeActor } from "./foundry-stubs.mjs";
import { registerSettings } from "../scripts/settings.mjs";
import { registerDamageAdvantage, toggleGlobal, isGlobal } from "../scripts/damage-advantage.mjs";

registerSettings();
registerDamageAdvantage();
const onDamageRoll = hooks.get("dnd5e.postDamageRollConfiguration");

const damageRoll = (formula, options = {}) => new FakeDamageRoll(formula, {}, options);

/** Roll damage for an actor the module knows nothing about. */
function rollFor(actor, options = { type: "necrotic" }) {
  const rolls = [damageRoll("2d6", options)];
  onDamageRoll(rolls, actor ? { subject: { actor } } : {}, {}, {});
  return rolls[0];
}

test.beforeEach(() => {
  state.settings["cg-misc.damageAdvantageEnabled"] = true;
  state.settings["cg-misc.damageAdvantageGlobal"] = false;
  state.settings["cg-misc.damageAdvantageTypes"] = "necrotic";
  state.notifications.length = 0;
  state.messages.length = 0;
  gmUser.isGM = true;
});

test("with the switch off, an unmarked actor is untouched", () => {
  const original = damageRoll("2d6", { type: "necrotic" });
  const rolls = [original];
  onDamageRoll(rolls, { subject: { actor: makeActor() } }, {}, {});

  assert.equal(rolls[0], original);
});

test("with the switch on, an unmarked actor gets advantage with no effect added", async () => {
  await toggleGlobal();

  assert.equal(isGlobal(), true);
  assert.equal(rollFor(makeActor()).formula, "{2d6, 2d6}kh");
});

test("the switch covers every actor, monsters included", async () => {
  await toggleGlobal(true);

  for (const name of ["Player Character", "Goblin", "Lich"]) {
    assert.equal(rollFor(makeActor({ name })).formula, "{2d6, 2d6}kh", `missed ${name}`);
  }
});

test("the switch applies even when no actor can be resolved", async () => {
  // Damage rolled outside an activity has no subject and no speaker; a world-wide rule still
  // has to cover it, which is why the hook no longer bails on a missing actor.
  await toggleGlobal(true);

  assert.equal(rollFor(null).formula, "{2d6, 2d6}kh");
});

test("the switch only covers the configured types", async () => {
  await toggleGlobal(true);

  assert.equal(rollFor(makeActor(), { type: "fire" }).formula, "2d6", "fire is not configured");
  assert.equal(rollFor(makeActor(), { type: "necrotic" }).formula, "{2d6, 2d6}kh");
});

test("several configured types are all covered", async () => {
  state.settings["cg-misc.damageAdvantageTypes"] = "necrotic, radiant";
  await toggleGlobal(true);

  assert.equal(rollFor(makeActor(), { type: "radiant" }).formula, "{2d6, 2d6}kh");
  assert.equal(rollFor(makeActor(), { type: "necrotic" }).formula, "{2d6, 2d6}kh");
});

test("toggling back off restores normal rolls", async () => {
  await toggleGlobal(true);
  await toggleGlobal(false);

  assert.equal(isGlobal(), false);
  assert.equal(rollFor(makeActor()).formula, "2d6");
});

test("per-actor effects still work alongside the switch", async () => {
  // The switch grants necrotic; this actor's own effect grants radiant on top.
  await toggleGlobal(true);
  const actor = makeActor({ effectTypes: ["radiant"] });

  assert.equal(rollFor(actor, { type: "necrotic" }).formula, "{2d6, 2d6}kh");
  assert.equal(rollFor(actor, { type: "radiant" }).formula, "{2d6, 2d6}kh");
});

test("the master switch outranks the world switch", async () => {
  await toggleGlobal(true);
  state.settings["cg-misc.damageAdvantageEnabled"] = false;

  assert.equal(rollFor(makeActor()).formula, "2d6", "master off must stop everything");
});

test("turning the switch on while the master switch is off warns rather than failing quietly", async () => {
  state.settings["cg-misc.damageAdvantageEnabled"] = false;
  await toggleGlobal(true);

  assert.ok(
    state.notifications.some(([level]) => level === "warn"),
    "the contradiction has to be surfaced"
  );
});

test("toggling announces the change in chat exactly once", async () => {
  await toggleGlobal(true);
  assert.equal(state.messages.length, 1);
  assert.match(state.messages[0].content, /AnnounceOn/);

  await toggleGlobal(false);
  assert.equal(state.messages.length, 2);
  assert.match(state.messages[1].content, /AnnounceOff/);
});

test("only the designated GM announces, so one message reaches the table", async () => {
  const onChange = registered.get("cg-misc.damageAdvantageGlobal").onChange;

  // Stand in for a second connected client receiving the same world setting update.
  const other = { isGM: true, name: "Co-GM" };
  game.user = other;
  onChange(true);
  game.user = gmUser;

  assert.equal(state.messages.length, 0, "a non-designated client must stay silent");
});

test("a player cannot flip the world switch", async () => {
  gmUser.isGM = false;

  assert.equal(await toggleGlobal(true), null);
  assert.equal(isGlobal(), false);
  assert.ok(state.notifications.some(([level]) => level === "warn"));
});

test("every client refreshes its scene control toggle when the switch changes", async () => {
  ui.controls.rendered.length = 0;
  await toggleGlobal(true);

  assert.deepEqual(ui.controls.rendered.at(-1), { toggles: { cgMiscDamageAdvantage: true } });
});
