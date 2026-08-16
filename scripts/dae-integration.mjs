import { MODULE_ID, DAMAGE_ADVANTAGE_KEY, debugLog } from "./constants.mjs";

/**
 * Put this module's flag keys in DAE's field browser, so a GM building an effect can pick
 * `flags.cg-misc.damageAdvantage` from the list instead of typing it from memory.
 *
 * The listener is registered at module evaluation time rather than inside our own `init`
 * hook. DAE fires `dae.addAutoFields` from within its init handler, and hook callbacks run in
 * registration order, so registering during init is a race we would sometimes lose. Every
 * module esmodule is evaluated before any init hook fires, which makes top-level registration
 * the only ordering that always holds.
 */
export function registerDaeFields() {
  Hooks.on("dae.addAutoFields", (addAutoFields, fieldTypes) => {
    try {
      const StringField = fieldTypes?.StringField ?? foundry.data.fields.StringField;

      /**
       * A comma-separated list of damage types. Only the ADD-family modes need custom
       * handling: DAE dispatches those to the field, and a plain StringField would
       * concatenate "necrotic" and "radiant" into "necroticradiant". OVERRIDE is untouched
       * and behaves normally.
       */
      class DamageTypeListField extends StringField {
        #union(value, delta) {
          const types = new Set(
            `${value ?? ""},${delta ?? ""}`
              .split(/[,;|]/)
              .map((t) => t.trim().toLowerCase())
              .filter(Boolean)
          );
          return [...types].join(",");
        }

        _applyChangeAdd(value, delta) {
          return this.#union(value, delta);
        }

        _applyChangeUpgrade(value, delta) {
          return this.#union(value, delta);
        }
      }

      addAutoFields([{ name: DAMAGE_ADVANTAGE_KEY, type: DamageTypeListField }]);
      debugLog("registered DAE auto-field", DAMAGE_ADVANTAGE_KEY);
    } catch (err) {
      // Purely a convenience integration - the feature works without DAE knowing the key.
      console.warn(`${MODULE_ID} | Could not register DAE auto-fields`, err);
    }
  });
}
