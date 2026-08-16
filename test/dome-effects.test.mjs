import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { applied, resetApplied, scene, state } from "./foundry-stubs.mjs";
import { DOME_EFFECTS, HEALING_EFFECTS, NECROMANCY_EFFECTS } from "../scripts/dome-effects.mjs";
import { applyDomeResults } from "../scripts/dome-apply.mjs";

const SRC = new URL("../packs/_source/cg-misc-tables/", import.meta.url);
const table = (file) => JSON.parse(fs.readFileSync(new URL(file, SRC), "utf8"));

const TABLES = {
  healing: table("dome-healing.json"),
  necromancy: table("dome-necromancy.json")
};

/* -------------------------------------------- */
/*  The registry must match the shipped tables  */
/* -------------------------------------------- */

test("every automated id exists in its table", () => {
  // The ids were transcribed by hand; a typo would silently make that result text-only.
  for (const [trigger, registry] of Object.entries(DOME_EFFECTS)) {
    const known = new Set(TABLES[trigger].results.map((r) => r._id));
    for (const id of Object.keys(registry)) {
      assert.ok(known.has(id), `${trigger}: id ${id} is not in ${TABLES[trigger].name}`);
    }
  }
});

test("no cosmetic result is automated", () => {
  for (const [trigger, registry] of Object.entries(DOME_EFFECTS)) {
    for (const result of TABLES[trigger].results) {
      if (!/\(Cosmetic\)/i.test(result.description)) continue;
      assert.ok(!registry[result._id], `${trigger}: cosmetic result ${result._id} should not be automated`);
    }
  }
});

test("every automated spec does something", () => {
  const verbs = ["effect", "damage", "healing", "status", "exhaust", "save"];
  for (const [trigger, registry] of Object.entries(DOME_EFFECTS)) {
    for (const [id, spec] of Object.entries(registry)) {
      assert.ok(verbs.some((v) => v in spec), `${trigger}: spec ${id} has no effect at all`);
    }
  }
});

test("coverage is reported honestly", () => {
  // Not a threshold - this pins the numbers so a silent regression in coverage is visible.
  const counts = {};
  for (const [trigger, registry] of Object.entries(DOME_EFFECTS)) {
    const results = TABLES[trigger].results;
    const cosmetic = results.filter((r) => /\(Cosmetic\)/i.test(r.description)).length;
    counts[trigger] = { total: results.length, cosmetic, automated: Object.keys(registry).length };
  }

  assert.deepEqual(counts.healing, { total: 40, cosmetic: 6, automated: 31 });
  assert.deepEqual(counts.necromancy, { total: 40, cosmetic: 18, automated: 17 });
});

/* -------------------------------------------- */
/*  Application                                 */
/* -------------------------------------------- */

function makeActor({ name = "Caster", uuid = "Actor.caster", hp = { value: 10, max: 20 }, save = 5 } = {}) {
  const actor = {
    name,
    uuid,
    system: { attributes: { hp, exhaustion: 0 } },
    getActiveTokens: () => [{ actor }],
    applyDamage: async (parts) => applied.healing.push({ uuid, value: parts[0].value }),
    update: async (data) => applied.exhaustion.push({ uuid, level: data["system.attributes.exhaustion"] }),
    rollSavingThrow: async ({ ability, target }) => {
      applied.saves.push({ uuid, ability, dc: target });
      return [{ total: save }];
    }
  };
  return actor;
}

const results = (trigger, id) => [TABLES[trigger].results.find((r) => r._id === id)].map((r) => ({ ...r, id: r._id }));

test.beforeEach(() => {
  resetApplied();
  scene.nearby.length = 0;
  state.userTargets = [];
});

test("a healing effect lands on the targeted creature, not the caster", async () => {
  const caster = makeActor({ name: "Cleric", uuid: "Actor.cleric" });
  const patient = makeActor({ name: "Fighter", uuid: "Actor.fighter" });
  state.userTargets = [{ actor: patient }];

  await applyDomeResults("healing", results("healing", "89KtRcT5elUyLahg"), caster);

  assert.equal(applied.effects.length, 1);
  assert.equal(applied.effects[0].actorUuid, "Actor.fighter");
  assert.equal(applied.effects[0].effects[0].changes[0].key, "flags.midi-qol.disadvantage.concentration");
});

test("with nothing targeted, a healing effect falls back to the caster", async () => {
  const caster = makeActor({ uuid: "Actor.cleric" });

  await applyDomeResults("healing", results("healing", "89KtRcT5elUyLahg"), caster);

  assert.equal(applied.effects[0].actorUuid, "Actor.cleric", "self-heals must still resolve");
});

test("extra healing is applied as healing, not damage", async () => {
  const caster = makeActor({ uuid: "Actor.cleric" });

  await applyDomeResults("healing", results("healing", "X5mOf2OHoxk73PvC"), caster);

  assert.equal(applied.healing.length, 1);
  assert.equal(applied.healing[0].value, 8, "1d8 maximised by the deterministic stub");
});

test("exhaustion increments the actor's level", async () => {
  const caster = makeActor({ uuid: "Actor.cleric" });

  await applyDomeResults("healing", results("healing", "fWV9xp1KLoOm4LqA"), caster);

  assert.deepEqual(applied.exhaustion, [{ uuid: "Actor.cleric", level: 1 }]);
});

test("a condition is applied as a status effect", async () => {
  const caster = makeActor({ uuid: "Actor.cleric" });

  await applyDomeResults("healing", results("healing", "sOGy2iBUuGgNZaIx"), caster);

  assert.deepEqual(applied.effects[0].effects[0].statuses, ["blind"]);
});

test("necromancy area damage hits everyone nearby and never the caster", async () => {
  const caster = makeActor({ name: "Necromancer", uuid: "Actor.necro" });
  scene.nearby = [
    { uuid: "Actor.necro", distance: 0 },
    { uuid: "Actor.ally", distance: 10, name: "Ally" },
    { uuid: "Actor.foe", distance: 15, name: "Foe" },
    { uuid: "Actor.far", distance: 40, name: "Far" }
  ].map((a) => ({ ...a, getActiveTokens: () => [{ actor: a }], system: { attributes: { hp: { value: 5, max: 10 } } } }));

  // 1d6 cold to every other creature within 20 feet.
  await applyDomeResults("necromancy", results("necromancy", "cd0ZWXuBs18iAxKE"), caster);

  assert.equal(applied.damage.length, 1);
  assert.equal(applied.damage[0].type, "cold");
  assert.equal(applied.damage[0].targets, 2, "the ally and the foe, not the caster and not the far token");
});

test("a random-target result affects exactly one creature", async () => {
  const caster = makeActor({ uuid: "Actor.necro" });
  scene.nearby = ["a", "b", "c"].map((id) => ({
    uuid: `Actor.${id}`,
    distance: 10,
    getActiveTokens() {
      return [{ actor: this }];
    },
    system: { attributes: { hp: { value: 5, max: 10 } } }
  }));

  await applyDomeResults("necromancy", results("necromancy", "rSxBSvDkJDd0WcjT"), caster);

  assert.equal(applied.damage[0].targets, 1);
});

test("a save result rolls for each target and only affects those that fail", async () => {
  const caster = makeActor({ uuid: "Actor.necro" });
  const passer = makeActor({ uuid: "Actor.passer", save: 18 });
  const failer = makeActor({ uuid: "Actor.failer", save: 3 });
  scene.nearby = [
    { ...passer, disposition: -1 },
    { ...failer, disposition: -1 }
  ];

  // DC 12 Wisdom save or Frightened, enemies within 10 feet.
  await applyDomeResults("necromancy", results("necromancy", "Tbjqmjpr7LSkHWPh"), caster);

  assert.equal(applied.saves.length, 2, "both enemies roll");
  assert.equal(applied.effects.length, 1, "only the failure is Frightened");
  assert.deepEqual(applied.effects[0].effects[0].statuses, ["frightened"]);
});

test("a wounded-only result skips creatures at full health", async () => {
  const caster = makeActor({ uuid: "Actor.necro" });
  const mk = (uuid, value) => ({
    uuid,
    distance: 10,
    system: { attributes: { hp: { value, max: 10 } } },
    getActiveTokens() {
      return [{ actor: this }];
    }
  });
  scene.nearby = [mk("Actor.hurt", 4), mk("Actor.fine", 10)];

  await applyDomeResults("necromancy", results("necromancy", "EJWTpunnfW1mQKRq"), caster);

  assert.equal(applied.damage[0].targets, 1, "only the wounded creature");
});

test("a cosmetic result applies nothing and reports nothing", async () => {
  const caster = makeActor();
  const cosmetic = TABLES.necromancy.results.find((r) => /\(Cosmetic\)/i.test(r.description));

  const note = await applyDomeResults("necromancy", [{ ...cosmetic, id: cosmetic._id }], caster);

  assert.equal(note, "");
  assert.equal(applied.effects.length + applied.damage.length, 0);
});

test("an area result with no token on the scene degrades quietly", async () => {
  const caster = makeActor({ uuid: "Actor.necro" });
  caster.getActiveTokens = () => [];

  const note = await applyDomeResults("necromancy", results("necromancy", "cd0ZWXuBs18iAxKE"), caster);

  assert.equal(note, "");
  assert.equal(applied.damage.length, 0, "no token means no measurable area, not a crash");
});

test("the rest and wild magic tables are deliberately not automated", () => {
  assert.ok(!DOME_EFFECTS.rest, "rest mutations are permanent cosmetic changes");
  assert.ok(!DOME_EFFECTS.wild, "the wild magic table was not part of this scope");
  assert.equal(Object.keys(HEALING_EFFECTS).length + Object.keys(NECROMANCY_EFFECTS).length, 48);
});
