import { getTrackedIframe } from "./helpers/getTrackedIframe.js";
import { getTranspiledModules } from "./helpers/getTranspiledModules.js";
import { initializeFinalizationRegistry } from "./helpers/initializeFinalizationRegistry.js";
import { updateRunStatus } from "./helpers/updateRunStatus.js";
import { updateScenarioDescription } from "./helpers/updateScenarioDescription.js";
import { updateSolutionDescription } from "./helpers/updateSolutionDescription.js";

//////////////////////
// Initialize State //
//////////////////////

let runCount = 0;
// We have to store the finalizationRegistry as a global so it doesn't get GC'd unless we want it to.
window.finalizationRegistry = initializeFinalizationRegistry();

// The HTML form controls are the "source of truth" for our app's state.
const scenarioDropdown = /** @type {HTMLSelectElement} */ (document.getElementById("scenario"));
const solutionDropdown = /** @type {HTMLSelectElement} */ (document.getElementById("solution"));
const validScenarios = new Set(Array.from(scenarioDropdown.options).map((option) => option.value));
const validSolutions = new Set(Array.from(solutionDropdown.options).map((option) => option.value));
const continuousGcCheckbox = /** @type {HTMLInputElement} */ (document.getElementById("enable-continuous-garbage-collection"));
const applyMembraneCheckbox = /** @type {HTMLInputElement} */ (document.getElementById("apply-membrane-checkbox"));

// Set the initial state from the url, if possible.
function trySetStateFromQuery() {
  const searchParams = new URLSearchParams(window.location.search);
  const scenarioId = searchParams.get("scenario");
  scenarioDropdown.value = validScenarios.has(scenarioId) ? scenarioId : scenarioDropdown.options[0].value;
  const solutionId = searchParams.get("solution");
  solutionDropdown.value = validSolutions.has(solutionId) ? solutionId : solutionDropdown.options[0].value;
  const applyMembrane = searchParams.get("applyMembrane");
  applyMembraneCheckbox.checked = applyMembrane?.toLowerCase() === "true" ? true : false;
  // TODO: maybe we should refactor the way we're storing state to avoid duplicating this code with the applyMembraneCheckbox.onchange handler.
  if (applyMembraneCheckbox.checked) {
    document.getElementById("collect-garbage").textContent = "Revoke Membrane and Collect Garbage";
  } else {
    document.getElementById("collect-garbage").textContent = "Collect Garbage";
  }
}
trySetStateFromQuery();
updateScenarioDescription(scenarioDropdown.value);
updateSolutionDescription(solutionDropdown.value);

// Changes to the controls where the state is stored should be reflected in the url and the app UI (and vice versa).
scenarioDropdown.onchange = () => {
  const url = new URL(window.location.href);
  url.searchParams.set("scenario", scenarioDropdown.value);
  history.pushState({}, "", url);
  updateScenarioDescription(scenarioDropdown.value);
  resetRuns();
  updateUsedJsHeapSize();
};

solutionDropdown.onchange = () => {
  const url = new URL(window.location.href);
  url.searchParams.set("solution", solutionDropdown.value);
  history.pushState({}, "", url);
  updateSolutionDescription(solutionDropdown.value);
  resetRuns();
  updateUsedJsHeapSize();
};

applyMembraneCheckbox.onchange = () => {
  const url = new URL(window.location.href);
  url.searchParams.set("applyMembrane", applyMembraneCheckbox.checked.toString());
  history.pushState({}, "", url);
  if (applyMembraneCheckbox.checked) {
    document.getElementById("collect-garbage").textContent = "Revoke Membrane and Collect Garbage";
  } else {
    document.getElementById("collect-garbage").textContent = "Collect Garbage";
  }
};

window.addEventListener("popstate", () => {
  trySetStateFromQuery();
  updateScenarioDescription(scenarioDropdown.value);
  updateSolutionDescription(solutionDropdown.value);
  resetRuns();
  updateUsedJsHeapSize();
});

// Display javascript heap size, if possible, and keep it up-to-date.
async function updateUsedJsHeapSize() {
  if (continuousGcCheckbox.checked) {
    await window.gc?.({ execution: "async" });
  }
  try {
    const heapSize = (performance.memory.usedJSHeapSize / Math.pow(1000, 2)).toFixed(2);
    document.getElementById("heap-size-display").textContent = heapSize;
  } catch (e) {
    document.getElementById("heap-size-display").textContent = "###";
  }
}
setInterval(updateUsedJsHeapSize, 250);

// We want to continuously garbage collect by default, if possible.
if (window.gc) {
  continuousGcCheckbox.checked = true;
} else {
  continuousGcCheckbox.disabled = true;
}

// Pre-transpile and import all the 'solution' scripts so they are available when needed.
const solutionModules = getTranspiledModules(Array.from(validSolutions).map((solutionId) => `../solutions/${solutionId}/index.ts`)); // these URLs are relative to the web worker that will eventually use them (transpiler-worker.js).

///////////////////////////
// Set up Click Handlers //
///////////////////////////

const membraneRevokeFns = new Set();

document.getElementById("run-scenario").onclick = async () => {
  const scenarioModule = await import(`./scenarios/${scenarioDropdown.value}/index.js`);
  let iframe = await getTrackedIframe(`./scenarios/${scenarioDropdown.value}/iframe.js`, ++runCount, window.finalizationRegistry);
  if (applyMembraneCheckbox.checked) {
    console.log(`Applying membrane solution ${solutionDropdown.value}...`);
    const solutionModule = await solutionModules[`../solutions/${solutionDropdown.value}/index.ts`];
    const { membrane, revoke } = solutionModule.createMembrane(iframe);
    iframe = membrane;
    membraneRevokeFns.add(revoke);
  }
  console.log(`Running scenario ${scenarioDropdown.value} - ${runCount}...`);
  await scenarioModule.runScenario(iframe);
};

document.getElementById("remove-iframes").onclick = () => {
  for (let i = 1; i <= runCount; i++) {
    const iframeContainer = document.getElementById(`iframe-container-${i}`);
    if (iframeContainer.hasChildNodes()) {
      iframeContainer.textContent = "";
      updateRunStatus(i, "Removed but not GCd", "Removed but not GCd");
    }
  }
  console.log("All iframes removed.");
};

function resetRuns() {
  runCount = 0;
  document.getElementById("all-runs-container").textContent = "";
  window.finalizationRegistry = initializeFinalizationRegistry();
  console.log("Scenario tests reset.");
}
document.getElementById("reset-runs").onclick = resetRuns;

const gcFlagsModal = new bootstrap.Modal(document.getElementById("gc-flags-modal"));

document.getElementById("collect-garbage").onclick = async () => {
  if (applyMembraneCheckbox.checked) {
    console.log(`Revoking ${membraneRevokeFns.size} membranes...`);
    membraneRevokeFns.forEach((revoke) => revoke());
    membraneRevokeFns.clear();
  }
  if (window.gc) {
    await window.gc?.({ execution: "async" });
    console.log("Garbage collection finished.");
  } else {
    gcFlagsModal.show();
    console.warn("Unable to trigger garbage collection - please run with --expose-gc flag.");
  }
};

document.getElementById("enable-continuous-garbage-collection-info-button").onclick = () => {
  gcFlagsModal.show();
};
