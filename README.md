# Champions Guild Misc

A grab bag of small dnd5e automations for the Champions Guild table. Each feature is
self-contained and can be turned off from the module settings without disabling the module.

- **Foundry VTT** v13 (verified 13.351)
- **dnd5e** 5.3.x
- No dependency on midi-qol, DAE or socketlib. DAE is used if present, for its field browser.

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
| Debug Logging | off | Logs every roll the module modifies, before and after. |

The master switch outranks both world switches. Turning either on while the master switch is
off warns you rather than failing silently.

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
