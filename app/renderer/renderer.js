const fallbackBridge = {
  generationCallbacks: [],
  emitGenerationEvent(event) {
    this.generationCallbacks.forEach((callback) => callback(event));
  },
  async systemInfo() {
    return {
      totalGb: 128,
      usedGb: 44,
      freeGb: 84,
      python: ".venv/bin/python",
      platform: "browser",
      arch: "preview",
      paths: {
        root: ".",
        fp8: "models/ideogram-4-fp8",
        nf4: "models/ideogram-4-nf4",
        outputs: "outputs"
      }
    };
  },
  async apiStatus() {
    return {
      running: true,
      endpoint: "http://127.0.0.1:7860",
      health: "http://127.0.0.1:7860/health",
      generate: "http://127.0.0.1:7860/generate",
      busy: false
    };
  },
  async listGallery() {
    return [
      {
        name: "preview-mountain.png",
        path: "../assets/reference/preview-mountain.png",
        url: "../assets/reference/preview-mountain.png",
        size: 0,
        mtimeMs: Date.now()
      }
    ];
  },
  async doctor() {
    return {
      type: "done",
      doctor: {
        python: ".venv/bin/python",
        torch: "2.12.0",
        mps: true,
        cuda: false,
        fp8Model: true,
        nf4Model: true,
        vendorIdeogram4: true
      }
    };
  },
  async generate(payload) {
    const totalSteps = Math.max(4, Math.min(6, Number(payload.steps || 4)));
    this.emitGenerationEvent({
      type: "progress",
      jobId: "fallback-generate",
      phase: "sample",
      message: `Image 1/1, seed ${payload.seed}, ${totalSteps} steps`,
      step: 0,
      totalSteps,
      remainingSteps: totalSteps,
      imageIndex: 1,
      totalImages: 1,
      globalStep: 0,
      globalTotalSteps: totalSteps,
      globalRemainingSteps: totalSteps
    });
    for (let step = 1; step <= totalSteps; step += 1) {
      await new Promise((resolve) => setTimeout(resolve, 160));
      this.emitGenerationEvent({
        type: "progress",
        jobId: "fallback-generate",
        phase: "step",
        message: `Step ${step}/${totalSteps}`,
        step,
        totalSteps,
        remainingSteps: totalSteps - step,
        imageIndex: 1,
        totalImages: 1,
        globalStep: step,
        globalTotalSteps: totalSteps,
        globalRemainingSteps: totalSteps - step
      });
    }
    return {
      type: "done",
      outputPath: "../assets/reference/preview-mountain.png",
      outputPaths: ["../assets/reference/preview-mountain.png"],
      duration: 0.9,
      seed: payload.seed < 0 ? 1143 : payload.seed,
      width: payload.width,
      height: payload.height,
      sampler: payload.sampler,
      quantization: payload.quantization,
      device: "browser-preview"
    };
  },
  async copyText(text) {
    await navigator.clipboard?.writeText(String(text || ""));
    return true;
  },
  async trashItem() {
    return { ok: true, images: [] };
  },
  onGenerationEvent(callback) {
    this.generationCallbacks.push(callback);
    return () => {
      this.generationCallbacks = this.generationCallbacks.filter((item) => item !== callback);
    };
  },
  onWorkerLog() {
    return () => {};
  },
  openPath() {},
  showItem() {}
};

const bridge = window.ideogram || fallbackBridge;
const CUSTOM_SIZE_MIN = 256;
const CUSTOM_SIZE_MAX = 2048;
const CUSTOM_SIZE_STEP = 16;

const state = {
  width: 1024,
  height: 1024,
  lastOutputPath: null,
  selectedGalleryPath: null,
  system: null,
  api: null,
  doctor: null,
  generating: false,
  gallery: [],
  favorites: new Set(),
  lightMode: false,
  progressFirstStepAt: null,
  progressJobId: null,
  view: "generation"
};

const fallbackThumbs = [
  "../assets/reference/thumb-mountain.png",
  "../assets/reference/thumb-city.png",
  "../assets/reference/thumb-room.png",
  "../assets/reference/thumb-fantasy.png"
];

const qs = (selector) => document.querySelector(selector);
const qsa = (selector) => [...document.querySelectorAll(selector)];

const els = {
  prompt: qs("#prompt"),
  negative: qs("#negative-prompt"),
  promptCounter: qs("#prompt-counter"),
  negativeCounter: qs("#negative-counter"),
  steps: qs("#steps"),
  stepsValue: qs("#steps-value"),
  cfg: qs("#cfg-scale"),
  cfgValue: qs("#cfg-value"),
  seed: qs("#seed"),
  model: qs("#model-select"),
  sampler: qs("#sampler-select"),
  generateButton: qs("#generate-button"),
  overlay: qs("#generation-overlay"),
  phaseLabel: qs("#phase-label"),
  phaseDetail: qs("#phase-detail"),
  preview: qs("#preview-image"),
  log: qs("#runtime-log"),
  memoryFill: qs("#memory-fill"),
  memoryLabel: qs("#memory-label"),
  systemState: qs("#system-state"),
  workerState: qs("#worker-state"),
  pythonLabel: qs("#python-label"),
  navItems: qsa("[data-view]"),
  viewPanels: qsa("[data-view-panel]"),
  apiState: qs("#api-state"),
  apiEndpoint: qs("#api-endpoint"),
  apiHealthUrl: qs("#api-health-url"),
  apiGenerateUrl: qs("#api-generate-url"),
  apiBusy: qs("#api-busy"),
  apiCurlSnippet: qs("#api-curl-snippet"),
  apiHealthOutput: qs("#api-health-output"),
  galleryGrid: qs("#gallery-grid"),
  galleryPreview: qs("#gallery-preview"),
  galleryFile: qs("#gallery-file"),
  galleryCreated: qs("#gallery-created"),
  gallerySize: qs("#gallery-size"),
  doctorState: qs("#doctor-state"),
  settingsDoctorOutput: qs("#settings-doctor-output"),
  overlayProgress: qs("#overlay-progress"),
  overlayProgressFill: qs("#overlay-progress-fill"),
  overlayProgressSteps: qs("#overlay-progress-steps"),
  overlayProgressEta: qs("#overlay-progress-eta"),
  customSizeRow: qs("#custom-size-row"),
  customWidth: qs("#custom-width"),
  customHeight: qs("#custom-height"),
  applyCustomSize: qs("#apply-custom-size")
};

function setText(element, value) {
  if (element) element.textContent = value;
}

function formatDate(ms) {
  if (!ms) return "--";
  return new Date(ms).toLocaleString([], {
    month: "short",
    day: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function formatBytes(bytes) {
  if (!bytes) return "--";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "--";
  const rounded = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(rounded / 60);
  const rest = rounded % 60;
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours}h ${String(mins).padStart(2, "0")}m`;
  }
  if (minutes > 0) return `${minutes}:${String(rest).padStart(2, "0")}`;
  return `${rest}s`;
}

function fileUrl(path) {
  if (!path) return "../assets/reference/preview-mountain.png";
  if (path.startsWith(".") || path.startsWith("file:") || path.startsWith("http")) return path;
  return `file://${path}`;
}

function isGeneratedOutputPath(path) {
  const outputRoot = state.system?.paths?.outputs;
  if (!path || !outputRoot) return false;
  return path === outputRoot || path.startsWith(`${outputRoot}/`);
}

function setControlDisabled(selector, disabled) {
  qs(selector)?.toggleAttribute("disabled", Boolean(disabled));
}

function updateCounters() {
  setText(els.promptCounter, `${els.prompt.value.length} / 2000`);
  setText(els.negativeCounter, `${els.negative.value.length} / 2000`);
}

function log(message) {
  const stamp = new Date().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
  els.log.textContent = `${els.log.textContent}\n[${stamp}] ${message}`.trim();
  els.log.scrollTop = els.log.scrollHeight;
}

function setBadge(element, label, tone = "ok") {
  if (!element) return;
  element.textContent = label;
  element.classList.toggle("warn", tone === "warn");
  element.classList.toggle("error", tone === "error");
}

function setBusy(isBusy) {
  state.generating = isBusy;
  if (isBusy) resetStepProgress();
  els.generateButton.disabled = isBusy;
  els.generateButton.textContent = "";
  const icon = document.createElement("img");
  icon.className = "icon";
  icon.src = "../assets/icons/sparkles.svg";
  icon.alt = "";
  els.generateButton.append(icon, document.createTextNode(isBusy ? " Generating" : " Generate"));
  els.overlay.classList.toggle("hidden", !isBusy);
  if (!isBusy) resetStepProgress();
  setText(els.workerState, isBusy ? "Generating" : "Idle");
}

function setPhase(phase, detail) {
  setText(els.phaseLabel, phase);
  setText(els.phaseDetail, detail || "");
  log(`${phase}: ${detail || ""}`.trim());
}

function resetStepProgress() {
  state.progressFirstStepAt = null;
  state.progressJobId = null;
  els.overlayProgress?.classList.add("hidden");
  if (els.overlayProgressFill) els.overlayProgressFill.style.width = "0%";
  setText(els.overlayProgressSteps, "0 / 0 steps");
  setText(els.overlayProgressEta, "ETA ab Schritt 2");
}

function showInitialStepProgress(event) {
  const total = Number(event.globalTotalSteps || event.totalSteps || 0);
  const done = Number(event.globalStep || 0);
  const remaining = Math.max(0, total - done);
  els.overlayProgress?.classList.remove("hidden");
  if (els.overlayProgressFill) els.overlayProgressFill.style.width = total ? `${(done / total) * 100}%` : "0%";
  setText(els.overlayProgressSteps, `${done} / ${total} steps · ${remaining} offen`);
  setText(els.overlayProgressEta, "ETA ab Schritt 2");
}

function updateStepProgress(event) {
  const globalStep = Number(event.globalStep || event.step || 0);
  const globalTotal = Number(event.globalTotalSteps || event.totalSteps || 0);
  const remaining = Number(event.globalRemainingSteps ?? Math.max(0, globalTotal - globalStep));
  const imageIndex = Number(event.imageIndex || 1);
  const totalImages = Number(event.totalImages || 1);
  const pct = globalTotal > 0 ? Math.min(100, Math.max(0, (globalStep / globalTotal) * 100)) : 0;

  if (globalStep <= 1 || state.progressJobId !== event.jobId) {
    state.progressFirstStepAt = Date.now();
    state.progressJobId = event.jobId || "current";
  }

  let etaText = "ETA ab Schritt 2";
  if (globalStep >= 2 && state.progressFirstStepAt) {
    const elapsedSeconds = (Date.now() - state.progressFirstStepAt) / 1000;
    const measuredSteps = Math.max(1, globalStep - 1);
    const secondsPerStep = elapsedSeconds / measuredSteps;
    etaText = `ETA ${formatDuration(secondsPerStep * remaining)}`;
  }

  els.overlayProgress?.classList.remove("hidden");
  if (els.overlayProgressFill) els.overlayProgressFill.style.width = `${pct}%`;
  const imageText = totalImages > 1 ? ` · Bild ${imageIndex}/${totalImages}` : "";
  setText(els.overlayProgressSteps, `${globalStep} / ${globalTotal} steps · ${remaining} offen${imageText}`);
  setText(els.overlayProgressEta, etaText);
  setText(els.phaseLabel, "Sampling");
  setText(els.phaseDetail, `Step ${event.step || globalStep}/${event.totalSteps || globalTotal}`);
}

function updateRangeFill(range) {
  const min = Number(range.min);
  const max = Number(range.max);
  const value = Number(range.value);
  const pct = ((value - min) / (max - min)) * 100;
  range.style.background = `linear-gradient(90deg, var(--blue) 0%, var(--blue) ${pct}%, rgba(148, 163, 184, 0.16) ${pct}%)`;
}

function clampInput(input) {
  const min = Number(input.min || "-Infinity");
  const max = Number(input.max || "Infinity");
  const next = Math.min(max, Math.max(min, Number(input.value || min)));
  input.value = String(next);
  return next;
}

function syncInfo(extra = {}) {
  const modelLabel = els.model.value === "fp8" ? "Ideogram 4 FP8" : "Ideogram 4 NF4";
  const samplerLabel = els.sampler.options[els.sampler.selectedIndex].textContent;
  setText(qs("#info-model"), modelLabel);
  setText(qs("#info-sampler"), samplerLabel);
  setText(qs("#info-steps"), els.stepsValue.value);
  setText(qs("#info-cfg"), Number(els.cfgValue.value).toFixed(1));
  setText(qs("#info-seed"), els.seed.value);
  setText(qs("#info-size"), `${state.width} x ${state.height}`);
  if (extra.created) setText(qs("#info-created"), extra.created);
  if (extra.time) setText(qs("#info-time"), extra.time);
  updateApiSnippet();
}

function selectSegment(container, button) {
  [...container.querySelectorAll("button")].forEach((item) => item.classList.remove("active"));
  button.classList.add("active");
}

function selectSegmentByValue(selector, dataName, value) {
  const container = qs(selector);
  const button = container?.querySelector(`[data-${dataName}="${value}"]`);
  if (container && button) selectSegment(container, button);
}

function setSize(width, height) {
  state.width = width;
  state.height = height;
  syncCustomInputs();
  syncInfo();
}

function syncCustomInputs(width = state.width, height = state.height) {
  if (els.customWidth) els.customWidth.value = String(width);
  if (els.customHeight) els.customHeight.value = String(height);
}

function setCustomSizeControlsVisible(visible, focusField = "width") {
  els.customSizeRow?.classList.toggle("hidden", !visible);
  if (!visible) return;
  syncCustomInputs();
  requestAnimationFrame(() => {
    const target = focusField === "height" ? els.customHeight : els.customWidth;
    target?.focus();
    target?.select();
  });
}

function validCustomDimension(value) {
  return (
    Number.isInteger(value) &&
    value >= CUSTOM_SIZE_MIN &&
    value <= CUSTOM_SIZE_MAX &&
    value % CUSTOM_SIZE_STEP === 0
  );
}

function applyCustomSizeFromInputs() {
  const width = Number(els.customWidth?.value);
  const height = Number(els.customHeight?.value);
  if (!validCustomDimension(width) || !validCustomDimension(height)) {
    window.alert("Width and height must be 256-2048 and multiples of 16.");
    syncCustomInputs();
    return false;
  }
  selectSegmentByValue("#size-buttons", "size", "custom");
  selectSegmentByValue("#ratio-buttons", "ratio", "custom");
  setSize(width, height);
  log(`Custom size set to ${width} x ${height}`);
  return true;
}

function switchView(view) {
  state.view = view;
  els.navItems.forEach((item) => item.classList.toggle("active", item.dataset.view === view));
  els.viewPanels.forEach((panel) => {
    const active = panel.dataset.viewPanel === view;
    panel.classList.toggle("active", active);
    panel.setAttribute("aria-hidden", active ? "false" : "true");
  });

  if (view === "server") refreshApiStatus(false);
  if (view === "gallery") refreshGallery();
  if (view === "settings") {
    refreshSystemInfo();
    refreshApiStatus(false);
  }
}

function addGalleryItemToStrip(item, active = false) {
  const strip = qs("#gallery-strip");
  const button = document.createElement("button");
  button.className = `thumb${active ? " active" : ""}`;
  button.type = "button";
  button.dataset.path = item.path || "";
  const img = document.createElement("img");
  img.src = item.url || fileUrl(item.path);
  img.alt = "";
  button.append(img);
  strip.append(button);
}

function renderRecentStrip(images = state.gallery) {
  const strip = qs("#gallery-strip");
  strip.textContent = "";
  const items = images.slice(0, 4);
  if (!items.length) {
    fallbackThumbs.forEach((src, index) => addGalleryItemToStrip({ path: src, url: src }, index === 0));
    return;
  }
  items.forEach((item, index) => addGalleryItemToStrip(item, index === 0));
}

function selectGalleryImage(item) {
  if (!item) return;
  state.selectedGalleryPath = item.path;
  const src = item.url || fileUrl(item.path);
  els.galleryPreview.src = src;
  els.preview.src = src;
  setText(els.galleryFile, item.name || item.path || "Preview");
  setText(els.galleryCreated, formatDate(item.mtimeMs));
  setText(els.gallerySize, formatBytes(item.size));
  qsa(".gallery-card").forEach((card) => card.classList.toggle("active", card.dataset.path === item.path));
  qsa("#gallery-strip .thumb").forEach((thumb) => thumb.classList.toggle("active", thumb.dataset.path === item.path));
  const isOutput = isGeneratedOutputPath(item.path);
  setControlDisabled("#gallery-delete", !isOutput);
  setControlDisabled("#gallery-reveal", !isOutput);
  updateFavoriteButtons();
}

function renderGallery(images = state.gallery) {
  if (!els.galleryGrid) return;
  els.galleryGrid.textContent = "";
  if (!images.length) {
    const empty = document.createElement("div");
    empty.className = "empty-gallery";
    empty.textContent = "No generated images yet.";
    els.galleryGrid.append(empty);
    selectGalleryImage({
      name: "Reference preview",
      path: "../assets/reference/preview-mountain.png",
      url: "../assets/reference/preview-mountain.png"
    });
    return;
  }

  images.forEach((item, index) => {
    const button = document.createElement("button");
    button.className = `gallery-card${index === 0 ? " active" : ""}`;
    button.type = "button";
    button.dataset.path = item.path;
    const img = document.createElement("img");
    img.src = item.url || fileUrl(item.path);
    img.alt = "";
    button.title = item.name;
    button.setAttribute("aria-label", item.name);
    button.append(img);
    button.addEventListener("click", () => selectGalleryImage(item));
    els.galleryGrid.append(button);
  });

  selectGalleryImage(images[0]);
}

async function refreshGallery() {
  try {
    const images = await bridge.listGallery();
    state.gallery = Array.isArray(images) ? images : [];
    renderRecentStrip(state.gallery);
    renderGallery(state.gallery);
  } catch (error) {
    log(`Gallery refresh failed: ${error.message}`);
  }
}

async function deleteSelectedGalleryImage() {
  const target = state.selectedGalleryPath;
  if (!target) return;
  if (!isGeneratedOutputPath(target)) {
    log("Only generated output images can be deleted from the Gallery.");
    return;
  }

  const name = target.split("/").pop();
  if (!window.confirm(`Move ${name} to Trash?`)) return;

  try {
    const result = await bridge.trashItem(target);
    state.favorites.delete(target);
    state.lastOutputPath = state.lastOutputPath === target ? null : state.lastOutputPath;
    state.selectedGalleryPath = null;
    state.gallery = Array.isArray(result?.images) ? result.images : [];
    if (!state.gallery.length) await refreshGallery();
    else {
      renderRecentStrip(state.gallery);
      renderGallery(state.gallery);
    }
    log(`Moved to Trash: ${name}`);
  } catch (error) {
    log(`Delete failed: ${error.message}`);
  }
}

function doctorLines(doctor) {
  return Object.entries(doctor || {})
    .map(([key, value]) => `${key}: ${value}`)
    .join("\n");
}

function updateSettingsFromSystem(info = state.system) {
  if (!info) return;
  setText(qs("#settings-python"), info.python || "--");
  setText(qs("#settings-root"), info.paths?.root || "--");
  setText(qs("#settings-fp8"), info.paths?.fp8 || "--");
  setText(qs("#settings-nf4"), info.paths?.nf4 || "--");
  setText(qs("#settings-outputs"), info.paths?.outputs || "--");
}

function updateSettingsFromDoctor(doctor = state.doctor) {
  if (!doctor) return;
  setText(qs("#settings-mps"), String(Boolean(doctor.mps)));
  setText(qs("#settings-torch"), doctor.torch || doctor.torchError || "--");
  setText(qs("#settings-vendor"), String(doctor.vendorIdeogram4 || doctor.ideogram4 || "--"));
}

function updateApiView(status = state.api) {
  if (!status) return;
  setBadge(els.apiState, status.running ? "Running" : "Stopped", status.running ? "ok" : "error");
  setText(els.apiEndpoint, status.endpoint);
  setText(els.apiHealthUrl, status.health);
  setText(els.apiGenerateUrl, status.generate);
  setText(els.apiBusy, status.busy ? "yes" : "no");
  setText(qs("#settings-api"), status.endpoint || "--");
  updateApiSnippet();
}

function currentPayload() {
  return {
    prompt: els.prompt.value.trim(),
    negativePrompt: els.negative.value.trim(),
    quantization: els.model.value,
    modelPath: state.system?.paths?.[els.model.value],
    sampler: els.sampler.value,
    steps: Number(els.stepsValue.value),
    cfgScale: Number(els.cfgValue.value),
    seed: Number(els.seed.value),
    width: state.width,
    height: state.height,
    device: "auto",
    dtype: "bfloat16",
    structuredCaption: true,
    batchCount: Number(qs("#batch-count-value").value),
    batchSize: Number(qs("#batch-size-value").value)
  };
}

function apiSamplePayload() {
  const payload = currentPayload();
  return {
    prompt: payload.prompt || "A ceramic espresso cup on a stone table, morning window light",
    negativePrompt: payload.negativePrompt,
    quantization: payload.quantization,
    modelPath: payload.modelPath,
    sampler: payload.sampler,
    steps: payload.steps,
    cfgScale: payload.cfgScale,
    seed: payload.seed,
    width: payload.width,
    height: payload.height,
    device: payload.device,
    dtype: payload.dtype,
    structuredCaption: payload.structuredCaption,
    batchCount: payload.batchCount,
    batchSize: payload.batchSize
  };
}

function updateApiSnippet() {
  if (!els.apiCurlSnippet) return;
  const endpoint = state.api?.generate || "http://127.0.0.1:7860/generate";
  const body = JSON.stringify(apiSamplePayload(), null, 2);
  els.apiCurlSnippet.textContent = `curl -s -X POST "${endpoint}" \\
  -H "content-type: application/json" \\
  -d '${body}'`;
}

async function refreshApiStatus(runHealth = false) {
  try {
    const status = await bridge.apiStatus();
    state.api = status;
    updateApiView(status);
    if (runHealth) {
      const response = await fetch(status.health);
      const json = await response.json();
      els.apiHealthOutput.textContent = JSON.stringify(json, null, 2);
      if (json.system) {
        state.system = json.system;
        updateSettingsFromSystem(json.system);
      }
    }
  } catch (error) {
    setBadge(els.apiState, "Error", "error");
    setText(els.apiHealthOutput, error.message);
    log(`API status failed: ${error.message}`);
  }
}

async function copyText(text, label = "Copied") {
  const value = String(text || "");
  if (!value) return;
  try {
    if (bridge.copyText) {
      await bridge.copyText(value);
    } else {
      await navigator.clipboard.writeText(value);
    }
    log(`${label}: ${value}`);
  } catch (error) {
    log(`Copy failed: ${error.message}. Value: ${value}`);
  }
}

function enhancePrompt() {
  const value = els.prompt.value.trim();
  if (!value) return;
  if (!/structured composition|Ideogram 4/i.test(value)) {
    els.prompt.value = `${value}, structured composition, crisp subject separation, controlled lighting, Ideogram 4 quality`;
  }
  updateCounters();
  syncInfo();
}

async function refreshSystemInfo() {
  try {
    const info = await bridge.systemInfo();
    state.system = info;
    const used = info.usedGb || 0;
    const total = info.totalGb || 128;
    const pct = Math.min(100, Math.max(0, (used / total) * 100));
    els.memoryFill.style.width = `${pct}%`;
    setText(els.memoryLabel, `${used.toFixed(1)} GB / ${total.toFixed(0)} GB`);
    setText(els.pythonLabel, info.python ? info.python.split("/").slice(-2).join("/") : "local python");
    setText(els.systemState, info.platform === "darwin" ? "Apple Silicon ready" : `${info.platform} ${info.arch}`);
    updateSettingsFromSystem(info);
    syncInfo();
  } catch (error) {
    log(`System info failed: ${error.message}`);
  }
}

async function runDoctor() {
  if (state.generating) {
    log("Doctor skipped while generation is running.");
    return;
  }
  try {
    setBadge(els.doctorState, "Running", "warn");
    setPhase("Runtime diagnostics", "Checking Python and model paths");
    const result = await bridge.doctor();
    const doctor = result.doctor || {};
    state.doctor = doctor;
    const lines = doctorLines(doctor);
    log(lines);
    setText(els.settingsDoctorOutput, lines);
    setText(els.systemState, doctor.mps ? "MPS ready" : "MPS unavailable");
    setBadge(els.doctorState, doctor.mps ? "Ready" : "Check", doctor.mps ? "ok" : "warn");
    updateSettingsFromDoctor(doctor);
  } catch (error) {
    setBadge(els.doctorState, "Error", "error");
    log(`Doctor failed: ${error.message}`);
    setText(els.settingsDoctorOutput, error.message);
  }
}

function updateFavoriteButtons() {
  const current = state.lastOutputPath || state.selectedGalleryPath || els.preview.src;
  const active = state.favorites.has(current);
  qs("#favorite-action")?.classList.toggle("active", active);
  qs("#gallery-favorite")?.classList.toggle("active", active);
}

function toggleFavorite(target = state.lastOutputPath || state.selectedGalleryPath || els.preview.src) {
  if (!target) return;
  if (state.favorites.has(target)) {
    state.favorites.delete(target);
    log("Removed favorite");
  } else {
    state.favorites.add(target);
    log("Marked favorite");
  }
  updateFavoriteButtons();
}

function setLightMode(enabled) {
  state.lightMode = Boolean(enabled);
  document.body.classList.toggle("light-on", state.lightMode);
  localStorage.setItem("ideogram-light-mode", state.lightMode ? "1" : "0");
  qs("#light-button")?.setAttribute("aria-pressed", String(state.lightMode));
  qs("#sidebar-light-button")?.setAttribute("aria-pressed", String(state.lightMode));
}

async function generate() {
  if (state.generating) return;
  const payload = currentPayload();
  if (!payload.prompt) {
    window.alert("Prompt is empty.");
    return;
  }
  setBusy(true);
  syncInfo();
  await refreshApiStatus(false);
  try {
    const result = await bridge.generate(payload);
    const src = fileUrl(result.outputPath);
    state.lastOutputPath = result.outputPath;
    state.selectedGalleryPath = result.outputPath;
    els.preview.src = src;
    setText(qs("#gallery-file"), result.outputPath?.split("/").pop() || "Generated image");
    syncInfo({
      created: new Date().toLocaleString([], {
        month: "short",
        day: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit"
      }),
      time: `${result.duration}s`
    });
    log(`Saved ${result.outputPath || "preview image"}`);
    await refreshGallery();
    const generated = state.gallery.find((item) => item.path === result.outputPath);
    if (generated) selectGalleryImage(generated);
  } catch (error) {
    log(`Generation failed: ${error.message}`);
  } finally {
    setBusy(false);
    await refreshSystemInfo();
    await refreshApiStatus(false);
  }
}

function bindNavigation() {
  els.navItems.forEach((item) => {
    item.addEventListener("click", () => switchView(item.dataset.view));
  });
  qs("#memory-pill")?.addEventListener("click", () => switchView("settings"));
  qs("#help-button")?.addEventListener("click", () => {
    switchView("settings");
    log("Opened runtime settings and diagnostics.");
  });
  qs("#view-all-gallery")?.addEventListener("click", () => switchView("gallery"));
}

function bindPromptAndParameters() {
  els.prompt.addEventListener("input", () => {
    updateCounters();
    syncInfo();
  });
  els.negative.addEventListener("input", () => {
    updateCounters();
    syncInfo();
  });

  qs("#clear-prompt").addEventListener("click", () => {
    els.prompt.value = "";
    updateCounters();
    syncInfo();
  });
  qs("#enhance-prompt").addEventListener("click", enhancePrompt);

  for (const [range, number] of [
    [els.steps, els.stepsValue],
    [els.cfg, els.cfgValue],
    [qs("#batch-count"), qs("#batch-count-value")],
    [qs("#batch-size"), qs("#batch-size-value")]
  ]) {
    const syncFromRange = () => {
      number.value = range.value;
      updateRangeFill(range);
      syncInfo();
    };
    const syncFromNumber = () => {
      clampInput(number);
      range.value = number.value;
      updateRangeFill(range);
      syncInfo();
    };
    range.addEventListener("input", syncFromRange);
    number.addEventListener("input", syncFromNumber);
    updateRangeFill(range);
  }

  els.sampler.addEventListener("change", () => {
    const presetSteps = {
      V4_TURBO_12: 12,
      V4_DEFAULT_20: 20,
      V4_QUALITY_48: 48
    };
    if (presetSteps[els.sampler.value]) {
      els.steps.value = String(presetSteps[els.sampler.value]);
      els.stepsValue.value = String(presetSteps[els.sampler.value]);
      updateRangeFill(els.steps);
    }
    syncInfo();
  });

  els.model.addEventListener("change", () => {
    if (els.model.value === "nf4") {
      log("NF4 is CUDA-only in the official runtime. Use FP8 on this Mac unless a CUDA host is attached.");
    }
    syncInfo();
  });

  qs("#random-seed").addEventListener("click", () => {
    els.seed.value = Math.floor(Math.random() * 2147483647);
    syncInfo();
  });
  qs("#reset-seed").addEventListener("click", () => {
    els.seed.value = -1;
    syncInfo();
  });
  els.seed.addEventListener("input", syncInfo);

  qs("#size-buttons").addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    const size = button.dataset.size;
    if (size === "custom") {
      selectSegment(event.currentTarget, button);
      selectSegmentByValue("#ratio-buttons", "ratio", "custom");
      setCustomSizeControlsVisible(true, "width");
      return;
    }
    selectSegment(event.currentTarget, button);
    setCustomSizeControlsVisible(false);
    if (size === "512x512") setSize(512, 512);
    if (size === "768x768") setSize(768, 768);
    if (size === "1024x1024") setSize(1024, 1024);
    if (size === "1536x1024") setSize(1536, 1024);
  });

  qs("#ratio-buttons").addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    const ratio = button.dataset.ratio;
    if (ratio === "custom") {
      selectSegment(event.currentTarget, button);
      selectSegmentByValue("#size-buttons", "size", "custom");
      setCustomSizeControlsVisible(true, "height");
      return;
    }
    selectSegment(event.currentTarget, button);
    setCustomSizeControlsVisible(false);
    if (ratio === "1:1") setSize(1024, 1024);
    if (ratio === "3:2") setSize(1536, 1024);
    if (ratio === "4:3") setSize(1024, 768);
    if (ratio === "16:9") setSize(1920, 1088);
    if (ratio === "9:16") setSize(1024, 1792);
  });

  els.applyCustomSize?.addEventListener("click", applyCustomSizeFromInputs);
  [els.customWidth, els.customHeight].forEach((input) => {
    input?.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        applyCustomSizeFromInputs();
      }
    });
  });
}

function bindPreviewAndGallery() {
  qs("#gallery-strip").addEventListener("click", (event) => {
    const thumb = event.target.closest(".thumb");
    if (!thumb) return;
    const item = state.gallery.find((image) => image.path === thumb.dataset.path) || {
      path: thumb.dataset.path,
      url: thumb.querySelector("img").src,
      name: "Reference preview"
    };
    selectGalleryImage(item);
  });

  qs("#download-action").addEventListener("click", () => {
    const target = state.lastOutputPath || state.selectedGalleryPath;
    if (isGeneratedOutputPath(target)) bridge.showItem(target);
    else log("No generated file to reveal yet.");
  });

  qs("#copy-action").addEventListener("click", () => {
    copyText(state.lastOutputPath || state.selectedGalleryPath || els.preview.src, "Copied output");
  });

  qs("#favorite-action").addEventListener("click", () => toggleFavorite());

  qs("#more-action").addEventListener("click", () => {
    const target = state.system?.paths?.outputs || state.lastOutputPath;
    if (target) bridge.openPath(target);
  });

  qs("#refresh-gallery").addEventListener("click", refreshGallery);
  qs("#open-gallery-folder").addEventListener("click", () => {
    const target = state.system?.paths?.outputs;
    if (target) bridge.openPath(target);
  });
  qs("#gallery-reveal").addEventListener("click", () => {
    if (isGeneratedOutputPath(state.selectedGalleryPath)) bridge.showItem(state.selectedGalleryPath);
    else log("No generated file selected to reveal.");
  });
  qs("#gallery-copy").addEventListener("click", () => {
    copyText(state.selectedGalleryPath, "Copied gallery path");
  });
  qs("#gallery-favorite").addEventListener("click", () => toggleFavorite(state.selectedGalleryPath));
  qs("#gallery-delete").addEventListener("click", deleteSelectedGalleryImage);
}

function bindRuntimeActions() {
  qs("#clear-log").addEventListener("click", () => {
    els.log.textContent = "Ready.";
  });

  qs("#open-output").addEventListener("click", () => {
    const target = state.system?.paths?.outputs || state.lastOutputPath;
    if (target) bridge.openPath(target);
  });

  qs("#doctor-button").addEventListener("click", runDoctor);
  qs("#settings-doctor").addEventListener("click", runDoctor);
  qs("#settings-open-root").addEventListener("click", () => {
    const target = state.system?.paths?.root;
    if (target) bridge.openPath(target);
  });
  qs("#settings-copy-paths").addEventListener("click", () => {
    const paths = state.system?.paths || {};
    copyText(JSON.stringify(paths, null, 2), "Copied paths");
  });

  qs("#copy-endpoint").addEventListener("click", () => {
    copyText(state.api?.endpoint || "http://127.0.0.1:7860", "Copied endpoint");
  });
  qs("#copy-curl").addEventListener("click", () => {
    copyText(els.apiCurlSnippet.textContent, "Copied API request");
  });
  qs("#test-health").addEventListener("click", () => refreshApiStatus(true));
  qs("#refresh-api-status").addEventListener("click", () => refreshApiStatus(true));

  const toggleLight = () => {
    setLightMode(!state.lightMode);
    log(state.lightMode ? "Light mode enabled" : "Light mode disabled");
  };
  qs("#light-button").addEventListener("click", toggleLight);
  qs("#sidebar-light-button").addEventListener("click", toggleLight);

  qs("#collapse-sidebar").addEventListener("click", () => {
    document.body.classList.toggle("sidebar-collapsed");
  });

  qs("#generation-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    await generate();
  });
}

function bindControls() {
  bindNavigation();
  bindPromptAndParameters();
  bindPreviewAndGallery();
  bindRuntimeActions();
}

function bindBridgeEvents() {
  bridge.onGenerationEvent((event) => {
    if (event.type === "ready") {
      setText(els.workerState, "Ready");
    }
    if (event.type === "progress") {
      if (event.phase === "sample") {
        showInitialStepProgress(event);
        setPhase("Sampling", event.message || "");
        return;
      }
      if (event.phase === "step") {
        updateStepProgress(event);
        return;
      }
      setPhase(event.phase || "Working", event.message || "");
    }
    if (event.type === "error") {
      setPhase("Error", event.message || "Generation failed");
    }
  });
  bridge.onWorkerLog((entry) => {
    if (entry?.message) log(entry.message.trim());
  });
}

async function init() {
  setLightMode(localStorage.getItem("ideogram-light-mode") === "1");
  updateCounters();
  bindControls();
  bindBridgeEvents();
  syncInfo();
  renderRecentStrip([]);
  await refreshSystemInfo();
  await refreshApiStatus(false);
  await refreshGallery();
  setInterval(refreshSystemInfo, 5000);
  setInterval(() => refreshApiStatus(false), 5000);
}

init();
