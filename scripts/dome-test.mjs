import { MODULE_ID, DOME } from "./constants.mjs";
import { DOME_EFFECTS } from "./dome-effects.mjs";
import { resolveTable, domeApi } from "./dome.mjs";

/**
 * A GM tool for exercising Dome results one at a time.
 *
 * Waiting for a d100 to land on entry 73 is not a test plan, so this forces a chosen face.
 * `RollTable#roll` rerolls the roll it is handed until a result matches, and rerolling a
 * constant formula returns the same number, so passing `Roll.create("73")` lands on 73 every
 * time without touching the table's own formula.
 *
 * Nothing here is a separate code path: a forced roll goes through exactly the same function
 * that a real spell does, so what you see under test is what happens at the table.
 */

export const STATUS = {
  /** The module applies this result. */
  AUTOMATED: "automated",
  /** Flavour only, deliberately not automated. */
  COSMETIC: "cosmetic",
  /** Real mechanics that Foundry cannot enforce - the card states them, the table applies them. */
  MANUAL: "manual"
};

const ORDER = [DOME.HEALING, DOME.NECROMANCY, DOME.WILD, DOME.REST];

export function statusOf(trigger, result) {
  const id = result.id ?? result._id;
  if (DOME_EFFECTS[trigger]?.[id]) return STATUS.AUTOMATED;
  if (/\(Cosmetic\)/i.test(result.description ?? "")) return STATUS.COSMETIC;
  return STATUS.MANUAL;
}

/**
 * Every face of a table with what it would do, without rolling or applying anything.
 * @returns {Promise<{table: RollTable, rows: object[], counts: object}|null>}
 */
export async function auditTable(trigger) {
  const table = await resolveTable(trigger);
  if (!table) return null;

  const rows = [...table.results]
    .map((r) => ({
      id: r.id ?? r._id,
      face: r.range?.[0] ?? 0,
      range: r.range ?? [0, 0],
      text: r.description || r.name || "",
      status: statusOf(trigger, r)
    }))
    .sort((a, b) => a.face - b.face);

  const counts = rows.reduce((acc, r) => ({ ...acc, [r.status]: (acc[r.status] ?? 0) + 1 }), {});
  return { table, rows, counts };
}

/**
 * Roll one specific face for real: applies the result and posts the card, exactly as a spell
 * would. Uses the selected token, falling back to the user's own character.
 */
export async function testFace(trigger, face, { apply = true, actor } = {}) {
  const subject = actor ?? canvas?.tokens?.controlled?.[0]?.actor ?? game.user?.character ?? null;

  if (!subject) {
    ui.notifications?.warn(game.i18n.localize("CGM.Dome.TestNoActor"));
    return null;
  }

  return domeApi.roll(trigger, {
    actor: subject,
    cause: game.i18n.format("CGM.Dome.TestCause", { face }),
    face,
    apply
  });
}

/** Log an audit of every table to the console, for a fast look at overall coverage. */
export async function report() {
  for (const trigger of ORDER) {
    const audit = await auditTable(trigger);
    if (!audit) continue;
    console.log(`%c${audit.table.name}`, "font-weight:bold", audit.counts);
    console.table(audit.rows.map(({ face, status, text }) => ({ face, status, text: text.slice(0, 90) })));
  }
}

/* -------------------------------------------- */
/*  Interface                                   */
/* -------------------------------------------- */

const SWATCH = {
  [STATUS.AUTOMATED]: "#2e7d32",
  [STATUS.COSMETIC]: "#777",
  [STATUS.MANUAL]: "#b26a00"
};

function renderRows(trigger, rows) {
  return rows
    .map((row) => {
      const span = row.range[0] === row.range[1] ? row.face : `${row.range[0]}-${row.range[1]}`;
      return `<li style="display:flex;gap:.5rem;align-items:flex-start;padding:.25rem 0;border-bottom:1px solid rgba(128,128,128,.25)">
        <button type="button" data-trigger="${trigger}" data-face="${row.face}"
          style="flex:0 0 auto;min-width:3.5rem">${span}</button>
        <span style="flex:0 0 5.5rem;color:${SWATCH[row.status]};font-size:.8em;text-transform:uppercase">${row.status}</span>
        <span style="flex:1">${foundry.utils.escapeHTML(row.text)}</span>
      </li>`;
    })
    .join("");
}

/** The GM-facing tester: pick a table, click a face, watch it resolve on the selected token. */
export async function openTester() {
  const audits = [];
  for (const trigger of ORDER) {
    const audit = await auditTable(trigger);
    if (audit) audits.push({ trigger, ...audit });
  }

  if (!audits.length) {
    ui.notifications?.error(game.i18n.localize("CGM.Dome.TestNoTables"));
    return null;
  }

  const options = audits
    .map((a) => `<option value="${a.trigger}">${a.table.name} (${a.rows.length})</option>`)
    .join("");

  const panels = audits
    .map((a, i) => {
      const summary = Object.entries(a.counts)
        .map(([k, v]) => `<span style="color:${SWATCH[k]}">${v} ${k}</span>`)
        .join(" &middot; ");
      return `<section data-panel="${a.trigger}" style="display:${i ? "none" : "block"}">
        <p style="margin:.25rem 0 .5rem">${summary}</p>
        <ol style="list-style:none;margin:0;padding:0;max-height:26rem;overflow-y:auto">${renderRows(a.trigger, a.rows)}</ol>
      </section>`;
    })
    .join("");

  const content = `<div class="cg-misc-dome-tester">
    <p>${game.i18n.localize("CGM.Dome.TestHint")}</p>
    <select data-table-select style="width:100%;margin-bottom:.5rem">${options}</select>
    ${panels}
  </div>`;

  const dialog = new foundry.applications.api.DialogV2({
    window: { title: game.i18n.localize("CGM.Dome.TestTitle"), icon: "fa-solid fa-circle-half-stroke" },
    position: { width: 720 },
    content,
    buttons: [{ action: "close", label: game.i18n.localize("Close"), default: true }]
  });

  await dialog.render({ force: true });

  const root = dialog.element;

  root.querySelector("[data-table-select]")?.addEventListener("change", (event) => {
    for (const panel of root.querySelectorAll("[data-panel]")) {
      panel.style.display = panel.dataset.panel === event.target.value ? "block" : "none";
    }
  });

  // Delegated so that all 230 rows cost one listener rather than 230.
  root.addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-face]");
    if (!button) return;
    event.preventDefault();

    button.disabled = true;
    try {
      await testFace(button.dataset.trigger, Number(button.dataset.face));
    } catch (err) {
      console.error(`${MODULE_ID} | Dome test failed`, err);
      ui.notifications?.error(game.i18n.format("CGM.Dome.TestFailed", { face: button.dataset.face }));
    } finally {
      button.disabled = false;
    }
  });

  return dialog;
}

export const domeTestApi = { open: openTester, face: testFace, audit: auditTable, report, statusOf, STATUS };
