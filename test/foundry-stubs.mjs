/**
 * The smallest slice of the Foundry globals damage-advantage.mjs touches, so its hook can be
 * driven under `node --test` without a running server. Import this before importing anything
 * from scripts/.
 */

function getProperty(object, key) {
  let target = object;
  for (const part of key.split(".")) {
    if (target === null || target === undefined) return undefined;
    target = target[part];
  }
  return target;
}

function deepClone(value) {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(deepClone);
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, deepClone(v)]));
}

export const state = {
  settings: {
    "cg-misc.damageAdvantageEnabled": true,
    "cg-misc.damageAdvantageGlobal": false,
    "cg-misc.damageAdvantageTypes": "necrotic",
    "cg-misc.damageMinimum": false,
    "cg-misc.damageMinimumValue": 3,
    "cg-misc.dome": false,
    "cg-misc.debug": false
  },
  speakerActor: null,
  notifications: [],
  messages: [],
  /** Tables the stub compendium serves, keyed by id, plus any "world" tables. */
  packTables: new Map(),
  worldTables: []
};

/* -------------------------------------------- */
/*  Dice                                        */
/* -------------------------------------------- */

/**
 * Enough of Foundry's dice term API for the minimum-die formula rewriting to run. The real
 * parser is Foundry's; this models the shapes the rewriting depends on - that a die exposes
 * its modifiers as a mutable array, and that `formula` round-trips modifiers and flavor.
 */
export class DiceTerm {
  constructor({ number = 1, faces, modifiers = [], flavor = "" }) {
    Object.assign(this, { number, faces, modifiers, flavor });
  }

  get formula() {
    return `${this.number}d${this.faces}${this.modifiers.join("")}${this.flavor ? `[${this.flavor}]` : ""}`;
  }
}

class PlainTerm {
  constructor(text) {
    this.text = text;
  }

  get formula() {
    return this.text;
  }
}

export class ParentheticalTerm {
  constructor({ term, options }) {
    Object.assign(this, { term, options });
  }

  get formula() {
    return `(${this.term})`;
  }
}

export class PoolTerm {
  constructor({ terms, modifiers = [], options }) {
    Object.assign(this, { terms, modifiers, options });
  }

  get formula() {
    return `{${this.terms.join(",")}}${this.modifiers.join("")}`;
  }
}

const DIE = /(\d*)d(\d+)((?:[a-z]+\d*)*)(?:\[([^\]]+)\])?/gi;

globalThis.Roll = {
  parse(input) {
    // Foundry's parser strips all whitespace before tokenising, so a rewritten formula comes
    // back without the spaces it went in with. Mirrored here so tests assert the real shape.
    const formula = String(input).replace(/\s+/g, "");
    const terms = [];
    let last = 0;
    DIE.lastIndex = 0;
    for (let m = DIE.exec(formula); m; m = DIE.exec(formula)) {
      if (m.index > last) terms.push(new PlainTerm(formula.slice(last, m.index)));
      terms.push(
        new DiceTerm({
          number: m[1] || 1,
          faces: m[2],
          modifiers: m[3] ? m[3].match(/[a-z]+\d*/gi) ?? [] : [],
          flavor: m[4] ?? ""
        })
      );
      last = DIE.lastIndex;
    }
    if (last < formula.length) terms.push(new PlainTerm(formula.slice(last)));
    return terms;
  },
  getFormula: (terms) => terms.map((t) => t.formula).join("")
};

globalThis.foundry = {
  utils: { getProperty, deepClone },
  dice: { terms: { DiceTerm, ParentheticalTerm, PoolTerm } }
};

/** Settings registered via game.settings.register, so a test can assert on them. */
export const registered = new Map();

/** Stands in for the module entry Foundry hands out, which is where the API is hung. */
export const moduleEntry = { id: "cg-misc", active: true };

export const gmUser = { isGM: true, name: "GM" };

globalThis.game = {
  system: { id: "dnd5e" },
  user: gmUser,
  // The designated GM, which is how the settings onChange decides who announces the change.
  users: { activeGM: gmUser },
  modules: { get: (id) => (id === "cg-misc" ? moduleEntry : undefined) },
  settings: {
    get(module, key) {
      const id = `${module}.${key}`;
      if (!(id in state.settings)) throw new Error(`setting not registered: ${id}`);
      return state.settings[id];
    },
    register(module, key, data) {
      registered.set(`${module}.${key}`, data);
    },
    async set(module, key, value) {
      state.settings[`${module}.${key}`] = value;
      registered.get(`${module}.${key}`)?.onChange?.(value);
      return value;
    }
  },
  i18n: {
    localize: (key) => key,
    format: (key) => key
  }
};

globalThis.ui = {
  notifications: {
    error: (message) => state.notifications.push(["error", message]),
    warn: (message) => state.notifications.push(["warn", message])
  }
};

globalThis.ChatMessage = {
  getSpeakerActor: () => state.speakerActor,
  getSpeaker: ({ actor } = {}) => ({ actor: actor?.id ?? null, alias: actor?.name ?? null }),
  create: (data) => {
    state.messages.push(data);
    return data;
  }
};

/**
 * A RollTable that always lands on a chosen face, so a test can assert on the posted result
 * without depending on chance.
 */
export class FakeRollTable {
  constructor({ id, name, flags = {}, results = [], total = 1 }) {
    Object.assign(this, { id, name, flags, results, total });
  }

  getFlag(scope, key) {
    return this.flags?.[scope]?.[key];
  }

  async roll() {
    const roll = { total: this.total, formula: "1d100" };
    const hit = this.results.filter((r) => this.total >= r.range[0] && this.total <= r.range[1]);
    return { roll, results: hit };
  }
}

globalThis.game.tables = state.worldTables;
globalThis.game.packs = {
  get: (id) =>
    id === "cg-misc.cg-misc-tables"
      ? { getDocument: async (docId) => state.packTables.get(docId) ?? null }
      : undefined
};

/** Scene controls, present only so the settings onChange can refresh the toggle. */
globalThis.ui.controls = {
  rendered: [],
  render(options) {
    this.rendered.push(options);
  }
};

globalThis.CONST = {
  ACTIVE_EFFECT_MODES: { CUSTOM: 0, MULTIPLY: 1, ADD: 2, DOWNGRADE: 3, UPGRADE: 4, OVERRIDE: 5 }
};

globalThis.Actor = class Actor {};
globalThis.ActiveEffect = { implementation: { create: async () => null } };

/** Captures the handlers the module registers so a test can call them directly. */
export const hooks = new Map();
globalThis.Hooks = {
  on(name, fn) {
    hooks.set(name, fn);
  },
  once(name, fn) {
    hooks.set(name, fn);
  }
};

/**
 * Stands in for dnd5e's DamageRoll. Only the surface the feature reads is modelled: the
 * formula (already critical-configured by the time our hook runs), options, data and terms.
 */
export class FakeDamageRoll {
  constructor(formula, data = {}, options = {}) {
    this.formula = formula;
    this.data = data;
    this.options = options;
    this.terms = options._terms ?? [];
  }
}

/** An actor whose advantage types come from the flag, from effects, or both. */
export function makeActor({ name = "Test", flagTypes, effectTypes = [] } = {}) {
  const actor = Object.create(globalThis.Actor.prototype);
  actor.name = name;
  actor.flags = flagTypes === undefined ? {} : { "cg-misc": { damageAdvantage: flagTypes } };
  actor.appliedEffects = effectTypes.map((value) => ({
    changes: [{ key: "flags.cg-misc.damageAdvantage", mode: 5, value }]
  }));
  return actor;
}
