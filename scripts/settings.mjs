import { MODULE_ID, SETTING, TOOL } from "./constants.mjs";

export function registerSettings() {
  game.settings.register(MODULE_ID, SETTING.DAMAGE_ADVANTAGE_ENABLED, {
    name: "CGM.Settings.DamageAdvantageEnabled.Name",
    hint: "CGM.Settings.DamageAdvantageEnabled.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });

  game.settings.register(MODULE_ID, SETTING.DAMAGE_ADVANTAGE_TYPES, {
    name: "CGM.Settings.DamageAdvantageTypes.Name",
    hint: "CGM.Settings.DamageAdvantageTypes.Hint",
    scope: "world",
    config: true,
    type: String,
    default: "necrotic"
  });

  game.settings.register(MODULE_ID, SETTING.DAMAGE_ADVANTAGE_GLOBAL, {
    name: "CGM.Settings.DamageAdvantageGlobal.Name",
    hint: "CGM.Settings.DamageAdvantageGlobal.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: false,
    onChange: (value) => onSwitchChanged(TOOL.ADVANTAGE, value)
  });

  game.settings.register(MODULE_ID, SETTING.DAMAGE_MINIMUM, {
    name: "CGM.Settings.DamageMinimum.Name",
    hint: "CGM.Settings.DamageMinimum.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: false,
    onChange: (value) => onSwitchChanged(TOOL.MINIMUM, value)
  });

  game.settings.register(MODULE_ID, SETTING.DAMAGE_MINIMUM_VALUE, {
    name: "CGM.Settings.DamageMinimumValue.Name",
    hint: "CGM.Settings.DamageMinimumValue.Hint",
    scope: "world",
    config: true,
    type: Number,
    default: 3,
    range: { min: 2, max: 10, step: 1 }
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

/**
 * A world setting's onChange runs on every connected client, so anything with a side effect
 * outside this client has to be narrowed to exactly one of them. The scene-control refresh is
 * per-client and runs everywhere; the chat announcement is world-visible and is left to the
 * designated GM, so toggling never produces one message per logged-in user.
 */
function onSwitchChanged(tool, value) {
  ui.controls?.render({ toggles: { [tool]: value } });

  if (game.users.activeGM !== game.user) return;

  const types = game.settings.get(MODULE_ID, SETTING.DAMAGE_ADVANTAGE_TYPES);
  const minimum = game.settings.get(MODULE_ID, SETTING.DAMAGE_MINIMUM_VALUE);
  const advantage = tool === TOOL.ADVANTAGE;

  const heading = game.i18n.localize(
    advantage
      ? value ? "CGM.DamageAdvantage.AnnounceOn" : "CGM.DamageAdvantage.AnnounceOff"
      : value ? "CGM.DamageMinimum.AnnounceOn" : "CGM.DamageMinimum.AnnounceOff"
  );

  let content = `<p><strong>${heading}</strong></p>`;
  if (value) {
    content += `<p>${
      advantage
        ? game.i18n.format("CGM.DamageAdvantage.AnnounceOnDetail", { types })
        : game.i18n.format("CGM.DamageMinimum.AnnounceOnDetail", { types, minimum, below: minimum - 1 })
    }</p>`;
  }

  // Switching an enhancement on while the master switch is off looks broken and is easy to do
  // by accident, so say so in the same breath rather than letting it fail quietly.
  if (value && !game.settings.get(MODULE_ID, SETTING.DAMAGE_ADVANTAGE_ENABLED)) {
    content += `<p><em>${game.i18n.localize("CGM.DamageAdvantage.AnnounceMasterOff")}</em></p>`;
  }

  ChatMessage.create({ content, speaker: { alias: game.i18n.localize("CGM.DamageAdvantage.EffectName") } });
}
