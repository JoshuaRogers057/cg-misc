import { MODULE_ID } from "./constants.mjs";

/**
 * What each non-cosmetic Dome result actually does, keyed by the TableResult's id.
 *
 * Keyed by id rather than by range so that reordering or reweighting a table cannot silently
 * shift every automation by one. The ids are the ones in packs/_source, and they are stable.
 *
 * A result maps to a spec object; anything not listed here is text-only, which covers the
 * cosmetic results and the handful of rules Foundry cannot enforce (a skipped turn, "the next
 * spell needs no components", "the next time it would drop to 0"). Those are announced by the
 * table card and left to the table.
 *
 * Spec fields, all optional:
 *   effect   ActiveEffect data applied to the subject
 *   damage   {formula, type} rolled and applied through midi, so resistances count
 *   healing  {formula} applied as healing
 *   status   a condition id to apply, e.g. "blind"
 *   exhaust  levels of exhaustion to add
 *   save     {ability, dc, onFail} - onFail is itself a spec
 *   area     {range, disposition} - applies the spec to nearby tokens instead of the subject
 *   random   pick one of the area's tokens rather than all of them
 */

const MODE = { ADD: 2, DOWNGRADE: 3, UPGRADE: 4, OVERRIDE: 5, MULTIPLY: 1 };

/* -------------------------------------------- */
/*  Change builders                             */
/* -------------------------------------------- */

/**
 * dnd5e has no advantage/disadvantage effect system of its own - the whole `flags.dnd5e.*`
 * namespace contains only `initiativeAdv` - so these are midi-qol's flags. That is the reason
 * this module requires midi.
 */
const dis = (path) => ({ key: `flags.midi-qol.disadvantage.${path}`, mode: MODE.OVERRIDE, value: "1", priority: 20 });
const adv = (path) => ({ key: `flags.midi-qol.advantage.${path}`, mode: MODE.OVERRIDE, value: "1", priority: 20 });
/** Attacks made *against* the subject get disadvantage. */
const grantsDis = (path) => ({
  key: `flags.midi-qol.grants.disadvantage.${path}`,
  mode: MODE.OVERRIDE,
  value: "1",
  priority: 20
});

/** These three are native dnd5e and need no midi. */
const speedAdd = (feet) => ({ key: "system.attributes.movement.walk", mode: MODE.ADD, value: String(feet), priority: 20 });
const speedHalf = () => ({ key: "system.attributes.movement.walk", mode: MODE.MULTIPLY, value: "0.5", priority: 20 });
const vulnerable = (type) => ({ key: "system.traits.dv.value", mode: MODE.ADD, value: type, priority: 20 });
const resistAll = () => ({ key: "system.traits.dr.all", mode: MODE.OVERRIDE, value: "1", priority: 20 });

/* -------------------------------------------- */
/*  Duration builders                           */
/* -------------------------------------------- */

const rounds = (n) => ({ rounds: n });
const seconds = (n) => ({ seconds: n });
const minutes = (n) => ({ seconds: n * 60 });
const hours = (n) => ({ seconds: n * 3600 });

/** "Until the end of its next turn" is a DAE special duration, not a clock duration. */
const TURN_END = { specialDuration: ["turnEnd"] };
/** "Until the start of its next turn" likewise. */
const TURN_START = { specialDuration: ["turnStart"] };

/**
 * Build ActiveEffect creation data.
 * @param {string} name        Shown on the token's effect list, so it has to read as a rule.
 * @param {object[]} changes
 * @param {object} duration    A dnd5e/Foundry duration, or {} for one governed by dae flags.
 * @param {object} [dae]       DAE flags, e.g. TURN_END.
 */
function eff(name, changes, duration = {}, dae = {}) {
  return {
    effect: {
      name,
      img: "icons/svg/daze.svg",
      origin: null,
      duration,
      changes,
      flags: { [MODULE_ID]: { dome: true }, dae: { ...dae } }
    }
  };
}

/** A spec with no mechanical change beyond a marker, used where only the name matters. */
const marker = (name, duration, dae) => eff(name, [], duration, dae);

const damage = (formula, type) => ({ damage: { formula, type } });
const healing = (formula) => ({ healing: { formula } });

/** Apply a spec to every other creature within `range` feet. */
const area = (range, spec, disposition = null) => ({ ...spec, area: { range, disposition } });
/** Apply a spec to one random creature within `range` feet. */
const randomNearby = (range, spec) => ({ ...spec, area: { range, disposition: null }, random: true });

/* -------------------------------------------- */
/*  The Dome: Healing                           */
/* -------------------------------------------- */

/** Results land on the healed creature - the spell's targets, or the caster if none. */
export const HEALING_EFFECTS = {
  "89KtRcT5elUyLahg": eff("Burning Pain", [dis("concentration")], minutes(1)),
  sFbReEjmdEnQtHb0: marker("Coughing Blood (no Verbal components)", rounds(4)),
  zq38gDgR8SGcDCCA: eff("Crystalline Flesh", [vulnerable("bludgeoning")], minutes(1)),
  p7rdHvYUD0cKhWFv: eff("Ice in the Veins", [speedAdd(-10)], minutes(1)),
  X5mOf2OHoxk73PvC: healing("1d8"),
  d3Y5vS0tpQdZJhs0: eff("Blurred Vision", [dis("skill.prc")], minutes(10)),
  f7TKvIGk0ydnJaai: eff("Burning and Freezing", [dis("ability.save.con")], minutes(1)),
  TcsYiTuwnofLiQjf: eff("Violent Shivers", [speedHalf()], {}, TURN_END),
  WJa7HdrFODYafume: marker("Cannot Inhale (no Verbal components)", {}, TURN_END),
  RFgiFEvsDAc2yhay: damage("1d4", "psychic"),
  "7mjgEdo1NiRrxJlh": eff("Phantom Hands", [speedHalf()], minutes(1)),
  PnSOQGvP0OWiNkfM: eff("Uncontrollable Twitching", [dis("ability.save.dex")], minutes(1)),
  "0bSXCu9OSKzLG539": eff("Lingering Healing", [resistAll()], {}, TURN_START),
  fWV9xp1KLoOm4LqA: { exhaust: 1 },
  sOGy2iBUuGgNZaIx: { status: "blind", duration: {}, dae: TURN_END },
  xKitS3VcaCWNq4ba: area(10, eff("Painful Light", [dis("attack.all")], {}, TURN_END)),
  oYpjbePoj6l4hJ72: eff("Clinging Shadow", [speedAdd(-10)], minutes(1)),
  "8rmkxH3kdekU7Cw9": eff("Seeping Blood", [speedHalf()], minutes(1)),
  mR8ZJ1Bb3KrgHHPB: eff("Harsh Croak", [dis("ability.check.cha")], hours(1)),
  PScKsxFhvEH28TJ7: eff("Paper Skin", [vulnerable("bludgeoning")], {}, TURN_START),
  Rt8gZtz5Ixjdkugm: eff("Writhing Flesh", [dis("concentration")], minutes(1)),
  IrW8V22JZ38Bn8rV: eff("Nervous Stutter", [dis("ability.check.cha")], hours(1)),
  AwrPWZ9gSYShqfcZ: eff("Stench of Burning Flesh", [dis("skill.ste")], hours(1)),
  "6byFypfW3XN8cwzC": eff("Tar-Thick Blood", [dis("ability.check.dex")], hours(1)),
  fFAMeZz00fcyRBWJ: marker("Seized Muscles (no Reactions)", {}, TURN_END),
  j7dXBewILimFy6qm: eff("Thunderous Heartbeat", [dis("skill.ste")], hours(1)),
  qV4YW2b7KFRnEdwx: eff("Wound Like Stone", [dis("ability.save.dex")], minutes(1)),
  Y0amKAFODADxQ2Vc: eff("Dilated Pupils", [dis("attack.all")], {}, TURN_END),
  ZQuR62WGYUMAjo8q: eff("Blood-Blinded", [dis("skill.prc")], rounds(4)),
  gA2OtXISdHTqHyqR: { ...damage("1d6", "lightning"), ...eff("Overstimulated (no Reactions)", [], {}, TURN_START) },
  hmRvskUfTGDCfp9w: eff("Sharpened Instincts", [adv("ability.save.all")], minutes(1))
};

/* -------------------------------------------- */
/*  The Dome: Necromancy                        */
/* -------------------------------------------- */

/** Results land on the caster, or radiate from them. */
export const NECROMANCY_EFFECTS = {
  qPcCwml9OrLanALX: eff("Shadow Armor", [grantsDis("attack.all")], {}, TURN_END),
  cd0ZWXuBs18iAxKE: area(20, damage("1d6", "cold")),
  nn61gdfwawNrOYhP: area(10, damage("1d8", "necrotic")),
  rSxBSvDkJDd0WcjT: randomNearby(30, damage("1d4", "necrotic")),
  vDttHfC2EKV0I5h7: healing("1d6"),
  H3YKZKHfVAnpb6s4: randomNearby(15, damage("1d6", "bludgeoning")),
  Tbjqmjpr7LSkHWPh: area(
    10,
    { save: { ability: "wis", dc: 12, onFail: { status: "frightened", duration: {}, dae: TURN_END } } },
    -1
  ),
  TOlzWvxs2UIH7VDl: area(20, damage("1d4", "psychic")),
  YuQLuZbl4E78BVnj: area(10, damage("1d6", "slashing")),
  dIY867Nsp6Xclw9Q: area(10, healing("1d4")),
  OoXTzqwcjqEzO5uD: area(15, damage("2d6", "necrotic")),
  Z4QkcAYtpGWzDKEM: area(5, damage("1d6", "slashing")),
  q0JfG5kb5oSJDE5R: area(10, damage("2d4", "fire")),
  EJWTpunnfW1mQKRq: area(30, { ...damage("1d4", "fire"), woundedOnly: true }),
  uKGBWTdpMSqLIaVC: area(10, damage("1d4", "cold")),
  rJaQ1BJuWuM6W2ez: eff("Spectral Guardian", [grantsDis("attack.all")], {}, TURN_END),
  QGMVk4iGT96QtIEC: area(10, {
    ...damage("1d4", "bludgeoning"),
    save: { ability: "str", dc: 12, onFail: { status: "prone" } }
  })
};

/** Every registry, keyed by the Dome trigger it belongs to. */
export const DOME_EFFECTS = {
  healing: HEALING_EFFECTS,
  necromancy: NECROMANCY_EFFECTS
};
