import { MODULE_ID, SETTING, TOOL, debugLog } from "./constants.mjs";

/**
 * Toggles in the token controls for the two world switches, so they can be flipped mid-combat
 * without opening settings - and, just as importantly, so their state is visible at a glance.
 * A world rule that is silent when on and silent when off is one nobody can trust.
 *
 * Shaped after core's own Notes toggle (client/canvas/layers/notes.mjs): `toggle: true` with
 * `active` read from the setting, and an onChange that writes it straight back. Each setting's
 * own onChange is what refreshes these buttons, which covers the switch being flipped from the
 * settings menu, from a macro, or by another GM.
 */
const TOGGLES = [
  {
    name: TOOL.ADVANTAGE,
    title: "CGM.DamageAdvantage.ToolTitle",
    icon: "fa-solid fa-skull",
    setting: SETTING.DAMAGE_ADVANTAGE_GLOBAL
  },
  {
    name: TOOL.MINIMUM,
    title: "CGM.DamageMinimum.ToolTitle",
    icon: "fa-solid fa-dice-d6",
    setting: SETTING.DAMAGE_MINIMUM
  }
];

export function registerSceneControls() {
  Hooks.on("getSceneControlButtons", (controls) => {
    try {
      const tokens = controls.tokens;
      if (!tokens?.tools) return;

      for (const { name, title, icon, setting } of TOGGLES) {
        tokens.tools[name] = {
          name,
          title,
          icon,
          toggle: true,
          // Writing a world setting is GM-only, so a player toggle would only ever error.
          visible: game.user.isGM,
          active: game.settings.get(MODULE_ID, setting),
          order: Object.keys(tokens.tools).length,
          onChange: (event, toggled) => game.settings.set(MODULE_ID, setting, toggled)
        };
      }

      debugLog("registered scene control toggles");
    } catch (err) {
      // Losing the buttons is a nuisance; taking the whole toolbar down with them is not.
      console.error(`${MODULE_ID} | Could not add the scene control toggles`, err);
    }
  });
}
