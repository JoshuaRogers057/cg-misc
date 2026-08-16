import { MODULE_ID, SETTING, TOOL_NAME } from "./constants.mjs";

export function registerSettings() {
  game.settings.register(MODULE_ID, SETTING.DAMAGE_ADVANTAGE_ENABLED, {
    name: "CGM.Settings.DamageAdvantageEnabled.Name",
    hint: "CGM.Settings.DamageAdvantageEnabled.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });

  game.settings.register(MODULE_ID, SETTING.DAMAGE_ADVANTAGE_GLOBAL, {
    name: "CGM.Settings.DamageAdvantageGlobal.Name",
    hint: "CGM.Settings.DamageAdvantageGlobal.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: false,
    onChange: (value) => onGlobalChanged(value)
  });

  game.settings.register(MODULE_ID, SETTING.DAMAGE_ADVANTAGE_TYPES, {
    name: "CGM.Settings.DamageAdvantageTypes.Name",
    hint: "CGM.Settings.DamageAdvantageTypes.Hint",
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

/**
 * A world setting's onChange runs on every connected client, so anything with a side effect
 * outside this client has to be narrowed to exactly one of them. The scene-control refresh is
 * per-client and runs everywhere; the chat announcement is world-visible and is left to the
 * designated GM, so toggling never produces one message per logged-in user.
 */
function onGlobalChanged(value) {
  ui.controls?.render({ toggles: { [TOOL_NAME]: value } });

  if (game.users.activeGM !== game.user) return;

  const types = game.settings.get(MODULE_ID, SETTING.DAMAGE_ADVANTAGE_TYPES);
  const enabled = game.settings.get(MODULE_ID, SETTING.DAMAGE_ADVANTAGE_ENABLED);

  let content = value
    ? `<p><strong>${game.i18n.localize("CGM.DamageAdvantage.AnnounceOn")}</strong></p>`
      + `<p>${game.i18n.format("CGM.DamageAdvantage.AnnounceOnDetail", { types })}</p>`
    : `<p><strong>${game.i18n.localize("CGM.DamageAdvantage.AnnounceOff")}</strong></p>`;

  // Switching the world on while the master switch is off looks broken and is easy to do by
  // accident, so say so in the same breath rather than letting it fail quietly.
  if (value && !enabled) {
    content += `<p><em>${game.i18n.localize("CGM.DamageAdvantage.AnnounceMasterOff")}</em></p>`;
  }

  ChatMessage.create({ content, speaker: { alias: game.i18n.localize("CGM.DamageAdvantage.EffectName") } });
}
