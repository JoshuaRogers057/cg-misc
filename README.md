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

#### The world switch (the usual way)

Click the **skull button in the token controls**. While it's lit, *every* actor in the world —
player characters, NPCs and monsters alike — gets the doubled roll on the configured damage
types. Nothing needs adding to anyone. Click it again to turn it off.

Toggling either way posts a message to chat, so the whole table knows the rule is live. The
same switch is in **Module Settings → Apply to Every Actor**, and from a macro:

```js
game.modules.get("cg-misc").api.toggleGlobal();
```

Which damage types it covers is **Module Settings → Damage Types** (default `necrotic`;
comma-separate for several). GM only — the button is hidden from players.

#### Marking one character instead

If you want it on a single character rather than the whole world, three routes, all equivalent
— they end at the same actor flag, and all of them stack with the world switch.

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
| `toggleGlobal(force?)` | `Promise<boolean\|null>` | Flips the world switch. GM only; `null` if refused. |
| `isGlobal()` | `boolean` | Whether the world switch is on. |
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
| Apply to Every Actor | off | The world switch. Same thing the skull button toggles. |
| Damage Types | `necrotic` | Which types get the doubled roll. Comma-separate for several. |
| Debug Logging | off | Logs every roll the module modifies. |

The master switch outranks the world switch. Turning the world switch on while the master
switch is off warns you rather than failing silently.

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
