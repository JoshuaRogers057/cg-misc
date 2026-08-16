import test from "node:test";
import assert from "node:assert/strict";

import { state, hooks, gmUser, FakeRollTable } from "./foundry-stubs.mjs";
import { registerSettings } from "../scripts/settings.mjs";
import { registerDome, toggleDome, isDome, classify } from "../scripts/dome.mjs";

registerSettings();
registerDome();

const onUseActivity = hooks.get("dnd5e.postUseActivity");
const onRestCompleted = hooks.get("dnd5e.restCompleted");
const invalidateTables = hooks.get("createRollTable");

const TABLE_IDS = {
  wild: "cgmiscdometbl001",
  necromancy: "cgmiscdometbl002",
  healing: "cgmiscdometbl003",
  rest: "cgmiscdometbl004"
};

/** Rebuild the shipped tables, each landing on a face whose text names the table. */
function seedPackTables() {
  state.packTables.clear();
  for (const [trigger, id] of Object.entries(TABLE_IDS)) {
    state.packTables.set(
      id,
      new FakeRollTable({
        id,
        name: `The Dome: ${trigger}`,
        flags: { "cg-misc": { domeTable: trigger } },
        results: [{ range: [1, 100], description: `${trigger} result` }],
        total: 7
      })
    );
  }
}

const actor = { id: "a1", name: "Caster", type: "character" };

function spell({ level = 1, school = "evo", type = "damage", name = "Fireball" } = {}) {
  return { type, actor, item: { type: "spell", name, system: { level, school } } };
}

/** The trigger recorded on the posted card, or "" if the Dome stayed quiet. */
function lastTrigger() {
  return state.messages.at(-1)?.flags?.["cg-misc"]?.dome ?? "";
}

test.beforeEach(() => {
  state.settings["cg-misc.dome"] = true;
  state.messages.length = 0;
  state.notifications.length = 0;
  state.worldTables.length = 0;
  gmUser.isGM = true;
  seedPackTables();
  invalidateTables();
});

test("with the Dome down, nothing rolls", async () => {
  state.settings["cg-misc.dome"] = false;
  await onUseActivity(spell());

  assert.equal(state.messages.length, 0);
});

test("a leveled healing spell rolls the healing table", async () => {
  await onUseActivity(spell({ type: "heal", school: "evo", name: "Cure Wounds" }));

  assert.equal(lastTrigger(), "healing");
});

test("a leveled necromancy spell rolls the necromancy table", async () => {
  await onUseActivity(spell({ school: "nec", name: "Blight" }));

  assert.equal(lastTrigger(), "necromancy");
});

test("any other leveled spell rolls the wild magic table", async () => {
  await onUseActivity(spell({ school: "evo", name: "Fireball" }));

  assert.equal(lastTrigger(), "wild");
});

test("cantrips are exempt whatever their school", async () => {
  for (const school of ["evo", "nec"]) {
    await onUseActivity(spell({ level: 0, school, name: "Chill Touch" }));
  }
  await onUseActivity(spell({ level: 0, type: "heal", name: "Spare the Dying" }));

  assert.equal(state.messages.length, 0, "a d100 per cantrip would drown the chat log");
});

test("non-spell items never trigger the Dome", async () => {
  await onUseActivity({ type: "attack", actor, item: { type: "weapon", name: "Longsword", system: {} } });
  await onUseActivity({ type: "heal", actor, item: { type: "consumable", name: "Potion", system: {} } });

  assert.equal(state.messages.length, 0);
});

test("a spell that both heals and is necromancy rolls healing, once", async () => {
  // Documented precedence: healing is checked first, matching the order the triggers were given.
  await onUseActivity(spell({ type: "heal", school: "nec", name: "False Life" }));

  assert.equal(state.messages.length, 1, "one roll, not one per matching trigger");
  assert.equal(lastTrigger(), "healing");
});

test("the Dome covers every actor, monsters included", async () => {
  const lich = { id: "npc1", name: "Lich", type: "npc" };
  await onUseActivity({ type: "damage", actor: lich, item: { type: "spell", name: "Finger of Death", system: { level: 7, school: "nec" } } });

  assert.equal(lastTrigger(), "necromancy");
});

test("finishing a short rest rolls the mutation table", async () => {
  await onRestCompleted(actor, { type: "short" }, { type: "short" });

  assert.equal(lastTrigger(), "rest");
});

test("each resting character rolls separately", async () => {
  for (const name of ["Ainsley", "Bran", "Cora"]) {
    await onRestCompleted({ id: name, name, type: "character" }, { type: "short" }, { type: "short" });
  }

  assert.equal(state.messages.length, 3, "one mutation each, not one for the party");
});

test("long rests do not trigger the Dome", async () => {
  await onRestCompleted(actor, { type: "long" }, { type: "long" });

  assert.equal(state.messages.length, 0);
});

test("the posted card carries the result text and the roll", async () => {
  await onUseActivity(spell());
  const message = state.messages.at(-1);

  assert.match(message.content, /wild result/);
  assert.equal(message.rolls?.[0]?.total, 7, "the roll travels with the card so the table can see it");
});

test("a world table with the same flag overrides the shipped one", async () => {
  // The escape hatch for a GM customising results without editing the module.
  state.worldTables.push(
    new FakeRollTable({
      id: "world1",
      name: "House Wild Magic",
      flags: { "cg-misc": { domeTable: "wild" } },
      results: [{ range: [1, 100], description: "house result" }],
      total: 7
    })
  );
  invalidateTables();

  await onUseActivity(spell());

  assert.match(state.messages.at(-1).content, /house result/);
});

test("a missing table reports an error instead of throwing", async () => {
  state.packTables.clear();
  invalidateTables();

  await assert.doesNotReject(() => onUseActivity(spell()));
  assert.equal(state.notifications.at(-1)?.[0], "error");
  assert.equal(state.messages.length, 0);
});

test("toggling the Dome announces it and refreshes its control", async () => {
  ui.controls.rendered.length = 0;
  state.settings["cg-misc.dome"] = false;

  assert.equal(await toggleDome(), true);
  assert.equal(isDome(), true);
  assert.match(state.messages.at(-1).content, /Dome\.AnnounceOn/);
  assert.deepEqual(ui.controls.rendered.at(-1), { toggles: { cgMiscDome: true } });
});

test("a player cannot raise the Dome", async () => {
  state.settings["cg-misc.dome"] = false;
  gmUser.isGM = false;

  assert.equal(await toggleDome(true), null);
  assert.equal(isDome(), false);
});

test("classify is exported so the triggers can be reasoned about directly", () => {
  assert.equal(classify(spell({ type: "heal" })), "healing");
  assert.equal(classify(spell({ school: "nec" })), "necromancy");
  assert.equal(classify(spell()), "wild");
  assert.equal(classify(spell({ level: 0 })), "");
  assert.equal(classify(null), "");
});
