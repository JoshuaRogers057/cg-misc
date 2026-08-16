import { MODULE_ID, SETTING, TOOL_NAME, debugLog } from "./constants.mjs";

/**
 * A toggle in the token controls for the world-wide switch, so it can be flipped mid-combat
 * without opening settings - and, just as importantly, so its state is visible at a glance.
 * A world rule that is silent when on and silent when off is one nobody can trust.
 *
 * Shaped after core's own Notes toggle (client/canvas/layers/notes.mjs): `toggle: true` with
 * `active` read from the setting, and an onChange that writes it straight back. The setting's
 * own onChange is what refreshes this button, which covers the cases where the switch is
 * flipped from the settings menu, from a macro, or by another GM.
 */
export function registerSceneControls() {
  Hooks.on("getSceneControlButtons", (controls) => {
    try {
      const tokens = controls.tokens;
      if (!tokens?.tools) return;

      tokens.tools[TOOL_NAME] = {
        name: TOOL_NAME,
        title: "CGM.DamageAdvantage.ToolTitle",
        icon: "fa-solid fa-skull",
        toggle: true,
        // Writing a world setting is GM-only, so a player toggle would only ever error.
        visible: game.user.isGM,
        active: game.settings.get(MODULE_ID, SETTING.DAMAGE_ADVANTAGE_GLOBAL),
        order: Object.keys(tokens.tools).length,
        onChange: (event, toggled) => game.settings.set(MODULE_ID, SETTING.DAMAGE_ADVANTAGE_GLOBAL, toggled)
      };

      debugLog("registered scene control toggle");
    } catch (err) {
      // Losing the button is a nuisance; taking the whole toolbar down with it is not.
      console.error(`${MODULE_ID} | Could not add the scene control toggle`, err);
    }
  });
}
