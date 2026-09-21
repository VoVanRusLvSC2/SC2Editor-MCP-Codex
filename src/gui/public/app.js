/* global document, fetch, clearTimeout, setTimeout, URLSearchParams, Option */

const state = {
  files: [],
  layout: null,
  selected: null,
  type: null,
  output: { activity: "SC2 UI Workbench is ready.", validation: "No validation run yet.", diff: "No staged diff loaded." },
  outputView: "activity",
  propertySchema: null,
  stateSchema: { conditions: [], actions: [] },
  animationSchema: { controllerTypes: [] },
  stateDraft: [],
  controllerDraft: [],
  browseResults: [],
  selectedBrowse: null,
  placementPlanId: null,
  aiReviewed: null,
  terrainPlanId: null,
  terrainTransactionId: null,
  terrainDoodadPlanId: null,
};

const $ = (id) => document.getElementById(id);

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: options.body ? { "content-type": "application/json", ...(options.headers || {}) } : options.headers,
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
  return body;
}

function encode(value) {
  return encodeURIComponent(value);
}

function showToast(message, error = false) {
  const toast = $("toast");
  toast.textContent = message;
  toast.style.borderColor = error ? "#773848" : "#315e7b";
  toast.classList.remove("hidden");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.add("hidden"), 3200);
}

function setOutput(kind, value, tone = "") {
  state.output[kind] = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  state.outputView = kind;
  document.querySelectorAll(".output-tab").forEach((button) => button.classList.toggle("active", button.dataset.output === kind));
  const output = $("output");
  output.textContent = state.output[kind];
  output.className = `output ${tone}`.trim();
}

function setEditorsEnabled(enabled) {
  ["propertyName", "propertyValue", "setPropertyButton", "anchorSide", "anchorPos", "anchorRelative", "anchorOffset",
    "setAnchorButton", "childName", "childType", "childTemplate", "createChildButton", "stateGroupName", "stateDefault",
    "stateName", "stateWhenType", "stateWhenFrame", "stateActionType", "stateActionFrame", "stateActionAttrs",
    "stateWhenAttrs",
    "addStateButton", "clearStatesButton", "stageStateGroupButton", "animationName", "animationSpeed", "controllerType",
    "controllerFrame", "controllerDuration", "controllerFrom", "controllerTo", "controllerAttrs", "addControllerButton",
    "controllerEnd", "animationOnShown", "clearControllersButton", "stageAnimationButton"]
    .forEach((id) => { $(id).disabled = !enabled; });
}

function createTextElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  element.textContent = text;
  return element;
}

function editableElement(element) {
  return {
    tag: element.tag,
    attrs: { ...element.attrs },
    children: (element.children || []).map(editableElement),
  };
}

function renderFiles() {
  const list = $("fileList");
  const needle = $("fileSearch").value.trim().toLowerCase();
  const files = state.files.filter((file) => file.toLowerCase().includes(needle));
  list.replaceChildren();
  list.classList.toggle("empty-state", !files.length);
  if (!files.length) {
    list.textContent = "No matching layout files.";
    return;
  }
  for (const file of files) {
    const button = createTextElement("button", `file-item${state.layout?.file === file ? " active" : ""}`, file);
    button.addEventListener("click", () => loadLayout(file));
    list.append(button);
  }
}

function renderFrames() {
  const list = $("frameList");
  const needle = $("frameSearch").value.trim().toLowerCase();
  const frames = (state.layout?.frames || []).filter((frame) =>
    [frame.name, frame.type, frame.path, frame.template].some((value) => value?.toLowerCase().includes(needle)));
  list.replaceChildren();
  list.classList.toggle("empty-state", !frames.length);
  if (!frames.length) {
    list.textContent = state.layout ? "No matching frames." : "Choose a file on the left.";
    return;
  }
  for (const frame of frames) {
    const button = document.createElement("button");
    button.className = `frame-item${state.selected?.frame.path === frame.path ? " active" : ""}`;
    button.style.paddingLeft = `${10 + Math.min(frame.path.split("/").length - 1, 8) * 14}px`;
    const identity = document.createElement("span");
    identity.append(createTextElement("span", "frame-title", frame.name));
    identity.append(createTextElement("span", "frame-path", frame.path));
    button.append(identity, createTextElement("span", "frame-type", frame.type));
    button.addEventListener("click", () => loadFrame(frame.path));
    list.append(button);
  }
}

function renderInspector() {
  const data = state.selected;
  if (!data) {
    $("selectedFrameName").textContent = "No frame selected";
    $("selectedFrameType").textContent = "—";
    $("frameSummary").textContent = "Select a frame to inspect its schema and edit it.";
    $("runtimeNotice").classList.add("hidden");
    setEditorsEnabled(false);
    return;
  }
  const frame = data.frame;
  const type = data.type;
  $("selectedFrameName").textContent = frame.name;
  $("selectedFrameType").textContent = frame.type;
  const notice = $("runtimeNotice");
  if (data.restrictionPlan?.runtimeExpectation === "may-not-work") {
    notice.textContent = data.restrictionPlan.runtimeNotice;
    notice.classList.remove("hidden");
  } else notice.classList.add("hidden");

  const summary = $("frameSummary");
  summary.className = "summary";
  summary.replaceChildren();
  const dl = document.createElement("dl");
  dl.className = "summary-grid";
  const rows = [
    ["Path", frame.path],
    ["Template", frame.template || "—"],
    ["Class", type?.classType || "Observed only"],
    ["Inheritance", type?.inheritance?.join(" → ") || "—"],
    ["Children", String(frame.childPaths?.length ?? 0)],
  ];
  for (const [label, value] of rows) {
    dl.append(createTextElement("dt", "", label), createTextElement("dd", "", value));
  }
  summary.append(dl);
  const chips = document.createElement("div");
  chips.className = "property-chips";
  for (const property of Object.keys(frame.properties || {}).slice(0, 18)) chips.append(createTextElement("span", "chip", property));
  if (Object.keys(frame.properties || {}).length > 18) chips.append(createTextElement("span", "chip", `+${Object.keys(frame.properties).length - 18}`));
  summary.append(chips);

  const propertySelect = $("propertyName");
  propertySelect.replaceChildren();
  for (const property of type?.properties || []) {
    const option = document.createElement("option");
    option.value = property.name;
    option.textContent = `${property.name}${property.valueType ? ` · ${property.valueType}` : ""}`;
    option.dataset.valueType = property.valueType || "";
    option.dataset.elementType = property.elementType || "";
    option.dataset.table = String(Boolean(property.table));
    propertySelect.append(option);
  }
  setEditorsEnabled(true);
  updatePropertyType().catch(handleError);
}

async function updatePropertyType() {
  const option = $("propertyName").selectedOptions[0];
  if (!option || !state.selected) return;
  state.propertySchema = await api(`/api/property/schema?type=${encode(state.selected.frame.type)}&property=${encode(option.value)}`);
  const compound = Boolean(state.propertySchema.complexType || state.propertySchema.table);
  $("propertyType").textContent = [state.propertySchema.valueType, state.propertySchema.elementType, state.propertySchema.table ? "table" : ""]
    .filter(Boolean).join(" · ") || "observed";
  $("scalarPropertyEditor").classList.toggle("hidden", compound);
  $("compoundPropertyEditor").classList.toggle("hidden", !compound);
  const current = state.selected?.frame.properties?.[$("propertyName").value];
  if (typeof current === "string") $("propertyValue").value = current;
  else if (current?.val !== undefined) $("propertyValue").value = current.val;
  else $("propertyValue").value = "";
  const element = state.selected.frame.elements.find((item) => item.tag.toLowerCase() === option.value.toLowerCase());
  const row = element?.attrs ?? (Array.isArray(current) ? current[0] : current);
  const attrs = row && typeof row === "object" ? { ...row } : {};
  delete attrs.index;
  delete attrs.layer;
  $("propertyAttrs").value = JSON.stringify(attrs, null, 2);
  $("propertyIndex").value = row?.index ?? "";
  $("propertyLayer").value = row?.layer ?? "";
  $("propertyChildren").value = JSON.stringify((element?.children || []).map(editableElement), null, 2);
}

function parseEditorValue(text, type) {
  if (/^(Boolean|Bool)$/i.test(type)) {
    if (/^(true|1)$/i.test(text)) return true;
    if (/^(false|0)$/i.test(text)) return false;
  }
  if (/^(?:U?int\d*|Real32|Number)$/i.test(type) && text.trim() !== "" && Number.isFinite(Number(text))) return Number(text);
  return text;
}

async function loadHealth() {
  const [health, capabilities] = await Promise.all([api("/api/health"), api("/api/capabilities")]);
  $("workspacePath").textContent = health.workspace;
  $("coverageBadge").textContent = `${health.frameTypes} types · ${health.properties} properties`;
  $("runtimeBadge").textContent = capabilities.runtime.actualGameValidation ? "runtime adapter" : "structural only";
  $("runtimeBadge").classList.toggle("warning", !capabilities.runtime.actualGameValidation);
  $("runtimeBadge").title = [capabilities.runtime.limitation, capabilities.archives.limitation].filter(Boolean).join(" ");
}

async function loadFiles(selectFirst = false) {
  const result = await api("/api/files");
  state.files = result.layouts;
  renderFiles();
  if (selectFirst && !state.layout && state.files.length) await loadLayout(state.files[0]);
}

async function loadLayout(file, preserveSelection = false) {
  const layout = await api(`/api/layout?file=${encode(file)}`);
  state.layout = layout;
  $("currentFile").textContent = file;
  $("draftBadge").classList.toggle("hidden", !layout.staged);
  $("sourceCode").textContent = layout.source;
  $("attachContainerButton").disabled = false;
  if (!preserveSelection) state.selected = null;
  renderFiles();
  renderFrames();
  renderInspector();
}

async function loadFrame(framePath) {
  if (!state.layout) return;
  state.selected = await api(`/api/frame?file=${encode(state.layout.file)}&path=${encode(framePath)}`);
  renderFrames();
  renderInspector();
}

function parseJson(text, expected, label) {
  let value;
  try { value = JSON.parse(text || (expected === "array" ? "[]" : "{}")); }
  catch (error) { throw new Error(`${label}: ${error.message}`, { cause: error }); }
  if (expected === "array" && !Array.isArray(value)) throw new Error(`${label} must be a JSON array`);
  if (expected === "object" && (!value || typeof value !== "object" || Array.isArray(value))) throw new Error(`${label} must be a JSON object`);
  return value;
}

function renderBuilderDrafts() {
  $("stateCount").textContent = `${state.stateDraft.length} states`;
  $("stateDraftList").textContent = state.stateDraft.length
    ? state.stateDraft.map((item) => `${item.name}: ${item.when?.[0]?.type || "always"} → ${item.actions?.[0]?.type || "none"}`).join("\n")
    : "No states added.";
  $("controllerCount").textContent = `${state.controllerDraft.length} controllers`;
  $("controllerDraftList").textContent = state.controllerDraft.length
    ? state.controllerDraft.map((item) => `${item.type} · ${item.frame || "$this"} · ${item.keys?.at(-1)?.time ?? 0}s`).join("\n")
    : "No controllers added.";
}

function switchMode(mode) {
  for (const [name, panel, button] of [["ui", "uiWorkspace", "uiModeButton"], ["browse", "browsePlacementWorkspace", "browseModeButton"], ["ai", "aiWorkspace", "aiModeButton"], ["terrain", "terrainWorkspace", "terrainModeButton"]]) {
    $(panel).classList.toggle("hidden", mode !== name);
    $(button).classList.toggle("active", mode === name);
  }
  ["validateButton", "diffButton", "discardButton", "saveButton"].forEach((id) => $(id).classList.toggle("hidden", mode !== "ui"));
}

async function terrainPreview() {
  const query = new URLSearchParams({ directory: $("terrainDirectory").value, mode: $("terrainPreviewMode").value });
  if (state.terrainPlanId) query.set("planId", state.terrainPlanId);
  const preview = await api(`/api/terrain/preview?${query}`);
  $("terrainPreviewImage").src = `data:image/png;base64,${preview.imageBase64}`;
  $("terrainPreviewImage").classList.remove("hidden");
}
function bindTerrainEvents() {
  $("terrainAction").addEventListener("change", () => $("terrainWaterControls").classList.toggle("hidden", !$("terrainAction").value.startsWith("water.")));
  $("terrainWaterAlign").addEventListener("click", () => {
    for(const id of ["terrainMinX","terrainMinY"]) $(id).value = Math.ceil(Number($(id).value)/8)*8;
    for(const id of ["terrainMaxX","terrainMaxY"]) $(id).value = Math.floor(Number($(id).value)/8)*8;
  });
  $("terrainDoodadPlanButton").addEventListener("click", async () => { try {
    if (state.terrainTransactionId) throw new Error("Save or discard Terrain changes before planning Doodads.");
    state.terrainDoodadPlanId = null; $("terrainDoodadApplyButton").disabled = true;
    state.terrainPlanId = null; $("terrainStageButton").disabled = true;
    const ids = $("terrainDoodadIds").value.split(",").map(id => id.trim()).filter(Boolean);
    if (!ids.length) throw new Error("Enter real Doodad IDs from Browse.");
    const area = {type:"rectangle",minX:Number($("terrainMinX").value),minY:Number($("terrainMinY").value),maxX:Number($("terrainMaxX").value),maxY:Number($("terrainMaxY").value),z:0};
    const result = await api("/api/placement/scatterDoodads",{method:"POST",body:JSON.stringify({terrainDirectory:$("terrainDirectory").value,area,objects:ids.map(id=>({id})),count:Number($("terrainDoodadCount").value),seed:Number($("terrainSeed").value),minimumDistance:Number($("terrainDoodadDistance").value),maxSlope:Number($("terrainDoodadSlope").value)})});
    state.terrainDoodadPlanId = result.plan.id; $("terrainOutput").textContent = JSON.stringify(result,null,2); $("terrainDoodadApplyButton").disabled = !result.preview.validation.valid;
  } catch (error) { handleError(error); } });
  $("terrainDoodadApplyButton").addEventListener("click", async () => { try {
    if (state.terrainTransactionId) throw new Error("Save or discard Terrain changes before applying Doodads.");
    const result = await api("/api/placement/apply",{method:"POST",body:JSON.stringify({planId:state.terrainDoodadPlanId,dryRun:false,stage:false,backup:true})});
    $("terrainOutput").textContent = JSON.stringify(result,null,2);
    if (result.accepted) { state.terrainDoodadPlanId = null; $("terrainDoodadApplyButton").disabled = true; showToast("Doodads applied with backup"); }
  } catch (error) { handleError(error); } });
  $("terrainInspectButton").addEventListener("click", async () => { try {
    state.terrainPlanId = null;
    $("terrainStageButton").disabled = true;
    state.terrainDoodadPlanId = null; $("terrainDoodadApplyButton").disabled = true;
    const map = await api(`/api/terrain/inspect?${new URLSearchParams({directory: $("terrainDirectory").value})}`);
    $("terrainOutput").textContent = JSON.stringify(map, null, 2);
    $("terrainTexture").replaceChildren(new Option("Automatic style match", ""));
    for (const texture of map.textures || []) if (texture.id) $("terrainTexture").append(new Option(texture.id, texture.id));
    $("terrainWaterNames").replaceChildren();
    for(const id of new Set([...(map.water?.entries || []).map(w => w.template),...(map.waterMaterials || []).map(w => w.id)])) {
      const option = document.createElement("option"); option.value = id; $("terrainWaterNames").append(option);
    }
    if (map.error) throw new Error(map.error);
    await terrainPreview();
  } catch (error) { handleError(error); } });
  $("terrainPlanButton").addEventListener("click", async () => { try {
    if (state.terrainTransactionId) throw new Error("Save or discard staged changes before creating another plan.");
    state.terrainDoodadPlanId = null; $("terrainDoodadApplyButton").disabled = true;
    const n = id => Number($(id).value);
    const area = {type:"rectangle",minX:n("terrainMinX"),minY:n("terrainMinY"),maxX:n("terrainMaxX"),maxY:n("terrainMaxY")};
    const directory = $("terrainDirectory").value, action = $("terrainAction").value, texture = $("terrainTexture").value;
    const edgeBlend = n("terrainEdge"); let endpoint, body;
    if(action === "lighting.assign") {endpoint="plan";body={directory,operations:[{op:action,id:$("terrainLighting").value.trim()}]};}
    else if (action === "generate") { endpoint = "landscape"; body = {directory, area, lighting:$("terrainLighting").value.trim() || undefined, style:$("terrainStyle").value, seed:n("terrainSeed"), edgeBlend, ...(texture?{materials:{base:texture}}:{})}; }
    else if(action.startsWith("water.")) {
      const template = $("terrainWaterTemplate").value.trim(), parent = $("terrainWaterParent").value.trim();
      const operations = [];
      if(action !== "water.remove" && (parent || action === "water.material")) {
        const color = $("terrainWaterColor").value.split(",").map(Number);
        if(color.length !== 4 || color.some(v => !Number.isFinite(v) || v < 0 || v > 1)) throw new Error("RGBA must contain four numbers between 0 and 1.");
        operations.push({op:"water.material",id:template,...(parent ? {parent} : {}),height:n("terrainWaterHeight"),color,isLava:$("terrainWaterLava").checked});
      }
      if(action === "water.create") operations.push({op:action,template,area});
      if(action === "water.update") operations.push({op:action,index:n("terrainWaterIndex"),area,...(template ? {template} : {})});
      if(action === "water.remove") operations.push({op:action,index:n("terrainWaterIndex")});
      endpoint = "plan";body = {directory,operations};$("terrainPreviewMode").value = "water";
    }
    else { const operation = {op:action,area,edgeBlend}; if (action === "height.raise" || action === "height.lower") operation.amount = n("terrainAmount"); else if (action === "height.flatten") operation.height = "currentMedian"; else if (action === "height.smooth") {operation.radius = 2;operation.method = "edge_preserving";} else operation.texture = texture; endpoint = "plan"; body = {directory,operations:[operation]}; }
    const plan = await api(`/api/terrain/${endpoint}`, {method:"POST",body:JSON.stringify(body)});
    state.terrainPlanId = plan.id; $("terrainOutput").textContent = JSON.stringify(plan, null, 2); $("terrainStageButton").disabled = !plan.valid;
    await terrainPreview();
  } catch (error) { handleError(error); } });
  $("terrainPreviewMode").addEventListener("change", () => terrainPreview().catch(handleError));
  $("terrainStageButton").addEventListener("click", async () => { try {
    const result = await api("/api/terrain/apply", {method:"POST",body:JSON.stringify({planId:state.terrainPlanId,dryRun:false,stage:true})});
    if (!result.accepted) throw new Error("Terrain plan was rejected.");
    state.terrainTransactionId = result.transaction.transactionId; $("terrainOutput").textContent = JSON.stringify(result,null,2);
    $("terrainStageButton").disabled = true; $("terrainSaveButton").disabled = !state.terrainTransactionId; $("terrainRollbackButton").disabled = !state.terrainTransactionId;
  } catch (error) { handleError(error); } });
  for (const [button,endpoint] of [["terrainSaveButton","save"],["terrainRollbackButton","rollback"]]) $(button).addEventListener("click", async () => { try {
    const result = await api(`/api/terrain/${endpoint}`, {method:"POST",body:JSON.stringify({transactionId:state.terrainTransactionId,dryRun:false})});
    state.terrainTransactionId = null; state.terrainPlanId = null; $("terrainOutput").textContent = JSON.stringify(result,null,2); $("terrainSaveButton").disabled = true; $("terrainRollbackButton").disabled = true; await terrainPreview();
  } catch (error) { handleError(error); } });
}

async function loadAi() {
  const query = new URLSearchParams({ file: $("aiFile").value, q: $("aiSearch").value });
  const context = await api(`/api/ai/context?${query}`);
  const list = $("aiResults"); list.replaceChildren();
  for (const [kind, rows] of [["Definition", context.definitions], ["Wave", context.waves]]) {
    for (const row of rows) {
      const button = createTextElement("button", "button full", `${kind}: ${row.id}${row.personalityId ? ` · ${row.personalityId}` : ""}`);
      button.addEventListener("click", () => { $("aiOutput").textContent = JSON.stringify(row, null, 2); });
      list.append(button);
    }
  }
  if (!context.definitions.length && !context.waves.length) list.textContent = context.component.exists ? "No matching definitions/waves." : "CustomAI absent; definition.create will register the component atomically.";
  $("aiOutput").textContent = JSON.stringify(context, null, 2);
}

function aiRequest() {
  const operations = JSON.parse($("aiOperations").value);
  if (!Array.isArray(operations) || !operations.length) throw new Error("Prepare a non-empty AiOperation[] first");
  return { file: $("aiFile").value, operations, stage: false, backup: true };
}

async function previewAi() {
  state.aiReviewed = null; $("aiApplyButton").disabled = true;
  const request = aiRequest();
  const result = await api("/api/ai/apply", { method: "POST", body: JSON.stringify({ ...request, dryRun: true }) });
  $("aiOutput").textContent = JSON.stringify(result, null, 2);
  state.aiReviewed = { request, signature: JSON.stringify(request), expectedSha256: Object.fromEntries(result.files.map((file) => [file.file, file.beforeSha256])), expectedSourceSha256: result.sourceSha256 };
  $("aiApplyButton").disabled = false;
}

async function applyAi() {
  if (!state.aiReviewed || JSON.stringify(aiRequest()) !== state.aiReviewed.signature) throw new Error("Batch changed; run Preview + diff again");
  const reviewed = state.aiReviewed;
  const result = await api("/api/ai/apply", { method: "POST", body: JSON.stringify({ ...reviewed.request, dryRun: $("aiDryRun").checked, expectedSha256: reviewed.expectedSha256, expectedSourceSha256: reviewed.expectedSourceSha256 }) });
  $("aiOutput").textContent = JSON.stringify(result, null, 2);
  if (!$("aiDryRun").checked) { state.aiReviewed = null; $("aiApplyButton").disabled = true; showToast("CustomAI applied with backup. Editor/runtime verification not performed."); }
}

function renderBrowseResults() {
  const container = $("browseResults");
  container.replaceChildren();
  container.classList.toggle("empty-state", !state.browseResults.length);
  if (!state.browseResults.length) {
    container.textContent = "No matching indexed objects.";
    return;
  }
  for (const result of state.browseResults) {
    const button = document.createElement("button");
    button.className = `browse-result${state.selectedBrowse?.key === result.key ? " active" : ""}`;
    const label = document.createElement("span");
    label.append(createTextElement("strong", "", result.displayName));
    label.append(createTextElement("small", "", `${result.catalogType}:${result.id} · ${result.dependency} · ${result.availability}`));
    button.append(label, createTextElement("span", "score", `${result.placeable ? "placeable" : "reference"} · ${result.score}`));
    button.addEventListener("click", () => selectBrowseResult(result).catch(handleError));
    container.append(button);
  }
}

async function searchBrowse() {
  const params = new URLSearchParams({ q: $("assetSearch").value, limit: "100" });
  if ($("browseCatalogType").value.trim()) params.set("catalogType", $("browseCatalogType").value.trim());
  if ($("browseDependency").value.trim()) params.set("dependency", $("browseDependency").value.trim());
  if ($("browsePlaceable").checked) params.set("placeable", "true");
  const result = await api(`/api/browse/search?${params}`);
  state.browseResults = result.results;
  renderBrowseResults();
  setOutput("activity", { total: result.total, returned: result.results.length, query: $("assetSearch").value }, "success");
}

async function selectBrowseResult(result) {
  state.selectedBrowse = result;
  $("placementSelectedKey").value = result.key;
  $("browseSelectedName").textContent = `${result.displayName} · ${result.id}`;
  const details = await api(`/api/browse/details?key=${encode(result.key)}`);
  $("browseDetails").textContent = JSON.stringify(details, null, 2);
  renderBrowseResults();
}

function numeric(id) {
  const value = Number($(id).value);
  if (!Number.isFinite(value)) throw new Error(`${id} must be numeric`);
  return value;
}

function placementLayout() {
  const type = $("placementLayout").value;
  const count = numeric("placementCount");
  if (type === "single") return { type: "single" };
  if (type === "line") return { type, spacing: 2 };
  if (type === "grid") return { type, columns: Math.max(1, Math.ceil(Math.sqrt(count))), spacingX: 2, spacingY: 2 };
  if (type === "circle") return { type, radius: numeric("locationRadius") };
  return { type: "scatter", area: { type: "circle", center: { x: numeric("placementX"), y: numeric("placementY"), z: numeric("placementZ") }, radius: numeric("locationRadius") }, seed: numeric("placementSeed"), minimumDistance: numeric("locationDistance") };
}

async function planSelected(kind) {
  if (!state.selectedBrowse) throw new Error("Select an indexed object first");
  const count = numeric("placementCount");
  const result = await api(`/api/placement/${kind.toLowerCase()}`, { method: "POST", body: JSON.stringify({
    key: state.selectedBrowse.key,
    objectFile: $("placementObjectFile").value,
    position: { x: numeric("placementX"), y: numeric("placementY"), z: numeric("placementZ") },
    rotation: numeric("placementRotation"), scale: numeric("placementScale"), owner: numeric("placementOwner"), count,
    layout: placementLayout(),
  }) });
  state.placementPlanId = result.plan.id;
  $("placementPlanBadge").textContent = result.plan.id;
  $("placementPreview").textContent = JSON.stringify(result.preview, null, 2);
  setOutput("diff", result.preview.diff, result.preview.validation.valid ? "success" : "error");
}

async function createLocation() {
  const result = await api("/api/placement/location", { method: "POST", body: JSON.stringify({
    locationType: $("locationType").value,
    queries: $("locationQueries").value.split(",").map((value) => value.trim()).filter(Boolean),
    area: { type: "circle", center: { x: numeric("placementX"), y: numeric("placementY"), z: numeric("placementZ") }, radius: numeric("locationRadius") },
    objectCount: numeric("locationCount"), minimumDistance: numeric("locationDistance"), seed: numeric("placementSeed"),
    scaleRange: { min: 0.85, max: 1.15 }, objectFile: $("placementObjectFile").value,
  }) });
  state.placementPlanId = result.plan.id;
  $("placementPlanBadge").textContent = result.plan.id;
  $("placementPreview").textContent = JSON.stringify(result.preview, null, 2);
  setOutput("diff", result.preview.diff, result.preview.validation.valid ? "success" : "error");
}

async function refreshPlacementPreview() {
  if (!state.placementPlanId) throw new Error("No placement plan");
  const preview = await api("/api/placement/preview", { method: "POST", body: JSON.stringify({ planId: state.placementPlanId }) });
  $("placementPreview").textContent = JSON.stringify(preview, null, 2);
  setOutput("diff", preview.diff, preview.validation.valid ? "success" : "error");
}

async function applyPlacement() {
  if (!state.placementPlanId) throw new Error("No placement plan");
  const dryRun = $("placementDryRun").checked;
  const result = await api("/api/placement/apply", { method: "POST", body: JSON.stringify({ planId: state.placementPlanId, dryRun, stage: false, backup: true }) });
  $("placementPreview").textContent = JSON.stringify(result, null, 2);
  setOutput("activity", result, result.accepted ? "success" : "error");
  showToast(result.accepted ? (dryRun ? "Dry-run complete; no files written" : "Placement applied with backup") : "Placement blocked by validation", !result.accepted);
}

async function applyOperations(operations, message) {
  const result = await api("/api/apply", { method: "POST", body: JSON.stringify({
    file: state.layout.file,
    operations,
    dryRun: false,
    stage: true,
    validate: true,
  }) });
  setOutput("activity", result.mutation?.preview || result, "success");
  if (result.validation && !result.validation.valid) setOutput("validation", result.validation, "error");
  showToast(message);
  const selectedPath = state.selected?.frame.path;
  await loadLayout(state.layout.file, true);
  if (selectedPath) await loadFrame(selectedPath);
  return result;
}

async function loadChildTemplates() {
  const type = $("childType").value.trim();
  if (!type) return;
  const result = await api(`/api/templates?type=${encode(type)}&limit=200`);
  const datalist = $("childTemplates");
  datalist.replaceChildren();
  for (const template of result.templates) {
    const option = document.createElement("option");
    option.value = template.reference;
    option.label = `${template.frameType} · ${template.usage.runtimeExpectation}`;
    datalist.append(option);
  }
  $("childTemplate").value = result.recommended?.reference || "";
  if (result.recommended?.usage.runtimeExpectation === "may-not-work") {
    showToast("Recommended template targets a locked frame and may not work at runtime", true);
  }
}

async function mutate(path, body, message) {
  const result = await api(path, { method: "POST", body: JSON.stringify({ ...body, dryRun: false, stage: true }) });
  setOutput("activity", result.preview || JSON.stringify(result, null, 2), "success");
  showToast(message);
  const selectedPath = state.selected?.frame.path;
  await loadLayout(state.layout.file, true);
  if (selectedPath) await loadFrame(selectedPath);
  return result;
}

async function validate() {
  if (!state.layout) return showToast("Select a layout first", true);
  const report = await api(`/api/validate?file=${encode(state.layout.file)}`);
  setOutput("validation", report, report.valid ? "success" : "error");
  showToast(report.valid ? `Valid · ${report.warnings} warnings` : `${report.errors} validation errors`, !report.valid);
}

async function reviewDiff() {
  if (!state.layout) return showToast("Select a layout first", true);
  const diff = await api(`/api/diff?file=${encode(state.layout.file)}`);
  setOutput("diff", diff.preview, diff.changed ? "" : "success");
  showToast(diff.changed ? "Staged diff loaded" : "No staged changes");
}

function bindEvents() {
  $("uiModeButton").addEventListener("click", () => switchMode("ui"));
  $("browseModeButton").addEventListener("click", () => switchMode("browse"));
  $("terrainModeButton").addEventListener("click", () => switchMode("terrain"));
  bindTerrainEvents();
  $("aiModeButton").addEventListener("click", () => switchMode("ai"));
  const aiAction = (action) => () => { action().catch((error) => { $("aiOutput").textContent = error.message; showToast(error.message, true); }); };
  $("aiRefreshButton").addEventListener("click", aiAction(loadAi));
  $("aiSchemaButton").addEventListener("click", aiAction(async () => { $("aiOutput").textContent = JSON.stringify(await api("/api/ai/schema"), null, 2); }));
  $("aiValidateButton").addEventListener("click", aiAction(async () => { $("aiOutput").textContent = JSON.stringify(await api(`/api/ai/validate?file=${encode($("aiFile").value)}`), null, 2); }));
  $("aiDefinitionButton").addEventListener("click", () => { $("aiOperations").value = JSON.stringify([{ op: "definition.create", id: $("aiDefinitionId").value }], null, 2); state.aiReviewed = null; $("aiApplyButton").disabled = true; });
  for (const id of ["aiOperations", "aiFile"]) $(id).addEventListener("input", () => { state.aiReviewed = null; $("aiApplyButton").disabled = true; });
  $("aiPreviewButton").addEventListener("click", aiAction(previewAi));
  $("aiApplyButton").addEventListener("click", aiAction(applyAi));
  $("browseSearchButton").addEventListener("click", () => searchBrowse().catch(handleError));
  $("assetSearch").addEventListener("keydown", (event) => { if (event.key === "Enter") searchBrowse().catch(handleError); });
  $("planUnitButton").addEventListener("click", () => planSelected("Unit").catch(handleError));
  $("planDoodadButton").addEventListener("click", () => planSelected("Doodad").catch(handleError));
  $("createLocationButton").addEventListener("click", () => createLocation().catch(handleError));
  $("refreshPlacementPreviewButton").addEventListener("click", () => refreshPlacementPreview().catch(handleError));
  $("applyPlacementButton").addEventListener("click", () => applyPlacement().catch(handleError));
  $("refreshButton").addEventListener("click", () => loadFiles().catch(handleError));
  $("fileSearch").addEventListener("input", renderFiles);
  $("frameSearch").addEventListener("input", renderFrames);
  $("propertyName").addEventListener("change", () => updatePropertyType().catch(handleError));
  $("childType").addEventListener("change", () => loadChildTemplates().catch(handleError));

  document.querySelectorAll(".tab").forEach((button) => button.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((item) => item.classList.toggle("active", item === button));
    $("framesView").classList.toggle("active", button.dataset.view === "frames");
    $("sourceView").classList.toggle("active", button.dataset.view === "source");
    $("frameSearch").parentElement.classList.toggle("hidden", button.dataset.view !== "frames");
  }));
  document.querySelectorAll(".output-tab").forEach((button) => button.addEventListener("click", () => {
    setOutput(button.dataset.output, state.output[button.dataset.output]);
  }));
  $("clearOutputButton").addEventListener("click", () => setOutput(state.outputView, ""));

  $("projectStatusButton").addEventListener("click", async () => {
    try { setOutput("activity", await api("/api/project/status")); } catch (error) { handleError(error); }
  });
  $("validateButton").addEventListener("click", () => validate().catch(handleError));
  $("diffButton").addEventListener("click", () => reviewDiff().catch(handleError));
  $("saveButton").addEventListener("click", async () => {
    if (!state.layout) return showToast("Select a layout first", true);
    try {
      const report = await api(`/api/validate?file=${encode(state.layout.file)}`);
      if (!report.valid) {
        setOutput("validation", report, "error");
        return showToast("Save blocked by validation errors", true);
      }
      const saved = await api("/api/save", { method: "POST", body: JSON.stringify({ file: state.layout.file, backup: true }) });
      setOutput("activity", saved, "success");
      showToast(saved.saved ? "Saved atomically with backup" : "No staged changes");
      await loadLayout(state.layout.file);
    } catch (error) { handleError(error); }
  });
  $("discardButton").addEventListener("click", async () => {
    if (!state.layout) return showToast("Select a layout first", true);
    try {
      const result = await api("/api/discard", { method: "POST", body: JSON.stringify({ file: state.layout.file }) });
      setOutput("activity", result, "success");
      showToast(result.discarded ? "Staged changes discarded" : "No draft to discard");
      await loadLayout(state.layout.file);
    } catch (error) { handleError(error); }
  });

  $("setPropertyButton").addEventListener("click", () => {
    const type = $("propertyName").selectedOptions[0]?.dataset.valueType || "";
    return mutate("/api/property/set", {
      file: state.layout.file,
      framePath: state.selected.frame.path,
      property: $("propertyName").value,
      value: parseEditorValue($("propertyValue").value, type),
    }, "Property staged").catch(handleError);
  });
  $("setCompoundPropertyButton").addEventListener("click", () => {
    const selector = {};
    if ($("propertyIndex").value !== "") selector.index = $("propertyIndex").value;
    if ($("propertyLayer").value !== "") selector.layer = $("propertyLayer").value;
    return applyOperations([{
      op: "set_property",
      framePath: state.selected.frame.path,
      property: $("propertyName").value,
      attrs: parseJson($("propertyAttrs").value, "object", "Property attributes"),
      children: parseJson($("propertyChildren").value, "array", "Property children"),
      selector,
      replace: true,
    }], "Compound property staged").catch(handleError);
  });
  $("setAnchorButton").addEventListener("click", () => mutate("/api/anchor/set", {
    file: state.layout.file,
    framePath: state.selected.frame.path,
    anchor: {
      side: $("anchorSide").value,
      relative: $("anchorRelative").value,
      pos: $("anchorPos").value,
      offset: Number($("anchorOffset").value),
    },
  }, "Anchor staged").catch(handleError));
  $("createChildButton").addEventListener("click", () => mutate("/api/frame/create", {
    file: state.layout.file,
    parentPath: state.selected.frame.path,
    type: $("childType").value,
    name: $("childName").value,
    template: $("childTemplate").value || undefined,
  }, "Child frame staged").then(() => { $("childName").value = ""; }).catch(handleError));
  $("createFileButton").addEventListener("click", async () => {
    try {
      const file = $("newFilePath").value;
      const result = await api("/api/file/create", { method: "POST", body: JSON.stringify({
        file,
        kind: "layout",
        includeIn: $("includeFilePath").value || undefined,
        dryRun: false,
        stage: true,
      }) });
      setOutput("activity", result, "success");
      await loadFiles();
      await loadLayout(file);
      showToast("Layout and Include staged");
    } catch (error) { handleError(error); }
  });
  $("attachContainerButton").addEventListener("click", () => {
    if (!state.layout) return showToast("Select a layout first", true);
    return mutate("/api/frame/create", {
      file: state.layout.file,
      type: "Frame",
      name: $("containerPath").value,
      frameFile: $("containerFile").value,
    }, "UI container override staged").catch(handleError);
  });

  $("addStateButton").addEventListener("click", () => {
    try {
      const attrs = parseJson($("stateActionAttrs").value, "object", "Action attributes");
      state.stateDraft.push({
        name: $("stateName").value,
        when: [{
          type: $("stateWhenType").value,
          frame: $("stateWhenFrame").value || undefined,
          attrs: parseJson($("stateWhenAttrs").value, "object", "When attributes"),
        }],
        actions: [{ type: $("stateActionType").value, frame: $("stateActionFrame").value || undefined, attrs }],
      });
      renderBuilderDrafts();
      showToast("State added to local builder");
    } catch (error) { handleError(error); }
  });
  $("clearStatesButton").addEventListener("click", () => { state.stateDraft = []; renderBuilderDrafts(); });
  $("stageStateGroupButton").addEventListener("click", () => {
    if (!state.stateDraft.length) return showToast("Add at least one state", true);
    return applyOperations([{
      op: "upsert_state_group",
      framePath: state.selected.frame.path,
      stateGroup: {
        name: $("stateGroupName").value,
        defaultState: $("stateDefault").value || undefined,
        states: state.stateDraft,
      },
    }], "StateGroup staged").then(() => { state.stateDraft = []; renderBuilderDrafts(); }).catch(handleError);
  });

  $("addControllerButton").addEventListener("click", () => {
    try {
      const duration = Number($("controllerDuration").value);
      if (!Number.isFinite(duration) || duration < 0) throw new Error("Controller duration must be non-negative");
      state.controllerDraft.push({
        type: $("controllerType").value,
        frame: $("controllerFrame").value || undefined,
        end: $("controllerEnd").value || undefined,
        attrs: parseJson($("controllerAttrs").value, "object", "Controller attributes"),
        keys: [
          { type: "Curve", time: 0, attrs: { value: parseEditorValue($("controllerFrom").value, "Number") } },
          { type: "Curve", time: duration, attrs: { value: parseEditorValue($("controllerTo").value, "Number") } },
        ],
      });
      renderBuilderDrafts();
      showToast("Controller added to local builder");
    } catch (error) { handleError(error); }
  });
  $("clearControllersButton").addEventListener("click", () => { state.controllerDraft = []; renderBuilderDrafts(); });
  $("stageAnimationButton").addEventListener("click", () => {
    if (!state.controllerDraft.length) return showToast("Add at least one controller", true);
    return applyOperations([{
      op: "upsert_animation",
      framePath: state.selected.frame.path,
      animation: {
        name: $("animationName").value,
        speed: Number($("animationSpeed").value),
        events: $("animationOnShown").checked
          ? [{ event: "OnShown", action: "Reset,Play", frame: "$this" }]
          : undefined,
        controllers: state.controllerDraft,
      },
    }], "Animation staged").then(() => { state.controllerDraft = []; renderBuilderDrafts(); }).catch(handleError);
  });
}

function handleError(error) {
  const message = error instanceof Error ? error.message : String(error);
  setOutput("activity", message, "error");
  showToast(message, true);
}

async function loadTypeDatalist() {
  const types = await api("/api/types?limit=2000");
  const datalist = $("frameTypes");
  datalist.replaceChildren();
  for (const type of types) {
    const option = document.createElement("option");
    option.value = type.name;
    datalist.append(option);
  }
}

async function loadContainerPresets() {
  const result = await api("/api/containers");
  const datalist = $("uiContainers");
  datalist.replaceChildren();
  for (const preset of result.presets) {
    const option = document.createElement("option");
    option.value = preset.name;
    option.label = `${preset.label} · file=${preset.file}`;
    option.dataset.file = preset.file;
    datalist.append(option);
  }
  $("containerPath").addEventListener("change", () => {
    const preset = result.presets.find((item) => item.name === $("containerPath").value);
    if (preset) $("containerFile").value = preset.file;
  });
}

async function loadBuilderSchemas() {
  [state.stateSchema, state.animationSchema] = await Promise.all([
    api("/api/schema/state"),
    api("/api/schema/animation"),
  ]);
  for (const [id, values] of [
    ["stateWhenType", state.stateSchema.conditions],
    ["stateActionType", state.stateSchema.actions],
    ["controllerType", state.animationSchema.controllerTypes],
  ]) {
    const select = $(id);
    select.replaceChildren();
    for (const value of values) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = value;
      select.append(option);
    }
  }
  $("stateWhenType").value = state.stateSchema.conditions.includes("Property") ? "Property" : state.stateSchema.conditions[0];
  $("stateActionType").value = state.stateSchema.actions.includes("SetProperty") ? "SetProperty" : state.stateSchema.actions[0];
  $("controllerType").value = state.animationSchema.controllerTypes.includes("Fade") ? "Fade" : state.animationSchema.controllerTypes[0];
}

bindEvents();
renderBuilderDrafts();
Promise.all([loadHealth(), loadFiles(true), loadTypeDatalist(), loadBuilderSchemas(), loadContainerPresets()]).catch(handleError);
