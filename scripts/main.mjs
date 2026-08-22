import { MODULE_ID, MODULE_TITLE } from "./constants.mjs";
import { registerSettings } from "./settings.mjs";
import { registerDamageAdvantage, damageAdvantageApi } from "./damage-advantage.mjs";
import { registerDaeFields } from "./dae-integration.mjs";
import { registerSceneControls } from "./scene-controls.mjs";
import { registerDome, domeApi } from "./dome.mjs";
import { domeTestApi } from "./dome-test.mjs";

// Registered at evaluation time on purpose - see registerDaeFields for the ordering reason.
registerDaeFields();

Hooks.once("init", () => {
  registerSettings();

  // Roll hooks are registered at init so they are in place for the first roll of the session
  // and are re-registered by the module loader on every page refresh. Nothing here needs a
  // macro to be run by hand.
  registerDamageAdvantage();
  registerDome();
  registerSceneControls();

  const mod = game.modules.get(MODULE_ID);
  mod.api = {
    damageAdvantage: damageAdvantageApi,
    dome: domeApi,
    domeTest: domeTestApi,
    // Shorthands for hotbar macros. The world switches are what get reached for at the table.
    toggleGlobal: damageAdvantageApi.toggleGlobal,
    toggleMinimum: damageAdvantageApi.toggleMinimum,
    toggleDome: domeApi.toggle,
    toggle: damageAdvantageApi.toggle
  };
});

Hooks.once("ready", () => {
  if (game.system.id !== "dnd5e") {
    const message = `${MODULE_TITLE} requires the dnd5e system; found "${game.system.id}". Its features are inactive.`;
    console.error(`${MODULE_ID} | ${message}`);
    if (game.user.isGM) ui.notifications.error(message);
    return;
  }

  console.log(`${MODULE_ID} | Initialized`);
});
