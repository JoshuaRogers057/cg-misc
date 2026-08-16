# Champions Guild Misc

A grab bag of small dnd5e automations for the Champions Guild table. Each feature is
self-contained and can be turned off from the module settings without disabling the module.

- **Foundry VTT** v13 (verified 13.351)
- **dnd5e** 5.3.x
- No dependency on midi-qol, DAE or socketlib. DAE is used if present, for its field browser.

## Features

### Damage advantage

While a character is marked, **every damage roll they make of a given damage type is rolled
twice and the higher total is kept**. It is the 2024 Savage Attacker mechanic, keyed to a
damage type rather than to weapons, and with no once-per-turn limit.

It applies to weapon attacks, spell attacks and saving-throw spells alike, and a character can
hold advantage on several damage types at once. The default type is necrotic.

The chat card shows the doubled formula, e.g. `{2d6 + 3, 2d6 + 3}kh`.

#### Marking a character

Three routes, all equivalent — they all end at the same actor flag.

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
| `get(actor)` | `string[]` | Every type currently active, from all sources. |
| `toggle(actor, type?)` | `Promise<string[]\|null>` | Flips one type. `null` if it did nothing. |
| `clear(actor)` | `Promise<boolean>` | Removes only the effect this module owns. |
| `key` | `string` | `"flags.cg-misc.damageAdvantage"`. |

`api.toggle` is aliased at the top level for brevity in macros. All three accept an `Actor`,
`Token` or `TokenDocument`, and require ownership of the actor.

#### Settings

| Setting | Default | |
| --- | --- | --- |
| Enable Damage Advantage | on | Turns the feature off without disabling the module. |
| Default Damage Type | `necrotic` | Used when `toggle` is called without a type. |
| Debug Logging | off | Logs every roll the module modifies. |

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
