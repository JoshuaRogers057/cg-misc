import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { state, applied, resetApplied, FakeRollTable } from "./foundry-stubs.mjs";
import { registerSettings } from "../scripts/settings.mjs";
import { auditTable, testFace, statusOf, STATUS } from "../scripts/dome-test.mjs";

registerSettings();

const SRC = new URL("../packs/_source/cg-misc-tables/", import.meta.url);
const SOURCES = {
  healing: "dome-healing.json",
  necromancy: "dome-necromancy.json",
  wild: "dome-wild-magic.json",
  rest: "dome-rest-mutation.json"
};
const IDS = {
  wild: "cgmiscdometbl001",
  necromancy: "cgmiscdometbl002",
  healing: "cgmiscdometbl003",
  rest: "cgmiscdometbl004"
};

/** Serve the real shipped tables, so the audit is measured against real data. */
function seed() {
  state.packTables.clear();
  for (const [trigger, file] of Object.entries(SOURCES)) {
    const raw = JSON.parse(fs.readFileSync(new URL(file, SRC), "utf8"));
    state.packTables.set(
      IDS[trigger],
      new FakeRollTable({
        id: IDS[trigger],
        name: raw.name,
        flags: raw.flags,
        results: raw.results.map((r) => ({ ...r, id: r._id }))
      })
    );
  }
}

/** dome.mjs caches resolved tables; the table hooks are what invalidate it. */
async function freshAudit(trigger) {
  const { hooks } = await import("./foundry-stubs.mjs");
  hooks.get("createRollTable")?.();
  return auditTable(trigger);
}

test.beforeEach(() => {
  resetApplied();
  state.messages.length = 0;
  state.notifications.length = 0;
  state.worldTables.length = 0;
  state.userTargets = [];
  canvas.tokens.controlled = [];
  seed();
});

test("every face of every table is listed exactly once, in order", async () => {
  const { registerDome } = await import("../scripts/dome.mjs");
  registerDome();

  for (const trigger of Object.keys(SOURCES)) {
    const audit = await freshAudit(trigger);
    const faces = audit.rows.map((r) => r.face);

    assert.deepEqual(faces, [...faces].sort((a, b) => a - b), `${trigger} is out of order`);
    assert.equal(new Set(faces).size, faces.length, `${trigger} lists a face twice`);
  }
});

test("the audit counts match the shipped tables", async () => {
  const healing = await freshAudit("healing");
  const necromancy = await freshAudit("necromancy");

  assert.deepEqual(healing.counts, { automated: 32, cosmetic: 6, manual: 2 });
  assert.deepEqual(necromancy.counts, { automated: 19, cosmetic: 18, manual: 3 });
});

test("the wild magic and rest tables report as unautomated, not as broken", async () => {
  for (const trigger of ["wild", "rest"]) {
    const audit = await freshAudit(trigger);
    assert.equal(audit.counts.automated ?? 0, 0, `${trigger} should have no automation yet`);
    assert.ok((audit.counts.cosmetic ?? 0) + (audit.counts.manual ?? 0) === audit.rows.length);
  }
});

test("status is derived from the registry, then the cosmetic marker", () => {
  // 89KtRcT5elUyLahg is healing face 1, which is automated.
  assert.equal(statusOf("healing", { id: "89KtRcT5elUyLahg", description: "x" }), STATUS.AUTOMATED);
  assert.equal(statusOf("healing", { id: "nope", description: "Old scars. (Cosmetic)" }), STATUS.COSMETIC);
  assert.equal(statusOf("healing", { id: "nope", description: "It is Stunned." }), STATUS.MANUAL);
});

test("testing a face rolls that exact result", async () => {
  // Face 17 adds exhaustion, so the stub needs update() or the applier logs a caught error.
  const actor = {
    name: "Dummy",
    uuid: "Actor.dummy",
    id: "dummy",
    system: { attributes: { exhaustion: 0 } },
    getActiveTokens: () => [],
    update: async () => {}
  };
  canvas.tokens.controlled = [{ actor }];

  const raw = JSON.parse(fs.readFileSync(new URL(SOURCES.healing, SRC), "utf8"));
  const face = 17; // "gains 1 level of Exhaustion"
  const expected = raw.results.find((r) => face >= r.range[0] && face <= r.range[1]);

  await testFace("healing", face);

  const card = state.messages.at(-1);
  assert.ok(card.content.includes(expected.description), "the card must show the requested face");
  assert.equal(card.rolls[0].total, face);
});

test("a forced face still applies its effect for real", async () => {
  const actor = {
    name: "Dummy",
    uuid: "Actor.dummy",
    id: "dummy",
    system: { attributes: { hp: { value: 5, max: 10 }, exhaustion: 0 } },
    getActiveTokens: () => [],
    update: async (data) => applied.exhaustion.push(data["system.attributes.exhaustion"])
  };
  canvas.tokens.controlled = [{ actor }];

  await testFace("healing", 17);

  assert.deepEqual(applied.exhaustion, [1], "testing is the same code path as a real cast");
});

test("apply:false previews a face without touching the actor", async () => {
  const actor = {
    name: "Dummy",
    uuid: "Actor.dummy",
    id: "dummy",
    system: { attributes: { hp: { value: 5, max: 10 }, exhaustion: 0 } },
    getActiveTokens: () => [],
    update: async () => applied.exhaustion.push("should not happen")
  };
  canvas.tokens.controlled = [{ actor }];

  await testFace("healing", 17, { apply: false });

  assert.equal(applied.exhaustion.length, 0);
  assert.equal(state.messages.length, 1, "the card is still posted so the result is visible");
});

test("testing without a token warns instead of throwing", async () => {
  const result = await testFace("healing", 1);

  assert.equal(result, null);
  assert.equal(state.notifications.at(-1)?.[0], "warn");
  assert.equal(state.messages.length, 0);
});

test("every automated face can actually be reached by a forced roll", async () => {
  // The point of the tester: no automated result should be unreachable.
  const actor = { name: "Dummy", uuid: "Actor.dummy", id: "dummy", getActiveTokens: () => [] };
  canvas.tokens.controlled = [{ actor }];

  for (const trigger of ["healing", "necromancy"]) {
    const audit = await freshAudit(trigger);
    for (const row of audit.rows.filter((r) => r.status === STATUS.AUTOMATED)) {
      state.messages.length = 0;
      await testFace(trigger, row.face, { apply: false });
      const card = state.messages.at(-1);
      assert.ok(card, `${trigger} face ${row.face} produced no card`);
      assert.equal(card.rolls[0].total, row.face, `${trigger} face ${row.face} rolled something else`);
    }
  }
});
