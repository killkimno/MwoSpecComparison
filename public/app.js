const COMPONENT_ORDER = [
  "head",
  "left_arm",
  "left_torso",
  "centre_torso",
  "right_torso",
  "right_arm",
  "left_leg",
  "right_leg",
];

const REAR_ARMOR_COMPONENTS = [
  "left_torso_rear",
  "centre_torso_rear",
  "right_torso_rear",
];

const COMPONENT_NAMES = {
  head: "Head",
  left_arm: "Left Arm",
  left_torso: "Left Torso",
  centre_torso: "Center Torso",
  right_torso: "Right Torso",
  right_arm: "Right Arm",
  left_leg: "Left Leg",
  right_leg: "Right Leg",
};

const INFO_COMPONENTS = [
  { key: "head", label: "머리", suffix: "hd" },
  { key: "centre_torso", label: "몸통", suffix: "ct", rearSuffix: "ctr" },
  { key: "left_torso", label: "왼쪽 어깨", suffix: "lt", rearSuffix: "ltr" },
  { key: "right_torso", label: "오른쪽 어깨", suffix: "rt", rearSuffix: "rtr" },
  { key: "left_arm", label: "왼쪽 팔", suffix: "la" },
  { key: "right_arm", label: "오른쪽 팔", suffix: "ra" },
  { key: "left_leg", label: "왼쪽 다리", suffix: "ll" },
  { key: "right_leg", label: "오른쪽 다리", suffix: "rl" },
];

const WEIGHT_CLASS_ORDER = ["light", "medium", "heavy", "assault"];

const WEIGHT_CLASS_LABELS = {
  light: "Light",
  medium: "Medium",
  heavy: "Heavy",
  assault: "Assault",
};

const state = {
  index: null,
  mechs: [],
  equipment: null,
  loadouts: {},
  omnipods: {},
  activeMainTab: "mechlab",
  infoApplyQuirks: true,
  selectedMech: null,
  selectedChassis: "",
  selectedItemId: null,
  currentBuild: null,
};

const $ = (id) => document.getElementById(id);

function number(value, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function fmt(value, digits = 1) {
  const numeric = number(value);
  return Number.isInteger(numeric) ? `${numeric}` : numeric.toFixed(digits);
}

function itemById(id) {
  return state.equipment?.items?.[String(id)] || null;
}

function itemName(id) {
  const item = itemById(id);
  return item ? item.display_name || item.name : `Item ${id}`;
}

function itemSlots(item) {
  return number(item?.stats?.slots);
}

function itemTons(item) {
  return number(item?.stats?.tons ?? item?.stats?.weight);
}

function itemHeat(item) {
  return number(item?.stats?.heat);
}

function quirkValueText(name, value) {
  const numeric = number(value, null);
  if (numeric === null) return `${value}`;
  if (name.endsWith("_multiplier")) return `${numeric * 100 > 0 ? "+" : ""}${(numeric * 100).toFixed(1).replace(/\\.0$/, "")}%`;
  if (name.endsWith("_additive")) return `${numeric > 0 ? "+" : ""}${numeric}`;
  return `${numeric > 0 ? "+" : ""}${numeric}`;
}

function isHeatSink(item) {
  return item?.ctype === "CHeatSinkStats" || String(item?.name || "").toLowerCase().includes("heatsink");
}

function hardpointBadges(definition) {
  const counts = {};
  Object.values(definition?.components || {}).forEach((component) => {
    (component.hardpoints || []).forEach((hp) => {
      const type = hp.hardpoint_type;
      counts[type] = (counts[type] || 0) + 1;
    });
  });
  return Object.entries(counts)
    .filter(([type]) => ["ballistic", "energy", "missile", "ams", "ecm"].includes(type))
    .map(([type, count]) => `<span class="badge ${type}">${type[0].toUpperCase()} ${count}</span>`)
    .join("");
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function formatChassisName(chassis) {
  return String(chassis || "Unknown")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function variantCode(mech) {
  return mech?.definition?.stats?.Variant || String(mech?.name || "").toUpperCase();
}

function chassisDisplayName(variants) {
  const mech = variants[0];
  if (!mech) return "Unknown";
  const display = mech.display_name || formatChassisName(mech.chassis);
  const variant = variantCode(mech);
  const stripped = display.replace(new RegExp(`\\s*${escapeRegex(variant)}\\s*$`, "i"), "").trim();
  return stripped || formatChassisName(mech.chassis);
}

function sortMechsByVariant(a, b) {
  return variantCode(a).localeCompare(variantCode(b), undefined, { numeric: true });
}

function groupMechsForList(mechs) {
  const groups = new Map();
  for (const mech of mechs) {
    const weightClass = mech.weight_class || "unknown";
    const chassis = mech.chassis || "unknown";
    if (!groups.has(weightClass)) groups.set(weightClass, new Map());
    const classGroup = groups.get(weightClass);
    if (!classGroup.has(chassis)) classGroup.set(chassis, []);
    classGroup.get(chassis).push(mech);
  }
  return groups;
}

function buildFromLoadout(mech) {
  const loadout = state.loadouts[mech.stock_loadout] || {};
  const components = {};
  for (const name of COMPONENT_ORDER) {
    const component = loadout.components?.[name] || {};
    components[name] = {
      armor: number(component.armor),
      items: (component.items || []).map((entry) => ({ ...entry })),
    };
  }
  const rearArmor = REAR_ARMOR_COMPONENTS.reduce((sum, name) => {
    return sum + number(loadout.components?.[name]?.armor);
  }, 0);
  return {
    mechId: mech.id,
    loadoutName: mech.stock_loadout,
    components,
    rearArmor,
    upgrades: JSON.parse(JSON.stringify(loadout.upgrades || {})),
  };
}

function savedKey(mech) {
  return `local-mwo-build:${mech.name}`;
}

function loadBuild(mech) {
  const saved = localStorage.getItem(savedKey(mech));
  if (saved) {
    try {
      return JSON.parse(saved);
    } catch {
      localStorage.removeItem(savedKey(mech));
    }
  }
  return buildFromLoadout(mech);
}

function currentDefinition() {
  return state.selectedMech?.definition || {};
}

function setMainTab(tabName) {
  state.activeMainTab = tabName;
  document.querySelectorAll("[data-main-tab]").forEach((button) => {
    const active = button.dataset.mainTab === tabName;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });
  document.querySelectorAll(".tab-panel").forEach((panel) => {
    const active = panel.id === `tab-${tabName}`;
    panel.hidden = !active;
    panel.classList.toggle("active", active);
  });
  $("mech-browser-layout").hidden = tabName === "stats";
  $("summary-strip").hidden = tabName !== "mechlab";
}

function addQuirk(collector, quirk, source) {
  if (!quirk?.name) return;
  const key = quirk.name;
  if (!collector.has(key)) {
    collector.set(key, {
      name: quirk.name,
      display_name: quirk.display_name || quirk.name,
      value: 0,
      sources: new Set(),
    });
  }
  const entry = collector.get(key);
  entry.value += number(quirk.value);
  if (source) entry.sources.add(source);
}

function effectiveQuirks() {
  const collector = new Map();
  const definition = currentDefinition();
  (definition.quirks || []).forEach((quirk) => addQuirk(collector, quirk, "Variant"));

  const setCounts = {};
  const setBonuses = {};
  for (const [component, buildComponent] of Object.entries(state.currentBuild?.components || {})) {
    const podId = buildComponent.omnipod;
    if (!podId) continue;
    const pod = state.omnipods[String(podId)];
    if (!pod) continue;
    (pod.quirks || []).forEach((quirk) => addQuirk(collector, quirk, COMPONENT_NAMES[component] || "Omnipod"));
    if (pod.set) {
      setCounts[pod.set] = (setCounts[pod.set] || 0) + 1;
      setBonuses[pod.set] = pod.set_bonuses || [];
    }
  }

  for (const [setName, count] of Object.entries(setCounts)) {
    for (const bonus of setBonuses[setName] || []) {
      if (count >= number(bonus.piece_count)) {
        (bonus.quirks || []).forEach((quirk) => addQuirk(collector, quirk, `${setName.toUpperCase()} ${bonus.piece_count}pc`));
      }
    }
  }

  return Array.from(collector.values())
    .map((quirk) => ({
      ...quirk,
      value_text: quirkValueText(quirk.name, quirk.value),
      source_text: Array.from(quirk.sources).join(", "),
    }))
    .sort((a, b) => a.display_name.localeCompare(b.display_name));
}

function effectiveQuirkValues() {
  const values = {};
  effectiveQuirks().forEach((quirk) => {
    values[quirk.name.toLowerCase()] = number(quirk.value);
  });
  return values;
}

function quirkAdd(values, prefix, suffix) {
  return number(values[`${prefix}_all_additive`]) + number(values[`${prefix}_${suffix}_additive`]);
}

function quirkMultiplier(values, names) {
  return 1 + names.reduce((sum, name) => sum + number(values[name]), 0);
}

function baseMaxArmor(componentName) {
  if (componentName === "head") return 18;
  return number(currentDefinition().components?.[componentName]?.hp) * 2;
}

function armorInfoRows(values) {
  return INFO_COMPONENTS.map((component) => {
    const frontBase = baseMaxArmor(component.key);
    const front = frontBase + quirkAdd(values, "armorresist", component.suffix);
    const rearBase = 0;
    const rear = component.rearSuffix ? rearBase + number(values[`armorresist_${component.rearSuffix}_additive`]) : null;
    return {
      label: component.label,
      totalBase: frontBase + (component.rearSuffix ? rearBase : 0),
      total: front + number(rear),
      frontBase,
      front,
      rearBase: component.rearSuffix ? rearBase : null,
      rear,
    };
  });
}

function structureInfoRows(values) {
  return INFO_COMPONENTS.map((component) => {
    const base = number(currentDefinition().components?.[component.key]?.hp);
    return {
      label: component.label,
      base,
      total: base + quirkAdd(values, "internalresist", component.suffix),
    };
  });
}

function formatInfoNumber(value, digits = 1) {
  if (!Number.isFinite(value)) return "-";
  return fmt(value, digits);
}

function signedInfoNumber(value, digits = 1) {
  if (!Number.isFinite(value)) return "-";
  const text = fmt(Math.abs(value), digits);
  return `${value >= 0 ? "+" : "-"}${text}`;
}

function specValue(base, final, digits = 1, unit = "") {
  const delta = final - base;
  const baseText = `${formatInfoNumber(base, digits)}${unit}`;
  if (!state.infoApplyQuirks || Math.abs(delta) < 0.0001) {
    return `
      <span class="spec-value spec-base-only">
        <span class="spec-final spec-final-base">${baseText}</span>
        <span class="spec-detail spec-detail-empty"></span>
      </span>
    `;
  }
  return `
    <span class="spec-value spec-with-quirk">
      <span class="spec-final">${formatInfoNumber(final, digits)}${unit}</span>
      <span class="spec-detail">
        <span class="spec-sep">|</span>
        <span class="spec-base">${baseText}</span>
        <span class="spec-op">+</span>
        <span class="spec-quirk">${signedInfoNumber(delta, digits)}${unit}</span>
      </span>
    </span>
  `;
}

function specValueList(baseValues, finalValues, digits = 1, unit = "") {
  const hasDelta = finalValues.some((value, index) => Math.abs(value - baseValues[index]) >= 0.0001);
  const baseText = baseValues.map((value) => formatInfoNumber(value, digits)).join(" / ");
  if (!state.infoApplyQuirks || !hasDelta) {
    return `
      <span class="spec-value spec-base-only">
        <span class="spec-final spec-final-base">${baseText}${unit}</span>
        <span class="spec-detail spec-detail-empty"></span>
      </span>
    `;
  }
  const finalText = finalValues.map((value) => formatInfoNumber(value, digits)).join(" / ");
  const deltaText = finalValues.map((value, index) => signedInfoNumber(value - baseValues[index], digits)).join(" / ");
  return `
    <span class="spec-value spec-with-quirk">
      <span class="spec-final">${finalText}${unit}</span>
      <span class="spec-detail">
        <span class="spec-sep">|</span>
        <span class="spec-base">${baseText}${unit}</span>
        <span class="spec-op">+</span>
        <span class="spec-quirk">${deltaText}${unit}</span>
      </span>
    </span>
  `;
}

function movementInfo(values) {
  const stats = currentDefinition().stats || {};
  const movement = currentDefinition().movement || {};
  const tons = number(stats.MaxTons);
  const maxEngine = number(stats.MaxEngineRating);
  const baseSpeed = tons ? number(movement.MaxMovementSpeed) * maxEngine / tons : 0;
  const speedMultiplier = quirkMultiplier(values, ["mechtopspeed_multiplier"]);
  const accelMultiplier = quirkMultiplier(values, ["mechacceleration_multiplier", "accellerp_all_multiplier"]);
  const decelMultiplier = quirkMultiplier(values, ["mechdeceleration_multiplier", "decellerp_all_multiplier"]);
  const turnMultiplier = quirkMultiplier(values, ["turnrate_multiplier", "turnlerp_all_multiplier"]);
  const yawAngle = (number(movement.MaxTorsoAngleYaw) + number(values.torso_yawangle_additive)) * quirkMultiplier(values, ["torso_yawangle_multiplier"]);
  const pitchAngle = number(movement.MaxTorsoAnglePitch) + number(values.torso_pitchangle_additive);

  return {
    baseMaxSpeed: baseSpeed,
    maxSpeed: baseSpeed * speedMultiplier,
    baseAcceleration: [
      number(movement.AccelLerpLowRate),
      number(movement.AccelLerpMidRate),
      number(movement.AccelLerpHighRate),
    ],
    acceleration: [
      number(movement.AccelLerpLowRate) * accelMultiplier,
      number(movement.AccelLerpMidRate) * accelMultiplier,
      number(movement.AccelLerpHighRate) * accelMultiplier,
    ],
    baseDeceleration: [
      number(movement.DecelLerpLowRate),
      number(movement.DecelLerpMidRate),
      number(movement.DecelLerpHighRate),
    ],
    deceleration: [
      number(movement.DecelLerpLowRate) * decelMultiplier,
      number(movement.DecelLerpMidRate) * decelMultiplier,
      number(movement.DecelLerpHighRate) * decelMultiplier,
    ],
    baseTorsoAngle: [number(movement.MaxTorsoAngleYaw), number(movement.MaxTorsoAnglePitch)],
    torsoAngle: [yawAngle, pitchAngle],
    baseTorsoSpeed: [
      number(movement.TorsoTurnSpeedYaw),
      number(movement.TorsoTurnSpeedPitch),
    ],
    torsoSpeed: [
      number(movement.TorsoTurnSpeedYaw) * quirkMultiplier(values, ["torso_yawspeed_multiplier"]),
      number(movement.TorsoTurnSpeedPitch) * quirkMultiplier(values, ["torso_pitchspeed_multiplier"]),
    ],
    baseTurnSpeed: [
      number(movement.TurnLerpLowRate),
      number(movement.TurnLerpMidRate),
      number(movement.TurnLerpHighRate),
    ],
    turnSpeed: [
      number(movement.TurnLerpLowRate) * turnMultiplier,
      number(movement.TurnLerpMidRate) * turnMultiplier,
      number(movement.TurnLerpHighRate) * turnMultiplier,
    ],
  };
}

function renderInfoTable(title, headers, rows) {
  return `
    <section class="info-card">
      <h3>${title}</h3>
      <div class="info-table">
        <div class="info-row info-head">${headers.map((header, index) => `<span>${index === 0 ? header : specHeader(header)}</span>`).join("")}</div>
        ${rows
          .map((row) => `<div class="info-row">${row.map((cell) => `<span>${cell}</span>`).join("")}</div>`)
          .join("")}
      </div>
    </section>
  `;
}

function specHeader(label) {
  return `
    <span class="spec-value spec-header-value">
      <span class="spec-final spec-header-final">${label}</span>
      <span class="spec-detail spec-detail-empty"></span>
    </span>
  `;
}

function renderInfoQuirks(quirks) {
  return `
    <section class="info-card info-quirks-card">
      <div class="section-title-row">
        <h3>쿼크 리스트</h3>
        <span class="muted">${quirks.length} quirks</span>
      </div>
      <div class="quirks">
        ${quirks.length
          ? quirks
              .map((quirk) => `
                <div class="quirk">
                  <span class="quirk-name">
                    <strong>${quirk.display_name}</strong>
                    <span class="muted">${quirk.source_text || quirk.name}</span>
                  </span>
                  <span class="quirk-value">${quirk.value_text}</span>
                </div>
              `)
              .join("")
          : `<div class="empty">No quirks</div>`}
      </div>
    </section>
  `;
}

function renderInfoPanel() {
  const mech = state.selectedMech;
  if (!mech) {
    $("info-variant-name").textContent = "No mech selected";
    $("info-variant-meta").textContent = "";
    $("mech-info").innerHTML = "";
    return;
  }
  const stats = currentDefinition().stats || {};
  const quirks = effectiveQuirks();
  const values = state.infoApplyQuirks ? effectiveQuirkValues() : {};
  const armorRows = armorInfoRows(values);
  const structureRows = structureInfoRows(values);
  const armorTotal = armorRows.reduce((sum, row) => sum + number(row.total), 0);
  const armorBaseTotal = armorRows.reduce((sum, row) => sum + number(row.totalBase), 0);
  const structureTotal = structureRows.reduce((sum, row) => sum + number(row.total), 0);
  const structureBaseTotal = structureRows.reduce((sum, row) => sum + number(row.base), 0);
  const movement = movementInfo(values);

  $("info-variant-name").textContent = mech.display_name;
  $("info-variant-meta").textContent = `${mech.faction || "Unknown"} - ${WEIGHT_CLASS_LABELS[mech.weight_class] || mech.weight_class || "Unknown"} - ${stats.MaxTons || "?"} tons`;
  $("info-apply-quirks").checked = state.infoApplyQuirks;
  $("mech-info").innerHTML = [
    renderInfoTable("아머 정보", ["부위", "총합", "전방", "후방"], [
      ["최대 아머 포인트 총합", specValue(armorBaseTotal, armorTotal, 0), "", ""],
      ...armorRows.map((row) => [
        row.label,
        specValue(row.totalBase, row.total, 0),
        specValue(row.frontBase, row.front, 0),
        row.rear === null ? "-" : specValue(row.rearBase, row.rear, 0),
      ]),
    ]),
    renderInfoTable("스트럭쳐 정보", ["부위", "수치"], [
      ["스트럭쳐 총합", specValue(structureBaseTotal, structureTotal, 0)],
      ...structureRows.map((row) => [row.label, specValue(row.base, row.total, 0)]),
    ]),
    renderInfoTable("엔진", ["항목", "수치"], [
      ["최소 엔진", formatInfoNumber(number(stats.MinEngineRating), 0)],
      ["최대 엔진", formatInfoNumber(number(stats.MaxEngineRating), 0)],
    ]),
    renderInfoTable("기동성", ["항목", "수치"], [
      ["최대 속도", specValue(movement.baseMaxSpeed, movement.maxSpeed, 1, " kph")],
      ["가속도", specValueList(movement.baseAcceleration, movement.acceleration, 1)],
      ["감속도", specValueList(movement.baseDeceleration, movement.deceleration, 1)],
      ["몸통 회전각 X/Y", specValueList(movement.baseTorsoAngle, movement.torsoAngle, 1)],
      ["몸통 회전 속도 X/Y", specValueList(movement.baseTorsoSpeed, movement.torsoSpeed, 1)],
      ["회전 속도", specValueList(movement.baseTurnSpeed, movement.turnSpeed, 2)],
    ]),
    renderInfoQuirks(quirks),
  ].join("");
}

function calculateBuild() {
  const mech = state.selectedMech;
  const definition = currentDefinition();
  const stats = definition.stats || {};
  const maxTons = number(stats.MaxTons);
  const baseTons = number(stats.BaseTons);
  let itemTonnage = 0;
  let heat = 0;
  let alpha = 0;
  let ammo = 0;
  let armor = 0;
  let engine = null;
  let heatSinkTons = 0;
  const warnings = [];
  const componentUsage = {};

  for (const name of COMPONENT_ORDER) {
    const compDef = definition.components?.[name] || {};
    const buildComp = state.currentBuild.components[name] || { items: [] };
    const used = number(compDef.internals?.length);
    const usage = {
      slots: used,
      hardpoints: {},
      warnings: [],
    };

    armor += number(buildComp.armor);
    for (const entry of buildComp.items) {
      const item = itemById(entry.item_id);
      if (!item) {
        usage.warnings.push(`Missing item ${entry.item_id}`);
        continue;
      }
      const slots = itemSlots(item);
      usage.slots += slots;
      itemTonnage += itemTons(item);
      heat += itemHeat(item);
      if (item.item_type === "weapon") {
        const type = item.hardpoint_type || String(item.stats?.type || "").toLowerCase();
        usage.hardpoints[type] = (usage.hardpoints[type] || 0) + slots;
        alpha += number(item.stats?.damage) * number(item.stats?.numFiring, 1);
      }
      if (item.item_type === "ammo") {
        ammo += number(item.stats?.numShots);
      }
      if (item.item_type === "engine") {
        engine = item;
      }
      if (isHeatSink(item)) {
        heatSinkTons += itemTons(item);
      }
    }

    const slotLimit = number(compDef.slots);
    if (slotLimit && usage.slots > slotLimit) {
      usage.warnings.push(`Slots ${usage.slots}/${slotLimit}`);
    }

    for (const [type, usedSlots] of Object.entries(usage.hardpoints)) {
      const capacity = (compDef.hardpoints || [])
        .filter((hp) => hp.hardpoint_type === type)
        .reduce((sum, hp) => sum + number(hp.Slots, 1), 0);
      if (!capacity) {
        usage.warnings.push(`No ${type} hardpoint`);
      }
    }

    componentUsage[name] = usage;
  }

  for (const [name, usage] of Object.entries(componentUsage)) {
    for (const warning of usage.warnings) {
      warnings.push(`${COMPONENT_NAMES[name] || name}: ${warning}`);
    }
  }

  armor += number(state.currentBuild.rearArmor);
  const armorUpgradeId = state.currentBuild.upgrades?.armor?.ItemID;
  const armorUpgrade = itemById(armorUpgradeId);
  const armorPerTon = number(armorUpgrade?.stats?.armorPerTon, 32);
  const engineIncludedHeatSinks = engine ? number(engine.stats?.heatsinks) : 0;
  const adjustedItemTons = itemTonnage - Math.min(heatSinkTons, engineIncludedHeatSinks);
  const totalTons = baseTons + adjustedItemTons + armor / armorPerTon;
  if (maxTons && totalTons > maxTons + 0.1) {
    warnings.push(`Tonnage ${fmt(totalTons)}/${fmt(maxTons)}`);
  }
  if (engine) {
    const rating = number(engine.stats?.rating);
    const min = number(stats.MinEngineRating);
    const max = number(stats.MaxEngineRating);
    if ((min && rating < min) || (max && rating > max)) {
      warnings.push(`Engine ${rating} outside ${min}-${max}`);
    }
  } else {
    warnings.push("No engine");
  }

  return { maxTons, totalTons, heat, alpha, ammo, armor, engine, warnings, componentUsage };
}

function renderSummary() {
  const calc = state.selectedMech && state.currentBuild ? calculateBuild() : null;
  if (!calc) {
    $("summary-strip").innerHTML = "";
    return;
  }
  $("summary-strip").innerHTML = [
    ["Tons", `${fmt(calc.totalTons)}/${fmt(calc.maxTons)}`],
    ["Alpha", fmt(calc.alpha)],
    ["Heat", fmt(calc.heat)],
    ["Ammo", fmt(calc.ammo, 0)],
    ["Engine", calc.engine ? number(calc.engine.stats?.rating) : "-"],
    ["Status", calc.warnings.length ? "Check" : "OK"],
  ]
    .map(([label, value]) => `<div class="pill"><strong>${value}</strong><span>${label}</span></div>`)
    .join("");
}

function renderMechList() {
  const search = $("mech-search").value.trim().toLowerCase();
  const factionFilter = $("faction-filter").value;
  const filtered = state.mechs.filter((mech) => {
    const matchesSearch = !search || `${mech.display_name} ${mech.name} ${mech.chassis}`.toLowerCase().includes(search);
    const matchesFaction = !factionFilter || mech.faction === factionFilter;
    return matchesSearch && matchesFaction;
  });
  const grouped = groupMechsForList(filtered);
  const activeChassis = state.selectedChassis || state.selectedMech?.chassis || "";
  const classNames = Array.from(grouped.keys()).sort((a, b) => {
    const aIndex = WEIGHT_CLASS_ORDER.indexOf(a);
    const bIndex = WEIGHT_CLASS_ORDER.indexOf(b);
    return (aIndex === -1 ? 99 : aIndex) - (bIndex === -1 ? 99 : bIndex) || a.localeCompare(b);
  });

  if (!filtered.length) {
    $("mech-list").innerHTML = `<div class="empty">No mechs match the current filters.</div>`;
    return;
  }

  $("mech-list").innerHTML = classNames
    .map((weightClass) => {
      const chassisGroups = Array.from(grouped.get(weightClass).entries())
        .map(([chassis, variants]) => {
          variants.sort(sortMechsByVariant);
          return { chassis, variants, label: chassisDisplayName(variants), tons: variants[0]?.definition?.stats?.MaxTons || "?" };
        })
        .sort((a, b) => Number(a.tons) - Number(b.tons) || a.label.localeCompare(b.label));
      const count = chassisGroups.reduce((sum, group) => sum + group.variants.length, 0);
      return `
        <section class="class-section">
          <div class="class-heading">
            <strong>${WEIGHT_CLASS_LABELS[weightClass] || formatChassisName(weightClass)}</strong>
            <span>${chassisGroups.length} chassis / ${count} variants</span>
          </div>
          <div class="chassis-list">
            ${chassisGroups
              .map((group) => {
                const active = group.chassis === activeChassis ? " active" : "";
                const firstMech = group.variants[0];
                const factions = Array.from(new Set(group.variants.map((mech) => mech.faction).filter(Boolean))).join(", ");
                return `
                  <div class="chassis-group${active}">
                    <button class="chassis-row${active}" data-chassis="${group.chassis}" data-first-mech="${firstMech.id}" type="button">
                      <span class="row-title"><strong>${group.label}</strong><span>${group.tons}t</span></span>
                      <span class="badge-line">
                        <span class="badge">${group.variants.length} variants</span>
                        ${factions ? `<span class="badge">${factions}</span>` : ""}
                      </span>
                    </button>
                    ${active ? `
                      <div class="variant-list">
                        ${group.variants
                          .map((mech) => {
                            const selected = state.selectedMech?.id === mech.id ? " active" : "";
                            return `
                              <button class="mech-row variant-row${selected}" data-mech="${mech.id}" type="button">
                                <span class="row-title"><strong>${variantCode(mech)}</strong><span>${mech.faction || "unknown"}</span></span>
                                <span class="badge-line">${hardpointBadges(mech.definition)}</span>
                              </button>
                            `;
                          })
                          .join("")}
                      </div>
                    ` : ""}
                  </div>
                `;
              })
              .join("")}
          </div>
        </section>
      `;
    })
    .join("");
}

function renderEquipmentList() {
  const search = $("item-search").value.trim().toLowerCase();
  const family = $("item-family").value;
  const ids = family
    ? state.equipment.families[family] || []
    : Object.keys(state.equipment.items).map((id) => Number(id));
  const rows = ids
    .map((id) => itemById(id))
    .filter(Boolean)
    .filter((item) => {
      const text = `${item.display_name} ${item.name} ${item.family}`.toLowerCase();
      return !search || text.includes(search);
    })
    .slice(0, 350);

  $("item-list").innerHTML = rows
    .map((item) => {
      const active = String(state.selectedItemId) === String(item.id) ? " active" : "";
      const icon = `<span class="badge">${item.item_type[0] || "?"}</span>`;
      return `
        <button class="item-row${active}" data-item="${item.id}" type="button">
          ${icon}
          <span>
            <span class="row-title"><strong>${item.display_name}</strong><span>${fmt(itemTons(item))}t</span></span>
            <span class="badge-line">
              <span class="badge">${item.family}</span>
              <span class="badge">${itemSlots(item)} slots</span>
              ${item.hardpoint_type ? `<span class="badge ${item.hardpoint_type}">${item.hardpoint_type}</span>` : ""}
            </span>
          </span>
        </button>
      `;
    })
    .join("");
}

function renderSelectedItem() {
  const item = itemById(state.selectedItemId);
  $("selected-item").textContent = item
    ? `${item.display_name} · ${fmt(itemTons(item))} tons · ${itemSlots(item)} slots`
    : "No item selected";
}

function renderComponents() {
  const definition = currentDefinition();
  const calc = calculateBuild();
  $("components").innerHTML = COMPONENT_ORDER.map((name) => {
    const compDef = definition.components?.[name] || {};
    const buildComp = state.currentBuild.components[name] || { items: [] };
    const usage = calc.componentUsage[name] || { slots: 0, warnings: [] };
    const slotLimit = number(compDef.slots);
    const hps = (compDef.hardpoints || [])
      .map((hp) => `<span class="badge ${hp.hardpoint_type}">${hp.hardpoint_type} ${hp.Slots || 1}</span>`)
      .join("");
    const items = buildComp.items.length
      ? buildComp.items.map((entry, index) => renderLoadoutItem(name, entry, index)).join("")
      : `<div class="empty">Empty</div>`;
    return `
      <article class="component ${usage.warnings.length ? "invalid" : ""}">
        <div class="component-head">
          <div>
            <div class="component-title">${COMPONENT_NAMES[name] || name}</div>
            <div class="component-meta muted">Armor ${buildComp.armor || 0} · Slots ${usage.slots}/${slotLimit || "?"}</div>
            <div class="badge-line">${hps}</div>
            ${usage.warnings.length ? `<div class="warnings">${usage.warnings.join(" · ")}</div>` : ""}
          </div>
          <button data-add-to="${name}" type="button">Add</button>
        </div>
        <div class="component-items">${items}</div>
      </article>
    `;
  }).join("");
}

function renderLoadoutItem(component, entry, index) {
  const item = itemById(entry.item_id);
  if (!item) {
    return `<div class="slot-item"><span></span><span>Missing ${entry.item_id}</span><button data-remove="${component}:${index}" type="button">Remove</button></div>`;
  }
  const icon = `<span class="badge">${item.item_type[0] || "?"}</span>`;
  return `
    <div class="slot-item">
      ${icon}
      <span>
        <strong>${item.display_name}</strong>
        <span class="badge-line">
          <span class="badge">${fmt(itemTons(item))}t</span>
          <span class="badge">${itemSlots(item)} slots</span>
          ${item.hardpoint_type ? `<span class="badge ${item.hardpoint_type}">${item.hardpoint_type}</span>` : ""}
        </span>
      </span>
      <button class="danger" data-remove="${component}:${index}" type="button">Remove</button>
    </div>
  `;
}

function renderQuirks() {
  const quirks = effectiveQuirks();
  $("quirk-count").textContent = quirks.length ? `${quirks.length} active` : "None";
  $("quirks").innerHTML = quirks.length
    ? quirks.map((quirk) => `
      <div class="quirk" title="${quirk.name}">
        <span class="quirk-name">
          <strong>${quirk.display_name}</strong>
          <span class="muted">${quirk.source_text || quirk.name}</span>
        </span>
        <span class="quirk-value">${quirk.value_text}</span>
      </div>
    `).join("")
    : `<div class="empty">No quirks found for this mech.</div>`;
}

function renderVariant() {
  const mech = state.selectedMech;
  if (!mech) return;
  const stats = mech.definition?.stats || {};
  $("variant-name").textContent = mech.display_name;
  $("variant-meta").textContent = `${mech.faction || "Unknown"} - ${mech.weight_class || "Unknown"} - ${stats.MaxTons || "?"} tons - Engine ${stats.MinEngineRating || "?"}-${stats.MaxEngineRating || "?"}`;
  const calc = calculateBuild();
  $("data-status").textContent = calc.warnings.length ? calc.warnings.join(" - ") : `${state.index.counts.mechs} mechs loaded from local game data`;
  renderSummary();
  renderQuirks();
  renderComponents();
}

function renderAll() {
  renderMechList();
  renderEquipmentList();
  renderSelectedItem();
  renderInfoPanel();
  if (state.selectedMech) {
    renderVariant();
  }
}

function selectMech(id) {
  state.selectedMech = state.mechs.find((mech) => String(mech.id) === String(id)) || state.mechs[0];
  state.selectedChassis = state.selectedMech?.chassis || "";
  state.currentBuild = loadBuild(state.selectedMech);
  renderAll();
}

function selectItem(id) {
  state.selectedItemId = id;
  renderEquipmentList();
  renderSelectedItem();
}

function addSelectedItem(component) {
  const item = itemById(state.selectedItemId);
  if (!item || !state.currentBuild.components[component]) return;
  state.currentBuild.components[component].items.push({
    type: item.item_type === "weapon" ? "weapon" : item.item_type === "ammo" ? "ammo" : "module",
    item_id: item.id,
    weapon_group: null,
  });
  renderVariant();
}

function removeItem(key) {
  const [component, indexText] = key.split(":");
  const index = Number(indexText);
  const items = state.currentBuild.components[component]?.items;
  if (!items || !Number.isInteger(index)) return;
  items.splice(index, 1);
  renderVariant();
}

function bindEvents() {
  document.querySelectorAll("[data-main-tab]").forEach((button) => {
    button.addEventListener("click", () => setMainTab(button.dataset.mainTab));
  });
  $("mech-search").addEventListener("input", renderMechList);
  $("faction-filter").addEventListener("change", renderMechList);
  $("item-search").addEventListener("input", renderEquipmentList);
  $("item-family").addEventListener("change", renderEquipmentList);
  $("info-apply-quirks").addEventListener("change", (event) => {
    state.infoApplyQuirks = event.target.checked;
    renderInfoPanel();
  });

  $("mech-list").addEventListener("click", (event) => {
    const chassis = event.target.closest("[data-chassis]");
    if (chassis) {
      state.selectedChassis = chassis.dataset.chassis;
      selectMech(chassis.dataset.firstMech);
      return;
    }
    const button = event.target.closest("[data-mech]");
    if (button) selectMech(button.dataset.mech);
  });
  $("item-list").addEventListener("click", (event) => {
    const button = event.target.closest("[data-item]");
    if (button) selectItem(button.dataset.item);
  });
  $("components").addEventListener("click", (event) => {
    const add = event.target.closest("[data-add-to]");
    const remove = event.target.closest("[data-remove]");
    if (add) addSelectedItem(add.dataset.addTo);
    if (remove) removeItem(remove.dataset.remove);
  });
  $("reset-stock").addEventListener("click", () => {
    state.currentBuild = buildFromLoadout(state.selectedMech);
    renderVariant();
  });
  $("save-build").addEventListener("click", () => {
    localStorage.setItem(savedKey(state.selectedMech), JSON.stringify(state.currentBuild));
    $("data-status").textContent = "Build saved locally";
  });
  $("clear-build").addEventListener("click", () => {
    for (const component of Object.values(state.currentBuild.components)) {
      component.items = [];
    }
    renderVariant();
  });
}

async function loadJson(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`Could not load ${path}`);
  return response.json();
}

async function init() {
  bindEvents();
  setMainTab(state.activeMainTab);
  try {
    state.index = await loadJson("data/index.json");
    const [mechs, equipment, loadouts, omnipods] = await Promise.all([
      loadJson(state.index.files.mechs),
      loadJson(state.index.files.equipment),
      loadJson(state.index.files.loadouts),
      loadJson(state.index.files.omnipods),
    ]);
    state.mechs = mechs.filter((mech) => mech.definition && mech.definition.components);
    state.equipment = equipment;
    state.loadouts = loadouts;
    state.omnipods = omnipods;
    $("data-status").textContent = `${state.index.counts.mechs} mechs loaded from local game data`;
    selectMech(state.mechs.find((mech) => mech.name === "as7-d")?.id || state.mechs[0]?.id);
  } catch (error) {
    $("data-status").textContent = error.message;
    console.error(error);
  }
}

init();
