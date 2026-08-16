import test from "node:test";
import assert from "node:assert/strict";

import { hooks, registered, moduleEntry, state } from "./foundry-stubs.mjs";

/**
 * Loads the module the same way Foundry does - evaluate the manifest's esmodule, then fire
 * init - and checks the whole graph comes up. A broken import, a renamed export or a setting
 * read before it is registered all fail here rather than as a blank screen in a live world.
 */
const manifest = JSON.parse(
  await (await import("node:fs/promises")).readFile(new URL("../module.json", import.meta.url), "utf8")
);

await import(new URL(`../${manifest.esmodules[0]}`, import.meta.url).href);

test("the manifest's esmodule evaluates and registers an init hook", () => {
  assert.equal(manifest.esmodules.length, 1);
  assert.ok(hooks.get("init"), "no init hook was registered");
});

test("DAE field registration is set up at evaluation time, before init can race it", () => {
  // DAE fires this from inside its own init handler, so ours has to already be listening.
  assert.ok(hooks.get("dae.addAutoFields"), "dae.addAutoFields listener must exist pre-init");
});

test("init registers every setting the code later reads", () => {
  hooks.get("init")();

  for (const key of Object.keys(state.settings)) {
    assert.ok(registered.has(key), `setting never registered: ${key}`);
  }
});

test("init exposes the documented API surface", () => {
  assert.equal(typeof moduleEntry.api.toggle, "function", "api.toggle is the documented macro entry point");

  const api = moduleEntry.api.damageAdvantage;
  for (const method of ["get", "toggle", "clear"]) {
    assert.equal(typeof api[method], "function", `api.damageAdvantage.${method} missing`);
  }
  assert.equal(api.key, "flags.cg-misc.damageAdvantage", "the effect key is part of the public surface");
});

test("the damage roll hook is live once init has run", () => {
  assert.ok(hooks.get("dnd5e.postDamageRollConfiguration"), "damage hook not registered at init");
});

test("the DAE field registration runs without throwing and claims our key", () => {
  const added = [];
  hooks.get("dae.addAutoFields")((fields) => added.push(...fields), {
    StringField: class StringField {}
  });

  assert.equal(added[0]?.name, "flags.cg-misc.damageAdvantage");
  assert.equal(typeof added[0]?.type, "function", "DAE instantiates the type itself, so it must be a class");
});
