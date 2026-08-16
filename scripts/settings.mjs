import { MODULE_ID, SETTING } from "./constants.mjs";

export function registerSettings() {
  game.settings.register(MODULE_ID, SETTING.DAMAGE_ADVANTAGE_ENABLED, {
    name: "CGM.Settings.DamageAdvantageEnabled.Name",
    hint: "CGM.Settings.DamageAdvantageEnabled.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });

  game.settings.register(MODULE_ID, SETTING.DAMAGE_ADVANTAGE_DEFAULT_TYPE, {
    name: "CGM.Settings.DamageAdvantageDefaultType.Name",
    hint: "CGM.Settings.DamageAdvantageDefaultType.Hint",
    scope: "world",
    config: true,
    type: String,
    default: "necrotic"
  });

  game.settings.register(MODULE_ID, SETTING.DEBUG, {
    name: "CGM.Settings.Debug.Name",
    hint: "CGM.Settings.Debug.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: false
  });
}
