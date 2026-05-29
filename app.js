const assetBase = "./assets/hsr-tool";
const characters = Array.isArray(window.HSR_CHARACTERS) ? window.HSR_CHARACTERS : [];
const characterById = new Map(characters.map((character) => [character.id, character]));
const coeffs = [0.2, 0.1, 0.05, 0.02];
const slotCount = 4;
const stateKey = "hsr-axis-planner-v2";
const legacyStateKey = "hsr-axis-planner-v1";
const presetsKey = "hsr-axis-planner-presets-v2";
const legacyPresetsKey = "hsr-axis-planner-presets-v1";
const layoutKey = "hsr-axis-layout-v1";

const legacyCharacterMap = {
  sparkle: "special-huohua",
  yaoguang: "special-yaoguang",
  silver999: "special-silver999",
  feiying: "special-feiying",
  trailblazer: "special-trailblazer-elation",
};

const state = loadState();

function getDefaultState() {
  return {
    slots: [
      createSlot("slot-1", "special-feiying"),
      createSlot("slot-2", "special-trailblazer-elation"),
      createSlot("slot-3", "special-huohua"),
      createSlot("slot-4", "char-1403"),
    ],
    enemySets: {
      phase1: [{ id: "enemy-1", name: "敌人 A", speed: 158 }],
      phase2: [{ id: "enemy-2", name: "二面敌人 A", speed: 158 }],
    },
    activeEnemyPhase: 1,
    supports: [],
    pullOverrides: {},
    transition: {
      enabled: false,
      phaseColumns: false,
      points: [createTransitionPoint(0)],
    },
    limit: 300,
    showAha: true,
    showTimelineSpeed: false,
  };
}

function createTransitionPoint(index = 0, overrides = {}) {
  return {
    id: overrides.id || (index === 0 ? "transition-1" : makeId("transition")),
    mode: "av",
    av: 150,
    afterEvent: 0,
    ...overrides,
  };
}

function createSlot(id, characterId = "", overrides = {}) {
  const character = getCharacter(characterId);
  return {
    id,
    characterId: character ? character.id : "",
    customName: "",
    base: character ? character.baseSpeed : 100,
    percent: 0,
    flat: 0,
    vonwacq: false,
    pullEnabled: false,
    pullTargetSlotId: "",
    pullPercent: 50,
    ...overrides,
  };
}

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(stateKey) || localStorage.getItem(legacyStateKey) || "null");
    return normalizeState(saved || getDefaultState());
  } catch {
    return normalizeState(getDefaultState());
  }
}

function normalizeState(source) {
  const base = getDefaultState();
  const next = {
    ...base,
    enemySets: clone(base.enemySets),
    transition: normalizeTransition(source?.transition || base.transition),
  };

  if (Array.isArray(source?.slots)) {
    next.slots = normalizeSlots(source.slots);
  } else if (Array.isArray(source?.selectedIds)) {
    next.slots = normalizeLegacySlots(source);
  } else {
    next.slots = normalizeSlots(base.slots);
  }

  const legacyEnemies = Array.isArray(source?.enemies) ? source.enemies : null;
  const sourceEnemySets = source?.enemySets && typeof source.enemySets === "object" ? clone(source.enemySets) : {};
  next.enemySets = {};
  Object.keys(sourceEnemySets).forEach((key) => {
    if (/^phase\d+$/.test(key) && Array.isArray(sourceEnemySets[key])) next.enemySets[key] = sourceEnemySets[key];
  });
  next.enemySets.phase1 = Array.isArray(next.enemySets.phase1) ? next.enemySets.phase1 : legacyEnemies || clone(base.enemySets.phase1);
  next.enemySets.phase2 = Array.isArray(next.enemySets.phase2) ? next.enemySets.phase2 : clone(base.enemySets.phase2);
  next.activeEnemyPhase = Math.max(1, Math.floor(numberOr(source?.activeEnemyPhase, 1)));
  next.supports = Array.isArray(source?.supports) ? source.supports : [];
  next.pullOverrides = source?.pullOverrides && typeof source.pullOverrides === "object" ? source.pullOverrides : {};
  next.limit = [150, 300, 600].includes(Number(source?.limit)) ? Number(source.limit) : 300;
  next.showAha = source?.showAha !== false;
  next.showTimelineSpeed = source?.showTimelineSpeed === true;
  next.supports = next.supports.map((support) => ({
    id: support.id || makeId("support"),
    type: "dance",
    afterEvent: Math.max(0, Math.floor(numberOr(support.afterEvent, 0))),
    percent: normalizeSupportPercent(support.percent),
  }));

  ensureEnemySets(next);
  ensureAllPullTargets(next);
  return next;
}

function normalizeTransition(source) {
  const raw = source && typeof source === "object" ? source : {};
  const legacyPoint = {
    id: "transition-1",
    mode: raw.mode,
    av: raw.av,
    afterEvent: raw.afterEvent,
  };
  const rawPoints = Array.isArray(raw.points) && raw.points.length ? raw.points : [legacyPoint];

  return {
    enabled: Boolean(raw.enabled),
    phaseColumns: Boolean(raw.phaseColumns),
    points: rawPoints.map((point, index) => normalizeTransitionPoint(point, index)),
  };
}

function normalizeTransitionPoint(point, index = 0) {
  const raw = point && typeof point === "object" ? point : {};
  return createTransitionPoint(index, {
    id: raw.id || `transition-${index + 1}`,
    mode: raw.mode === "event" ? "event" : "av",
    av: Math.max(0, numberOr(raw.av, 150)),
    afterEvent: Math.max(0, Math.floor(numberOr(raw.afterEvent, 0))),
  });
}

function normalizeSlots(slots) {
  const normalized = [];

  for (let index = 0; index < slotCount; index += 1) {
    const raw = slots[index] || {};
    normalized.push(normalizeSlot(raw, index));
  }

  return normalized;
}

function normalizeLegacySlots(source) {
  const selectedIds = source.selectedIds.slice(0, slotCount);
  const legacyToSlot = new Map(selectedIds.map((id, index) => [id, `slot-${index + 1}`]));
  const slots = selectedIds.map((legacyId, index) => {
    const cfg = source.allies?.[legacyId] || {};
    const characterId = legacyCharacterMap[legacyId] || "";
    const character = getCharacter(characterId);
    return normalizeSlot(
      {
        id: `slot-${index + 1}`,
        characterId,
        customName: character ? "" : cfg.name || "",
        base: numberOr(cfg.base, character?.baseSpeed ?? 100),
        percent: cfg.percent,
        flat: cfg.flat,
        vonwacq: cfg.vonwacq,
        pullEnabled: cfg.pullEnabled,
        pullTargetSlotId: legacyToSlot.get(cfg.pullTargetId) || "",
        pullPercent: cfg.pullPercent,
      },
      index,
    );
  });

  while (slots.length < slotCount) {
    slots.push(createSlot(`slot-${slots.length + 1}`));
  }

  return slots;
}

function normalizeSlot(raw, index) {
  const character = getCharacter(raw.characterId) || findCharacterByInput(raw.name || raw.customName || "", { fuzzy: false });
  const fallbackBase = character?.baseSpeed ?? 100;
  return {
    id: raw.id || `slot-${index + 1}`,
    characterId: character?.id || "",
    customName: character ? "" : String(raw.customName || raw.name || "").trim(),
    base: clampSpeed(numberOr(raw.base, fallbackBase)),
    percent: numberOr(raw.percent, 0),
    flat: numberOr(raw.flat, 0),
    vonwacq: Boolean(raw.vonwacq),
    pullEnabled: Boolean(raw.pullEnabled),
    pullTargetSlotId: raw.pullTargetSlotId || raw.pullTargetId || "",
    pullPercent: normalizePullPercent(raw.pullPercent),
  };
}

function ensureAllPullTargets(targetState = state) {
  for (const slot of targetState.slots || []) {
    ensurePullTarget(slot.id, targetState);
  }
}

function saveState() {
  localStorage.setItem(stateKey, JSON.stringify(state));
}

function loadPresets() {
  try {
    const stored = localStorage.getItem(presetsKey) || localStorage.getItem(legacyPresetsKey) || "[]";
    const presets = JSON.parse(stored);
    if (!Array.isArray(presets)) return [];
    return presets.map((preset) => ({
      ...preset,
      config: normalizeState(preset.config || {}),
    }));
  } catch {
    return [];
  }
}

function savePresets(presets) {
  localStorage.setItem(presetsKey, JSON.stringify(presets));
}

function replaceState(nextState) {
  for (const key of Object.keys(state)) {
    delete state[key];
  }
  Object.assign(state, normalizeState(nextState));
}

function cloneConfig() {
  return clone(state);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function numberOr(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizePullPercent(value) {
  return Number(value) === 100 ? 100 : 50;
}

function normalizeSupportPercent(value) {
  const parsed = numberOr(value, 24);
  return Math.min(100, Math.max(0, parsed));
}

function clampSpeed(value) {
  return Math.max(1, numberOr(value, 1));
}

function makeId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function phaseKey(phase = state.activeEnemyPhase) {
  return `phase${Math.max(1, Math.floor(numberOr(phase, 1)))}`;
}

function phaseName(phase) {
  const names = ["", "一面", "二面", "三面", "四面", "五面", "六面", "七面", "八面", "九面"];
  const index = Math.max(1, Math.floor(numberOr(phase, 1)));
  return names[index] || `第 ${index} 面`;
}

function defaultEnemySet(phase) {
  return [{ id: makeId("enemy"), name: `${phaseName(phase)}敌人 A`, speed: 158 }];
}

function getTransitionPoints(targetState = state) {
  const points = Array.isArray(targetState.transition?.points) ? targetState.transition.points : [];
  return points.length ? points : [createTransitionPoint(0)];
}

function getConfiguredPhaseCount(targetState = state) {
  const transitionCount = getTransitionPoints(targetState).length;
  const activePhase = Math.max(1, Math.floor(numberOr(targetState.activeEnemyPhase, 1)));
  return Math.max(2, transitionCount + 1, activePhase);
}

function ensureEnemySets(targetState = state) {
  const phaseCount = getConfiguredPhaseCount(targetState);
  for (let phase = 1; phase <= phaseCount; phase += 1) {
    const key = phaseKey(phase);
    if (!Array.isArray(targetState.enemySets[key])) targetState.enemySets[key] = defaultEnemySet(phase);
  }
}

function getCharacter(id) {
  return characterById.get(id) || null;
}

function getSlotById(id) {
  return state.slots.find((slot) => slot.id === id);
}

function getCharacterLabel(character) {
  return `${character.elementName || character.element || ""} · ${character.pathName || character.path || ""} · 基础 ${formatNumber(character.baseSpeed, 0)}`;
}

function normalizeSearch(value) {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[·\s._\-()（）]/g, "");
}

function getSearchValues(character) {
  return [character.name, ...(character.aliases || [])].filter(Boolean);
}

function isAhaEligible(character) {
  return Boolean(character && (character.path === "Elation" || character.pathName === "欢愉"));
}

function findCharacterByInput(value, options = {}) {
  const key = normalizeSearch(value);
  if (!key) return null;

  const exact = characters.filter((character) => getSearchValues(character).some((entry) => normalizeSearch(entry) === key));
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return null;

  if (!options.fuzzy || key.length < 2) return null;

  const fuzzy = characters.filter((character) => getSearchValues(character).some((entry) => normalizeSearch(entry).includes(key)));
  return fuzzy.length === 1 ? fuzzy[0] : null;
}

function applyCharacterInput(slot, value, options = {}) {
  const text = String(value || "").trim();
  if (!text) {
    slot.characterId = "";
    slot.customName = "";
    return;
  }

  const character = findCharacterByInput(text, { fuzzy: Boolean(options.fuzzy) });
  if (character) {
    const changed = slot.characterId !== character.id;
    slot.characterId = character.id;
    slot.customName = "";
    if (changed) slot.base = character.baseSpeed;
    return;
  }

  slot.characterId = "";
  slot.customName = text;
}

function getAlly(slot, index = 0) {
  const character = getCharacter(slot.characterId);
  const name = character?.name || slot.customName.trim();
  if (!name) return null;

  const base = clampSpeed(slot.base);
  const percent = numberOr(slot.percent, 0);
  const flat = numberOr(slot.flat, 0);
  const percentBase = character?.baseSpeed ?? base;
  const speed = clampSpeed(base + percentBase * (percent / 100) + flat);

  return {
    id: slot.id,
    characterId: character?.id || "",
    name,
    base,
    percentBase,
    percent,
    flat,
    speed,
    icon: character?.icon || "",
    character,
    ahaEligible: isAhaEligible(character),
    vonwacq: Boolean(slot.vonwacq),
    pullEnabled: Boolean(slot.pullEnabled),
    pullTargetSlotId: slot.pullTargetSlotId,
    pullPercent: normalizePullPercent(slot.pullPercent),
    position: index + 1,
  };
}

function getSelectedAllies() {
  return state.slots.map((slot, index) => getAlly(slot, index)).filter(Boolean);
}

function getEnemies(phase = state.activeEnemyPhase) {
  ensureEnemySets();
  return (state.enemySets[phaseKey(phase)] || [])
    .map((enemy, index) => ({
      id: enemy.id,
      name: enemy.name || `敌人 ${index + 1}`,
      speed: clampSpeed(enemy.speed),
      position: index + 1,
    }))
    .filter((enemy) => enemy.speed > 0);
}

function formatNumber(value, digits = 1) {
  const rounded = Number(value.toFixed(digits));
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}

function formatPercent(value) {
  return `${formatNumber(value * 100, 0)}%`;
}

function ensurePullTarget(sourceSlotId, targetState = state) {
  const slot = targetState.slots.find((item) => item.id === sourceSlotId);
  if (!slot) return "";

  const allies = targetState.slots
    .map((item, index) => getAlly(item, index))
    .filter(Boolean);
  const candidates = allies.filter((ally) => ally.id !== sourceSlotId);

  if (!candidates.length) {
    slot.pullTargetSlotId = "";
    return "";
  }

  if (!candidates.some((ally) => ally.id === slot.pullTargetSlotId)) {
    slot.pullTargetSlotId = candidates[0].id;
  }

  return slot.pullTargetSlotId;
}

function pullOverrideKey(phase, naturalIndex, sourceSlotId) {
  return `${phase}:${naturalIndex}:${sourceSlotId}`;
}

function getPullCandidates(sourceSlotId) {
  return getSelectedAllies().filter((ally) => ally.id !== sourceSlotId);
}

function getPullSettings(sourceSlotId, phase, naturalIndex) {
  const slot = getSlotById(sourceSlotId);
  const candidates = getPullCandidates(sourceSlotId);
  if (!slot?.pullEnabled || !candidates.length) return null;

  const key = pullOverrideKey(phase, naturalIndex, sourceSlotId);
  const override = state.pullOverrides[key] || {};
  const candidateIds = new Set(candidates.map((ally) => ally.id));
  const defaultTarget = candidateIds.has(slot.pullTargetSlotId) ? slot.pullTargetSlotId : ensurePullTarget(sourceSlotId);
  const targetId = candidateIds.has(override.targetId) ? override.targetId : defaultTarget;
  if (!targetId || targetId === sourceSlotId) return null;

  return {
    key,
    sourceId: sourceSlotId,
    targetId,
    percent: override.percent ? normalizePullPercent(override.percent) : normalizePullPercent(slot.pullPercent),
  };
}

function renderCharacterOptions() {
  const list = document.querySelector("#characterOptions");
  if (!list) return;

  const seen = new Set();
  const options = [];
  const pushOption = (value, label) => {
    const key = normalizeSearch(value);
    if (!key || seen.has(key)) return;
    seen.add(key);
    options.push(`<option value="${escapeAttr(value)}" label="${escapeAttr(label)}"></option>`);
  };

  for (const character of characters) {
    pushOption(character.name, getCharacterLabel(character));
    for (const alias of character.aliases || []) {
      if (alias === "开拓者") continue;
      pushOption(alias, `${character.name} · ${getCharacterLabel(character)}`);
    }
  }

  list.innerHTML = options.join("");
}

function renderAllies() {
  const wrap = document.querySelector("#allyControls");
  const allies = getSelectedAllies();

  wrap.innerHTML = state.slots
    .map((slot, index) => {
      const ally = getAlly(slot, index);
      const character = getCharacter(slot.characterId);
      const candidates = ally ? allies.filter((target) => target.id !== ally.id) : [];
      const pullDisabled = !ally || !candidates.length;
      const targetId = ally ? ensurePullTarget(ally.id) : "";
      const showPullTarget = Boolean(ally?.pullEnabled && !pullDisabled);
      const targetOptions = candidates.map((target) => `<option value="${target.id}" ${target.id === targetId ? "selected" : ""}>${escapeHtml(target.name)}</option>`).join("");
      const avatar = ally?.icon
        ? `<img class="avatar" src="${ally.icon}" alt="" />`
        : `<span class="avatar-fallback">${escapeHtml((ally?.name || String(index + 1)).slice(-1))}</span>`;
      const meta = character ? getCharacterLabel(character) : ally ? "自定义角色" : "未上场";
      const nameValue = character?.name || slot.customName || "";
      const finalSpeed = ally ? formatNumber(ally.speed, 1) : "-";
      const rowClass = ally ? "" : "empty-slot";

      return `
        <div class="table-row ${rowClass}" data-slot-row="${slot.id}">
          <span class="slot">${index + 1}</span>
          <div class="unit-main character-picker">
            ${avatar}
            <div class="character-fields">
              <input class="character-input" type="text" list="characterOptions" value="${escapeAttr(nameValue)}" placeholder="输入角色名或选择" data-slot-character="${slot.id}" />
            </div>
          </div>
          <input type="number" min="1" step="0.1" value="${formatNumber(slot.base, 1)}" data-slot-field="base" data-slot-id="${slot.id}" />
          <input type="number" step="0.1" value="${formatNumber(slot.percent, 1)}" data-slot-field="percent" data-slot-id="${slot.id}" />
          <input type="number" step="0.1" value="${formatNumber(slot.flat, 1)}" data-slot-field="flat" data-slot-id="${slot.id}" />
          <span class="final-speed" data-final-for="${slot.id}">${finalSpeed}</span>
          <button class="toggle-pill ${ally?.vonwacq ? "active" : ""}" type="button" data-vonwacq-id="${slot.id}" ${ally ? "" : "disabled"}>翁瓦克</button>
          <label class="mini-check" title="行动后拉条">
            <input type="checkbox" ${ally?.pullEnabled && !pullDisabled ? "checked" : ""} ${pullDisabled ? "disabled" : ""} data-pull-field="enabled" data-pull-id="${slot.id}" />
          </label>
          <div class="pull-target-cell">
            ${
              showPullTarget
                ? `<select data-pull-field="target" data-pull-id="${slot.id}">
                    ${targetOptions || '<option value="">无目标</option>'}
                  </select>
                  <select data-pull-field="percent" data-pull-id="${slot.id}">
                    <option value="50" ${slot.pullPercent === 50 ? "selected" : ""}>50%</option>
                    <option value="100" ${slot.pullPercent === 100 ? "selected" : ""}>100%</option>
                  </select>`
                : ""
            }
          </div>
          <div class="row-actions">
            <button class="icon-button" type="button" title="上移" data-move-id="${slot.id}" data-dir="-1" ${index === 0 ? "disabled" : ""}>↑</button>
            <button class="icon-button" type="button" title="下移" data-move-id="${slot.id}" data-dir="1" ${index === state.slots.length - 1 ? "disabled" : ""}>↓</button>
          </div>
        </div>
      `;
    })
    .join("");
}

function renderEnemies() {
  const wrap = document.querySelector("#enemyControls");
  ensureEnemySets();
  const enemies = state.enemySets[phaseKey()] || [];

  renderEnemyPhaseButtons();

  if (!enemies.length) {
    wrap.innerHTML = `<div class="empty-state">本面暂无敌人</div>`;
    return;
  }

  wrap.innerHTML = enemies
    .map((enemy, index) => {
      const av = 10000 / clampSpeed(enemy.speed);
      return `
        <div class="table-row" data-enemy-row="${enemy.id}">
          <span class="slot">${index + 1}</span>
          <input type="text" value="${escapeAttr(enemy.name || `敌人 ${index + 1}`)}" data-enemy-field="name" data-enemy-id="${enemy.id}" />
          <input type="number" min="1" step="0.1" value="${formatNumber(clampSpeed(enemy.speed), 1)}" data-enemy-field="speed" data-enemy-id="${enemy.id}" />
          <span class="enemy-av" data-enemy-av="${enemy.id}">${formatNumber(av, 1)}</span>
          <button class="icon-button" type="button" title="删除" data-delete-enemy="${enemy.id}">×</button>
        </div>
      `;
    })
    .join("");
}

function renderEnemyPhaseButtons() {
  const wrap = document.querySelector("#enemyPhaseTabs");
  if (!wrap) return;
  const phaseCount = getConfiguredPhaseCount();
  wrap.style.setProperty("--phase-tab-count", String(phaseCount));
  wrap.innerHTML = Array.from({ length: phaseCount }, (_, index) => {
    const phase = index + 1;
    return `<button class="mini-segment ${phase === state.activeEnemyPhase ? "active" : ""}" type="button" data-enemy-phase="${phase}">${phaseName(phase)}</button>`;
  }).join("");
}

function renderTransition() {
  document.querySelector("#transitionEnabled").checked = state.transition.enabled;
  const columnButton = document.querySelector("#togglePhaseColumns");
  if (columnButton) columnButton.classList.toggle("active", Boolean(state.transition.phaseColumns));

  const wrap = document.querySelector("#transitionControls");
  const points = getTransitionPoints();
  wrap.innerHTML = points
    .map((point, index) => {
      const fromPhase = index + 1;
      const toPhase = index + 2;
      return `
        <div class="transition-row" data-transition-row="${point.id}">
          <div class="transition-row-head">
            <div class="transition-row-title">
              <span class="transition-index">${index + 1}</span>
              <strong>${phaseName(fromPhase)} → ${phaseName(toPhase)}</strong>
            </div>
            ${points.length > 1 ? `<button class="icon-button" type="button" title="删除" data-delete-transition="${point.id}">×</button>` : ""}
          </div>
          <div class="transition-row-fields">
            <label class="control-field">
              <span>截断方式</span>
              <select data-transition-field="mode" data-transition-id="${point.id}">
                <option value="av" ${point.mode === "av" ? "selected" : ""}>固定 AV</option>
                <option value="event" ${point.mode === "event" ? "selected" : ""}>行动位置</option>
              </select>
            </label>
            <label class="control-field" ${point.mode === "av" ? "" : "hidden"}>
              <span>转面 AV</span>
              <input type="number" min="0" step="0.1" value="${formatNumber(point.av, 1)}" data-transition-field="av" data-transition-id="${point.id}" />
            </label>
            <label class="control-field" ${point.mode === "event" ? "" : "hidden"}>
              <span>第 N 动后</span>
              <input type="number" min="0" step="1" value="${point.afterEvent}" data-transition-field="afterEvent" data-transition-id="${point.id}" />
            </label>
          </div>
        </div>
      `;
    })
    .join("");
}

function renderSupports() {
  const wrap = document.querySelector("#supportControls");
  if (!state.supports.length) {
    wrap.innerHTML = `<div class="empty-state">暂无拉条插件</div>`;
    return;
  }

  wrap.innerHTML = state.supports
    .map(
      (support) => `
      <div class="support-row" draggable="true" data-drag-support-id="${support.id}" data-support-row="${support.id}" title="拖入行动轴">
        <div class="support-name"><span class="support-badge">舞</span><span>舞舞舞</span></div>
        <input type="number" min="0" max="100" step="1" value="${formatNumber(normalizeSupportPercent(support.percent), 0)}" title="拉条百分比" data-support-field="percent" data-support-id="${support.id}" />
        <input type="number" min="0" step="1" value="${Math.max(0, Math.floor(numberOr(support.afterEvent, 0)))}" title="触发在第 N 个行动后，0 为开局" data-support-field="afterEvent" data-support-id="${support.id}" />
        <button class="icon-button" type="button" title="删除" data-delete-support="${support.id}">×</button>
      </div>
    `,
    )
    .join("");
}

function computeAha() {
  const eligible = getSelectedAllies()
    .filter((ally) => ally.ahaEligible)
    .sort((a, b) => b.speed - a.speed || a.position - b.position)
    .slice(0, 4);

  const parts = eligible.map((ally, index) => ({
    ...ally,
    coefficient: coeffs[index],
    contribution: ally.speed * coeffs[index],
  }));

  const speed = 80 + parts.reduce((sum, part) => sum + part.contribution, 0);
  return { speed, parts };
}

function renderAha() {
  const aha = computeAha();
  document.querySelector("#ahaSpeed").textContent = formatNumber(aha.speed, 1);
  document.querySelector("#showAha").checked = state.showAha;
  document.querySelector("#ahaDetail").innerHTML = aha.parts.length
    ? aha.parts
        .map(
          (part, index) => `
          <div class="aha-line">
            <span>#${index + 1}</span>
            <strong>${escapeHtml(part.name)}</strong>
            <span>${formatNumber(part.speed, 1)}</span>
            <span>${formatPercent(part.coefficient)}</span>
            <span>+${formatNumber(part.contribution, 1)}</span>
          </div>
        `,
        )
        .join("")
    : `<div class="empty-state">当前没有计入阿哈公式的角色</div>`;
}

function actorPriority(actor) {
  if (actor.type === "ally") return actor.position;
  if (actor.type === "aha") return 60;
  if (actor.type === "enemy") return 100 + actor.position;
  return 999;
}

function makeActors({ phase, startAt, useVonwacq }) {
  const allies = getSelectedAllies().map((ally) => {
    const period = 10000 / ally.speed;
    return {
      ...ally,
      uid: `ally:${ally.id}`,
      type: "ally",
      period,
      nextAt: startAt + period * (useVonwacq && ally.vonwacq ? 0.6 : 1),
      cycle: 1,
    };
  });

  const enemies = getEnemies(phase).map((enemy) => {
    const period = 10000 / enemy.speed;
    return {
      ...enemy,
      uid: `enemy:${enemy.id}`,
      type: "enemy",
      icon: "",
      period,
      nextAt: startAt + period,
      cycle: 1,
    };
  });

  const actors = [...allies, ...enemies];
  const aha = computeAha();

  if (state.showAha && aha.speed > 0) {
    const period = 10000 / aha.speed;
    actors.push({
      uid: "aha",
      id: "aha",
      type: "aha",
      name: "阿哈时刻",
      icon: `${assetBase}/IconHead_202002.png`,
      speed: aha.speed,
      period,
      nextAt: startAt + period,
      cycle: 1,
      position: 1,
    });
  }

  return actors;
}

function applyRolePull(actor, actors, currentAv, phase, naturalIndex) {
  if (actor.type !== "ally") return null;
  const setting = getPullSettings(actor.id, phase, naturalIndex);
  if (!setting) return null;
  const target = actors.find((item) => item.type === "ally" && item.id === setting.targetId);
  if (!target) return null;

  target.nextAt = Math.max(currentAv, target.nextAt - target.period * (setting.percent / 100));
  return {
    key: setting.key,
    sourceId: actor.id,
    targetId: setting.targetId,
    targetName: target.name,
    percent: setting.percent,
  };
}

function getTransitionConfig() {
  return {
    enabled: Boolean(state.transition.enabled),
    phaseColumns: Boolean(state.transition.phaseColumns),
    points: getTransitionPoints().map((point, index) => normalizeTransitionPoint(point, index)),
  };
}

function buildTimeline() {
  const timeline = [];
  const appliedSupportIds = new Set();
  const limit = state.limit;
  const transition = getTransitionConfig();
  const transitionPoints = transition.enabled ? transition.points : [];
  let transitionIndex = 0;
  let naturalCount = 0;
  let phaseNaturalCount = 0;
  let phase = 1;
  let phaseStartAt = 0;
  let actors = makeActors({ phase, startAt: phaseStartAt, useVonwacq: true });

  const phaseAv = (absoluteAv) => Math.max(0, absoluteAv - phaseStartAt);
  const pendingTransition = () => transitionPoints[transitionIndex] || null;

  const applySupports = (afterEvent, currentAv) => {
    const normalizedAfterEvent = Math.max(0, Math.floor(numberOr(afterEvent, 0)));
    const matches = state.supports
      .filter((support) => Math.max(0, Math.floor(numberOr(support.afterEvent, 0))) === normalizedAfterEvent)
      .sort((a, b) => a.id.localeCompare(b.id));

    for (const support of matches) {
      if (appliedSupportIds.has(support.id) || phaseAv(currentAv) - limit > 1e-8) continue;
      appliedSupportIds.add(support.id);
      timeline.push({
        type: "support",
        supportId: support.id,
        name: "舞舞舞",
        speed: 0,
        av: phaseAv(currentAv),
        absoluteAv: currentAv,
        detail: `全队提前 ${formatNumber(normalizeSupportPercent(support.percent), 0)}%`,
        afterEvent: normalizedAfterEvent,
        percent: normalizeSupportPercent(support.percent),
        naturalIndex: normalizedAfterEvent,
        phase,
      });

      for (const actor of actors) {
        if (actor.type !== "ally") continue;
        actor.nextAt = Math.max(currentAv, actor.nextAt - actor.period * (normalizeSupportPercent(support.percent) / 100));
      }
    }
  };

  const doTransition = (av) => {
    const point = pendingTransition();
    if (!point) return;
    const fromPhase = phase;
    const toPhase = phase + 1;
    const sourceAv = phaseAv(av);
    timeline.push({
      type: "phase",
      name: `转面 ${transitionIndex + 1}`,
      speed: 0,
      av: 0,
      absoluteAv: av,
      sourceAv,
      detail: `${phaseName(toPhase)}开始，上一面 AV ${formatNumber(sourceAv, 1)}`,
      naturalIndex: naturalCount,
      phase: toPhase,
      fromPhase,
      toPhase,
      transitionIndex,
    });
    transitionIndex += 1;
    phase = toPhase;
    phaseStartAt = av;
    phaseNaturalCount = 0;
    actors = makeActors({ phase, startAt: phaseStartAt, useVonwacq: false });
  };

  const applyImmediateTransitions = () => {
    for (let guard = 0; guard < transitionPoints.length; guard += 1) {
      const point = pendingTransition();
      if (!point) return;
      if (point.mode === "av" && point.av <= 0) {
        doTransition(phaseStartAt);
        continue;
      }
      if (point.mode === "event" && point.afterEvent <= 0) {
        doTransition(phaseStartAt);
        continue;
      }
      return;
    }
  };

  applyImmediateTransitions();

  applySupports(0, 0);

  for (let guard = 0; guard < 1200; guard += 1) {
    if (!actors.length) break;
    actors.sort((a, b) => a.nextAt - b.nextAt || actorPriority(a) - actorPriority(b));
    const actor = actors[0];
    const currentAv = actor.nextAt;
    const currentPhaseAv = phaseAv(currentAv);
    const point = pendingTransition();

    if (point?.mode === "av" && point.av <= limit && currentPhaseAv >= point.av - 1e-8) {
      doTransition(phaseStartAt + point.av);
      applyImmediateTransitions();
      continue;
    }

    if (currentPhaseAv - limit > 1e-8) break;

    const eventNaturalIndex = naturalCount + 1;
    const eventPhaseNaturalIndex = phaseNaturalCount + 1;
    const event = {
      type: actor.type,
      id: actor.id,
      name: actor.name,
      icon: actor.icon,
      speed: actor.speed,
      av: currentPhaseAv,
      absoluteAv: currentAv,
      cycle: actor.cycle,
      position: actor.position,
      vonwacq: actor.vonwacq,
      naturalIndex: eventNaturalIndex,
      phaseNaturalIndex: eventPhaseNaturalIndex,
      phase,
    };
    timeline.push(event);

    naturalCount += 1;
    phaseNaturalCount += 1;
    actor.cycle += 1;
    actor.nextAt = currentAv + actor.period;
    event.pull = applyRolePull(actor, actors, currentAv, phase, eventPhaseNaturalIndex);
    event.detailExtra = event.pull ? `拉条 ${event.pull.targetName} ${event.pull.percent}%` : "";

    const nextPoint = pendingTransition();
    if (nextPoint?.mode === "event" && phaseNaturalCount >= nextPoint.afterEvent) {
      doTransition(currentAv);
      applyImmediateTransitions();
    }

    applySupports(naturalCount, currentAv);
  }

  return timeline.filter((event) => event.av <= limit + 1e-8);
}

function renderEventPullControl(event) {
  if (!event.pull) return "";
  const candidates = getPullCandidates(event.id);
  if (!candidates.length) return "";
  const targetOptions = candidates
    .map((target) => `<option value="${target.id}" ${target.id === event.pull.targetId ? "selected" : ""}>${escapeHtml(target.name)}</option>`)
    .join("");
  return `
    <span class="inline-pull">
      <span>拉条</span>
      <select data-event-pull-field="target" data-event-pull-key="${event.pull.key}">
        ${targetOptions}
      </select>
      <select data-event-pull-field="percent" data-event-pull-key="${event.pull.key}">
        <option value="50" ${event.pull.percent === 50 ? "selected" : ""}>50%</option>
        <option value="100" ${event.pull.percent === 100 ? "selected" : ""}>100%</option>
      </select>
    </span>
  `;
}

function renderTimelineSub(event) {
  if (event.type === "support") return `${escapeHtml(event.detail)} · 第 ${event.afterEvent} 动后`;
  if (event.type === "phase") return escapeHtml(event.detail);
  if (event.type === "enemy") return `${phaseName(event.phase)}敌人 · 第 ${event.cycle} 动`;
  if (event.type === "aha") return `第 ${event.cycle} 次`;
  if (event.type === "ally") {
    const pieces = [`第 ${event.cycle} 动`];
    if (event.vonwacq && event.cycle === 1 && event.phase === 1) pieces.push("翁瓦克");
    return `${pieces.map(escapeHtml).join(" · ")}${renderEventPullControl(event)}`;
  }
  return "";
}

function renderTimeline() {
  const timeline = buildTimeline();
  const wrap = document.querySelector("#timeline");
  document.querySelector("#axisMeta").textContent = `${state.transition.enabled ? "每面 " : ""}上限 ${state.limit} AV，共 ${timeline.length} 项`;
  document.querySelector("#showTimelineSpeed").checked = state.showTimelineSpeed;
  wrap.classList.toggle("show-speed", state.showTimelineSpeed);
  wrap.classList.toggle("phase-columns", Boolean(state.transition.enabled && state.transition.phaseColumns));

  if (!timeline.length) {
    wrap.innerHTML = `<div class="empty-state">没有可显示的行动</div>`;
    return;
  }

  if (state.transition.enabled && state.transition.phaseColumns) {
    renderTimelineColumns(wrap, timeline);
    return;
  }

  wrap.innerHTML = renderTimelineRows(timeline, {});
}

function renderTimelineColumns(wrap, timeline) {
  const phaseCount = Math.max(...timeline.map((event) => Math.max(1, Math.floor(numberOr(event.phase, 1)))));
  const columns = [];

  for (let phase = 1; phase <= phaseCount; phase += 1) {
    const events = timeline.filter((event) => event.phase === phase);
    if (!events.length && phase > 1) continue;
    const lastEvent = events.filter((event) => event.type !== "phase").at(-1);
    columns.push(`
      <section class="timeline-column ${phase > 1 ? "after-transition-column" : ""}">
        <div class="timeline-column-head">
          <strong>${phaseName(phase)}</strong>
          <span>${lastEvent ? `至 ${formatNumber(lastEvent.av, 1)} AV` : "0 AV"}</span>
        </div>
        ${renderTimelineRows(events, {})}
      </section>
    `);
  }

  wrap.innerHTML = `<div class="timeline-columns" style="--timeline-column-count: ${columns.length}">${columns.join("")}</div>`;
}

function renderTimelineRows(events, orderByPhase) {
  return events.map((event) => renderTimelineRow(event, orderByPhase)).join("");
}

function renderTimelineRow(event, orderByPhase) {
  const phase = Math.max(1, Math.floor(numberOr(event.phase, 1)));
  const orderText =
    event.type === "phase"
      ? "转"
      : (() => {
          orderByPhase[phase] = (orderByPhase[phase] || 0) + 1;
          return orderByPhase[phase];
        })();
  const avatar = event.icon
    ? `<img class="avatar" src="${event.icon}" alt="" />`
    : `<span class="avatar-fallback">${event.type === "enemy" ? "敌" : event.type === "support" ? "舞" : event.type === "phase" ? "转" : event.name.slice(-1)}</span>`;
  const dragAttrs = event.type === "support" ? `draggable="true" data-drag-support-id="${event.supportId}"` : "";
  const phaseClass = phase > 1 ? "after-transition" : "before-transition";
  const boundaryClass = event.type === "phase" ? "phase-boundary" : "";
  const phaseToneClass = phase % 2 === 0 ? "phase-even" : "phase-odd";
  return `
    <div class="timeline-row ${event.type} ${phaseClass} ${phaseToneClass} ${boundaryClass}" ${dragAttrs} data-drop-index="${event.naturalIndex ?? 0}">
      <span class="timeline-order">${orderText}</span>
      ${avatar}
      <div class="timeline-name">
        <div class="timeline-title">${escapeHtml(event.name)}</div>
        <div class="timeline-sub">${renderTimelineSub(event)}</div>
      </div>
      <span class="timeline-av">${formatNumber(event.av, 1)}</span>
      <span class="timeline-speed">${event.speed ? formatNumber(event.speed, 1) : ""}</span>
    </div>
  `;
}

function refreshComputed() {
  state.slots.forEach((slot, index) => {
    const ally = getAlly(slot, index);
    const el = document.querySelector(`[data-final-for="${slot.id}"]`);
    if (el) el.textContent = ally ? formatNumber(ally.speed, 1) : "-";
  });

  for (const enemy of getEnemies()) {
    const el = document.querySelector(`[data-enemy-av="${enemy.id}"]`);
    if (el) el.textContent = formatNumber(10000 / enemy.speed, 1);
  }

  renderAha();
  renderTimeline();
  saveState();
}

function renderConfigManager() {
  const select = document.querySelector("#configSelect");
  if (!select) return;
  const presets = loadPresets();
  select.innerHTML = presets.length
    ? presets.map((preset) => `<option value="${preset.id}">${escapeHtml(preset.name)}</option>`).join("")
    : '<option value="">暂无已保存方案</option>';
}

function renderAll() {
  ensureEnemySets();
  ensureAllPullTargets();
  renderCharacterOptions();
  renderAllies();
  renderEnemies();
  renderTransition();
  renderSupports();
  renderConfigManager();
  updateLimitButtons();
  refreshComputed();
}

function initWorkspaceResizer() {
  const workspace = document.querySelector(".workspace");
  const resizer = document.querySelector("#workspaceResizer");
  if (!workspace || !resizer || !resizer.addEventListener) return;
  const leftColumn = workspace.querySelector?.(".config-column");
  if (!leftColumn) return;

  const applyWidth = (rawWidth) => {
    const rect = workspace.getBoundingClientRect();
    if (!rect.width || rect.width < 900) return;
    const handleWidth = 8;
    const minLeft = 520;
    const minRight = 300;
    const maxLeft = rect.width - minRight - handleWidth - 24;
    const width = Math.max(minLeft, Math.min(maxLeft, rawWidth));
    workspace.style.gridTemplateColumns = `${Math.round(width)}px ${handleWidth}px minmax(${minRight}px, 1fr)`;
    localStorage.setItem(layoutKey, String(Math.round(width)));
  };

  const restore = () => {
    if (window.innerWidth <= 1320) {
      workspace.style.gridTemplateColumns = "";
      return;
    }
    const saved = Number(localStorage.getItem(layoutKey));
    if (Number.isFinite(saved) && saved > 0) applyWidth(saved);
  };

  restore();

  resizer.addEventListener("pointerdown", (event) => {
    if (window.innerWidth <= 1320) return;
    event.preventDefault();
    const startX = event.clientX;
    const startLeft = leftColumn.getBoundingClientRect().width;
    workspace.classList.add("resizing");

    const move = (moveEvent) => {
      applyWidth(startLeft + moveEvent.clientX - startX);
    };

    const stop = () => {
      workspace.classList.remove("resizing");
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
  });

  if (window.addEventListener) {
    window.addEventListener("resize", restore);
  }
}

function updateLimitButtons() {
  document.querySelectorAll("[data-limit]").forEach((button) => {
    button.classList.toggle("active", Number(button.dataset.limit) === state.limit);
  });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll("`", "&#096;");
}

document.addEventListener("click", (event) => {
  const vonwacqButton = event.target.closest("[data-vonwacq-id]");
  if (vonwacqButton) {
    const slot = getSlotById(vonwacqButton.dataset.vonwacqId);
    if (!slot) return;
    slot.vonwacq = !slot.vonwacq;
    renderAllies();
    refreshComputed();
    return;
  }

  const moveButton = event.target.closest("[data-move-id]");
  if (moveButton) {
    const id = moveButton.dataset.moveId;
    const dir = Number(moveButton.dataset.dir);
    const index = state.slots.findIndex((slot) => slot.id === id);
    const nextIndex = index + dir;
    if (index >= 0 && nextIndex >= 0 && nextIndex < state.slots.length) {
      const [slot] = state.slots.splice(index, 1);
      state.slots.splice(nextIndex, 0, slot);
      renderAll();
    }
    return;
  }

  const deleteEnemy = event.target.closest("[data-delete-enemy]");
  if (deleteEnemy) {
    const key = phaseKey();
    state.enemySets[key] = state.enemySets[key].filter((enemy) => enemy.id !== deleteEnemy.dataset.deleteEnemy);
    renderAll();
    return;
  }

  const deleteSupport = event.target.closest("[data-delete-support]");
  if (deleteSupport) {
    state.supports = state.supports.filter((support) => support.id !== deleteSupport.dataset.deleteSupport);
    renderAll();
    return;
  }

  const deleteTransition = event.target.closest("[data-delete-transition]");
  if (deleteTransition && getTransitionPoints().length > 1) {
    state.transition.points = getTransitionPoints().filter((point) => point.id !== deleteTransition.dataset.deleteTransition);
    if (state.activeEnemyPhase > getConfiguredPhaseCount()) state.activeEnemyPhase = getConfiguredPhaseCount();
    renderAll();
    return;
  }

  if (event.target.closest("#addTransition")) {
    const points = getTransitionPoints();
    state.transition.enabled = true;
    state.transition.points = [...points, createTransitionPoint(points.length)];
    ensureEnemySets();
    renderAll();
    return;
  }

  if (event.target.closest("#togglePhaseColumns")) {
    state.transition.phaseColumns = !state.transition.phaseColumns;
    renderTransition();
    refreshComputed();
    return;
  }

  const limitButton = event.target.closest("[data-limit]");
  if (limitButton) {
    state.limit = Number(limitButton.dataset.limit);
    updateLimitButtons();
    refreshComputed();
    return;
  }

  const enemyPhaseButton = event.target.closest("[data-enemy-phase]");
  if (enemyPhaseButton) {
    state.activeEnemyPhase = Math.max(1, Math.floor(numberOr(enemyPhaseButton.dataset.enemyPhase, 1)));
    ensureEnemySets();
    renderEnemies();
    refreshComputed();
  }
});

document.addEventListener("input", (event) => {
  const target = event.target;

  if (target.matches("[data-slot-field]")) {
    const slot = getSlotById(target.dataset.slotId);
    if (!slot) return;
    const field = target.dataset.slotField;
    slot[field] = numberOr(target.value, field === "base" ? 1 : 0);
    refreshComputed();
    return;
  }

  if (target.matches("[data-enemy-field]")) {
    const enemy = (state.enemySets[phaseKey()] || []).find((item) => item.id === target.dataset.enemyId);
    if (!enemy) return;
    const field = target.dataset.enemyField;
    enemy[field] = field === "name" ? target.value : numberOr(target.value, 1);
    refreshComputed();
    return;
  }

  if (target.matches("[data-support-field]")) {
    const support = state.supports.find((item) => item.id === target.dataset.supportId);
    if (!support) return;
    if (target.dataset.supportField === "percent") {
      support.percent = normalizeSupportPercent(target.value);
    } else {
      support.afterEvent = Math.max(0, Math.floor(numberOr(target.value, 0)));
    }
    refreshComputed();
    return;
  }

  if (target.matches("[data-transition-field]")) {
    const point = getTransitionPoints().find((item) => item.id === target.dataset.transitionId);
    if (!point) return;
    if (target.dataset.transitionField === "av") point.av = Math.max(0, numberOr(target.value, 150));
    if (target.dataset.transitionField === "afterEvent") point.afterEvent = Math.max(0, Math.floor(numberOr(target.value, 0)));
    refreshComputed();
  }
});

document.addEventListener("change", (event) => {
  const target = event.target;

  if (target.matches("[data-slot-character]")) {
    const slot = getSlotById(target.dataset.slotCharacter);
    if (!slot) return;
    applyCharacterInput(slot, target.value, { fuzzy: true });
    renderAll();
    return;
  }

  if (target.matches("[data-pull-field]")) {
    const slot = getSlotById(target.dataset.pullId);
    if (!slot) return;
    const field = target.dataset.pullField;
    if (field === "enabled") slot.pullEnabled = target.checked;
    if (field === "target") slot.pullTargetSlotId = target.value;
    if (field === "percent") slot.pullPercent = normalizePullPercent(target.value);
    renderAllies();
    refreshComputed();
    return;
  }

  if (target.matches("[data-event-pull-field]")) {
    const key = target.dataset.eventPullKey;
    if (!state.pullOverrides[key]) state.pullOverrides[key] = {};
    if (target.dataset.eventPullField === "target") {
      state.pullOverrides[key].targetId = target.value;
    }
    if (target.dataset.eventPullField === "percent") {
      state.pullOverrides[key].percent = normalizePullPercent(target.value);
    }
    refreshComputed();
    return;
  }

  if (target.id === "showAha") {
    state.showAha = target.checked;
    refreshComputed();
    return;
  }

  if (target.id === "showTimelineSpeed") {
    state.showTimelineSpeed = target.checked;
    refreshComputed();
    return;
  }

  if (target.id === "transitionEnabled") {
    state.transition.enabled = target.checked;
    if (!getTransitionPoints().length) state.transition.points = [createTransitionPoint(0)];
    renderAll();
    return;
  }

  if (target.matches("[data-transition-field]") && target.dataset.transitionField === "mode") {
    const point = getTransitionPoints().find((item) => item.id === target.dataset.transitionId);
    if (!point) return;
    point.mode = target.value === "event" ? "event" : "av";
    renderAll();
  }
});

document.querySelector("#addEnemy").addEventListener("click", () => {
  const key = phaseKey();
  ensureEnemySets();
  state.enemySets[key].push({
    id: makeId("enemy"),
    name: `${phaseName(state.activeEnemyPhase)}敌人 ${state.enemySets[key].length + 1}`,
    speed: 100,
  });
  renderAll();
});

document.querySelector("#addSupport").addEventListener("click", () => {
  state.supports.push({
    id: makeId("support"),
    type: "dance",
    afterEvent: 0,
    percent: 24,
  });
  renderAll();
});

document.querySelector("#saveConfig").addEventListener("click", () => {
  const nameInput = document.querySelector("#configName");
  const name = nameInput.value.trim() || `方案 ${new Date().toLocaleString("zh-CN", { hour12: false })}`;
  const presets = loadPresets();
  const existing = presets.find((preset) => preset.name === name);
  const preset = {
    id: existing?.id || makeId("preset"),
    name,
    savedAt: Date.now(),
    config: cloneConfig(),
  };
  const nextPresets = existing ? presets.map((item) => (item.id === existing.id ? preset : item)) : [...presets, preset];
  savePresets(nextPresets);
  nameInput.value = name;
  renderConfigManager();
  document.querySelector("#configSelect").value = preset.id;
});

document.querySelector("#loadConfig").addEventListener("click", () => {
  const presetId = document.querySelector("#configSelect").value;
  const preset = loadPresets().find((item) => item.id === presetId);
  if (!preset) return;
  replaceState(preset.config);
  document.querySelector("#configName").value = preset.name;
  renderAll();
});

document.querySelector("#deleteConfig").addEventListener("click", () => {
  const presetId = document.querySelector("#configSelect").value;
  if (!presetId) return;
  savePresets(loadPresets().filter((item) => item.id !== presetId));
  renderConfigManager();
});

document.addEventListener("dragstart", (event) => {
  const newDance = event.target.closest("[data-drag-dance]");
  const existingDance = event.target.closest("[data-drag-support-id]");
  const payload = newDance
    ? { kind: "dance-new" }
    : existingDance
      ? { kind: "dance-existing", id: existingDance.dataset.dragSupportId }
      : null;

  if (!payload) return;
  event.dataTransfer.effectAllowed = payload.kind === "dance-new" ? "copy" : "move";
  event.dataTransfer.setData("application/json", JSON.stringify(payload));
});

document.addEventListener("dragover", (event) => {
  const target = event.target.closest("[data-drop-index], #timeline");
  if (!target) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = "move";
  const row = event.target.closest("[data-drop-index]");
  if (row) row.classList.add("drop-target");
});

document.addEventListener("dragleave", (event) => {
  const row = event.target.closest("[data-drop-index]");
  if (row) row.classList.remove("drop-target");
});

document.addEventListener("drop", (event) => {
  const target = event.target.closest("[data-drop-index], #timeline");
  if (!target) return;
  event.preventDefault();
  document.querySelectorAll(".drop-target").forEach((row) => row.classList.remove("drop-target"));

  let payload = null;
  try {
    payload = JSON.parse(event.dataTransfer.getData("application/json") || "null");
  } catch {
    payload = null;
  }
  if (!payload) return;

  const row = event.target.closest("[data-drop-index]");
  const afterEvent = Math.max(0, Math.floor(numberOr(row?.dataset.dropIndex, 0)));

  if (payload.kind === "dance-new") {
    state.supports.push({ id: makeId("support"), type: "dance", afterEvent, percent: 24 });
  }

  if (payload.kind === "dance-existing") {
    const support = state.supports.find((item) => item.id === payload.id);
    if (support) support.afterEvent = afterEvent;
  }

  renderAll();
});

document.addEventListener("dragend", () => {
  document.querySelectorAll(".drop-target").forEach((row) => row.classList.remove("drop-target"));
});

renderAll();
initWorkspaceResizer();


