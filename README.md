# Champions Guild Misc

A grab bag of small dnd5e automations for the Champions Guild table. Each feature is
self-contained and can be turned off from the module settings without disabling the module.

- **Foundry VTT** v13 (verified 13.351)
- **dnd5e** 5.3.x
- **midi-qol** and **DAE** are required, but only by the Dome's automated effects. Damage
  advantage and the minimum damage die use dnd5e's own hooks and work without either.

Why midi is required: dnd5e has no advantage/disadvantage effect system of its own — the whole
`flags.dnd5e.*` namespace contains one relevant key — so roughly 15 of the Dome's effects have
nowhere else to live. midi also supplies GM-side effect creation and damage application through
resistances, which is what lets a player's spell affect creatures they don't own.

## Features

### Damage enhancement

Two independent enhancements, both applying to the same configured damage types (default
`necrotic`). Either, both or neither can be running.

| | What it does |
| --- | --- |
| **Damage advantage** | The damage roll is made twice and the higher **total** kept. The 2024 Savage Attacker mechanic, keyed to a damage type rather than to weapons, and with no once-per-turn limit. |
| **Minimum damage die** | Every damage die counts as at least 3, so 1s and 2s become 3s. D&D's Elemental Adept pattern, with a configurable floor. |

Both apply to weapon attacks, spell attacks and saving-throw spells alike.

#### The world switches (the usual way)

Two buttons in the token controls: a **skull** for advantage, a **die** for the minimum. While
a button is lit, that enhancement is on for *every* actor in the world — player characters,
NPCs and monsters alike. Nothing needs adding to anyone. Click again to turn it off.

Toggling either way posts a message to chat, so the whole table knows the rule is live. The
same switches are in **Module Settings**, and from a macro:

```js
game.modules.get("cg-misc").api.toggleGlobal();   // roll twice, keep higher
```

```js
game.modules.get("cg-misc").api.toggleMinimum();  // 1s and 2s count as 3
```

Which damage types they cover is **Module Settings → Damage Types** (comma-separate for
several), and the floor itself is **Minimum Die Value**. GM only — the buttons are hidden from
players.

With both on, a `2d6 + 3` necrotic hit rolls as `{2d6min3+3, 2d6min3+3}kh`: the floor lands
inside the pool, so each half is floored independently before the higher total wins.

#### Marking one character instead

To give **advantage** to a single character rather than the whole world, three routes, all
equivalent — they end at the same actor flag, and all of them stack with the world switch.
(The minimum-die floor is world-wide only; there is no per-actor route for it.)

**1. The compendium item.** Drag **Damage Advantage (Necrotic)** from the *CG Misc - Effects*
compendium onto a character sheet. Its Active Effect transfers to the actor and applies
immediately.

**2. Any effect you like.** Add an Active Effect change to any effect, feat or item:

| Attribute Key | Change Mode | Effect Value |
| --- | --- | --- |
| `flags.cg-misc.damageAdvantage` | Override | `necrotic` |

Several types in one effect: `necrotic,radiant`. Several effects each granting one type also
works — the module unions everything currently applied to the actor. With DAE installed the
key appears in the field browser, and ADD mode unions rather than concatenating.

**3. A hotbar macro**, for switching it on and off mid-combat:

```js
game.modules.get("cg-misc").api.toggle(token?.actor ?? game.user.character);
```

Pass a type to use something other than the configured default:

```js
game.modules.get("cg-misc").api.toggle(token?.actor, "radiant");
```

The macro route creates and removes an Active Effect the module owns, so it replicates to
every client and survives a refresh. It leaves effects from any other source alone.

#### API

`game.modules.get("cg-misc").api.damageAdvantage`

| Method | Returns | Notes |
| --- | --- | --- |
| `toggleGlobal(force?)` | `Promise<boolean\|null>` | Flips the world advantage switch. GM only; `null` if refused. |
| `isGlobal()` | `boolean` | Whether the world advantage switch is on. |
| `toggleMinimum(force?)` | `Promise<boolean\|null>` | Flips the minimum-die switch. GM only. |
| `isMinimum()` | `boolean` | Whether the minimum-die switch is on. |
| `get(actor)` | `string[]` | Every type active for that actor, world switch included. |
| `toggle(actor, type?)` | `Promise<string[]\|null>` | Flips one type on one actor. `null` if it did nothing. |
| `clear(actor)` | `Promise<boolean>` | Removes only the effect this module owns. |
| `key` | `string` | `"flags.cg-misc.damageAdvantage"`. |

`toggleGlobal` and `toggle` are aliased at the top level for brevity in macros. The per-actor
methods accept an `Actor`, `Token` or `TokenDocument`, and require ownership of the actor.

#### Settings

| Setting | Default | |
| --- | --- | --- |
| Enable Damage Advantage | on | Master switch. Off stops the module touching any roll, per-actor effects included. |
| Damage Types | `necrotic` | Which types both enhancements apply to. Comma-separate for several. |
| Apply to Every Actor | off | The advantage switch. Same thing the skull button toggles. |
| Minimum Damage Die | off | The floor switch. Same thing the die button toggles. |
| Minimum Die Value | `3` | The floor under each damage die. 3 means any 1 or 2 counts as a 3. |
| The Dome | off | Spells and short rests roll on the Dome's tables. Same thing the dome button toggles. |
| Debug Logging | off | Logs every roll the module modifies, before and after. |

The master switch outranks both world switches. Turning either on while the master switch is
off warns you rather than failing silently.

### The Dome

While the Dome is up, magic and rest inside it warp. Toggle it with the **dome button in the
token controls**, from **Module Settings → The Dome**, or from a macro:

```js
game.modules.get("cg-misc").api.toggleDome();
```

Raising or lowering it announces to chat, so the table knows the rules just changed.

| Trigger | Table |
| --- | --- |
| A leveled **healing** spell is cast | The Dome: Healing |
| A leveled **necromancy** spell is cast | The Dome: Necromancy |
| Any **other leveled spell** is cast | The Dome: Wild Magic |
| A character finishes a **short rest** | The Dome: Rest Mutation |

**Cantrips are exempt** — a d100 on every Firebolt would bury the chat log. **Every actor is
affected**, monsters included. Short rests roll **once per resting character**, so each one gets
their own mutation. Long rests do nothing.

A spell that is both healing and necromancy — False Life, say — rolls **once**, on the healing
table. Healing is checked first, matching the order the triggers are listed above.

#### Automated effects

Healing and necromancy results **apply themselves**. Of the 80 results across those two tables:

| | Healing | Necromancy |
| --- | --- | --- |
| Cosmetic — text only | 6 | 18 |
| **Automated** | **32** | **19** |
| Text only (see below) | 2 | 3 |

Effects, damage, healing, conditions and exhaustion are applied automatically. Necromancy area
results find every creature in range and damage them through resistances and immunities. Saving
throws are rolled for each target, and only the failures are affected. A healing result lands on
whoever was targeted when the spell was cast, falling back to the caster.

The card reports what was applied underneath the result text, so it's always visible what the
Dome did.

**Five results are text only** — a skipped turn, "the next spell needs no components", "the next
time it would drop to 0 hit points". Foundry has no mechanism for these, so the card states them
and the table applies them.

#### Testing the tables

Waiting for a d100 to land on entry 73 is not a test plan. The **flask button in the token
controls** (GM only) opens a tester listing every face of every table, colour-coded by whether
it is automated, cosmetic, or a rule the table applies by hand. Clicking a face rolls exactly
that result on the selected token.

A forced roll is not a separate code path — it goes through the same function a real spell does,
so what you see under test is what happens at the table.

From a macro or the console:

```js
const api = game.modules.get("cg-misc").api.domeTest;
await api.face("healing", 17);              // roll healing face 17 on the selected token
await api.face("necromancy", 26, { apply: false });  // show it without applying it
await api.report();                         // log a coverage audit of all four tables
```

| Method | |
| --- | --- |
| `open()` | The tester window. |
| `face(trigger, n, {apply, actor})` | Roll one exact face. `apply: false` previews without applying. |
| `audit(trigger)` | Every face with its status, without rolling anything. |
| `report()` | Console table of all four tables and their coverage. |

#### Customising the tables

The four tables ship in the *CG Misc - Tables* compendium, so every server instance rolls on
exactly the same results. To change them without editing the module, duplicate a table into your
world and give it the flag:

| Attribute Key | Value |
| --- | --- |
| `flags.cg-misc.domeTable` | `wild`, `necromancy`, `healing` or `rest` |

A world table carrying that flag takes precedence over the shipped one, and survives module
updates. Rename it however you like — the flag is what's matched, not the name.

#### How it works, and why it is built this way

The feature hooks `dnd5e.postDamageRollConfiguration` and replaces matching rolls in place
with `{<formula>, <formula>}kh`. Three nearby seams look equivalent and are not:

- **`midi-qol.DamageRollComplete`** fires from a single workflow state on the attack path.
  Weapon attacks are caught and saving-throw spell damage is silently skipped.
- **`dnd5e.preRollDamageV2`** runs before `DamageRoll#configureDamage`, which applies
  criticals by walking `roll.terms` and doubling only `DiceTerm` instances. Wrapping the
  formula that early makes the top-level term a `PoolTerm`, the dice inside become invisible
  to that walk, and criticals silently stop doubling. Running after configuration is what
  makes the pool safe — the critical dice are already baked into `roll.formula`.
- **`flags.midi-qol.advantage.damage.*`** is read by nothing in this midi-qol build. An
  effect targeting it is a no-op.

The replacement carries `options.configured = true`. Without it the `DamageRoll` constructor
re-runs `configureDamage`, and because the original's `critical.bonusDamage` terms are now
buried inside the pool they get appended a second time, inflating every crit.

## Development

```bash
npm test
```

The tests drive the real hook against a small set of Foundry stubs in `test/foundry-stubs.mjs`
and cover type matching, flag reading, the critical case and the error path. Dice evaluation
and chat rendering are not stubbed and need checking in a live world.

To rebuild the compendium after editing `packs/_source/`:

```bash
npm run build:packs
```

`classic-level` is borrowed from a local Foundry installation if it is not installed via npm;
pass `--foundry "<path to Foundry's resources/app>"` if it lives somewhere unusual.

## License

MIT
