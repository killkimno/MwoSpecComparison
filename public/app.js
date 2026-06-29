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

const FACTION_LABELS = {
  Clan: "클랜",
  InnerSphere: "이너스피어",
};

const MAX_COMPARE_MECHS = 15;
const COMPARE_RANK_EPSILON = 0.0001;
const DEFAULT_COLLAPSED_COMPARE_CATEGORIES = ["종합 내구", "아머 정보", "스트럭쳐 정보"];
const DIRECT_COOLDOWN_QUIRKS = new Set([
  "all_cooldown_multiplier",
  "energy_cooldown_multiplier",
  "missile_cooldown_multiplier",
  "ballistic_cooldown_multiplier",
]);

const state = {
  index: null,
  mechs: [],
  equipment: null,
  loadouts: {},
  omnipods: {},
  activeMainTab: "info",
  infoApplyQuirks: true,
  compareMode: false,
  compareMechIds: [],
  compareBaselineMechId: null,
  compareShowDeltas: true,
  collapsedCompareCategories: new Set(DEFAULT_COLLAPSED_COMPARE_CATEGORIES),
  activeStatsView: "durability",
  largeMechList: true,
  mechSort: "default",
  mechListSummaryCache: new Map(),
  mechHardpointBadgeCache: new Map(),
  weaponQuirkTypeCache: null,
  weaponQuirkTargetCache: null,
  selectedMech: null,
  selectedChassis: "",
  expandedChassis: new Set(),
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

function normalizeLookupKey(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function itemById(id) {
  return state.equipment?.items?.[String(id)] || null;
}

function itemName(id) {
  const item = itemById(id);
  return item ? item.display_name || item.name : `Item ${id}`;
}

function mechById(id) {
  return state.mechs.find((mech) => String(mech.id) === String(id)) || null;
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

function hardpointBadges(mech, build = buildFromLoadout(mech)) {
  const definition = effectiveDefinition(mech, build);
  const counts = {};
  Object.values(definition?.components || {}).forEach((component) => {
    (component.hardpoints || []).forEach((hp) => {
      const type = hp.hardpoint_type;
      counts[type] = (counts[type] || 0) + number(hp.Slots, 1);
    });
  });
  return Object.entries(counts)
    .filter(([type]) => ["ballistic", "energy", "missile", "ams", "ecm"].includes(type))
    .map(([type, count]) => `<span class="badge ${type}">${type[0].toUpperCase()} ${count}</span>`)
    .join("");
}

function stockHardpointBadges(mech) {
  const key = String(mech?.id || "");
  if (!key) return "";
  const cached = state.mechHardpointBadgeCache.get(key);
  if (cached !== undefined) return cached;
  const badges = hardpointBadges(mech, buildFromLoadout(mech));
  state.mechHardpointBadgeCache.set(key, badges);
  return badges;
}

function mechListQuirkValues(mech) {
  if (!state.infoApplyQuirks) return {};
  return effectiveQuirkValues(mech, buildFromLoadout(mech));
}

function mechListSummary(mech) {
  const key = `${mech.id}:${state.infoApplyQuirks ? 1 : 0}`;
  const cached = state.mechListSummaryCache.get(key);
  if (cached) return cached;

  const values = mechListQuirkValues(mech);
  const baseArmorRows = armorInfoRows({}, mech);
  const baseStructureRows = structureInfoRows({}, mech);
  const baseCombinedRows = combinedDurabilityRows(baseArmorRows, baseStructureRows);
  const armorRows = armorInfoRows(values, mech);
  const structureRows = structureInfoRows(values, mech);
  const combinedRows = combinedDurabilityRows(armorRows, structureRows);
  const baseMovement = movementInfo({}, mech);
  const summary = {
    stats: currentDefinition(mech).stats || {},
    baseCombinedTotal: baseCombinedRows.reduce((sum, row) => sum + number(row.total), 0),
    combinedTotal: combinedRows.reduce((sum, row) => sum + number(row.total), 0),
    baseMovement,
    movement: movementInfo(values, mech),
  };
  state.mechListSummaryCache.set(key, summary);
  return summary;
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

function factionRank(faction) {
  if (faction === "Clan") return 0;
  if (faction === "InnerSphere") return 1;
  return 99;
}

function factionLabel(faction) {
  return FACTION_LABELS[faction] || faction || "Unknown";
}

function factionClass(faction) {
  return faction === "Clan" ? "faction-clan" : "faction-innersphere";
}

function weightClassClass(weightClass) {
  return `weight-${String(weightClass || "unknown").toLowerCase()}`;
}

function sortChassisGroups(a, b) {
  const tons = Number(a.tons) - Number(b.tons);
  const faction = factionRank(a.faction) - factionRank(b.faction);
  if (state.mechSort === "tons") {
    return tons || faction || a.label.localeCompare(b.label);
  }
  return faction || tons || a.order - b.order;
}

function chassisGroupsForWeight(grouped, weightClass) {
  return Array.from(grouped.get(weightClass).entries())
    .map(([chassis, variants], order) => {
      variants.sort(sortMechsByVariant);
      return {
        chassis,
        variants,
        label: chassisDisplayName(variants),
        tons: variants[0]?.definition?.stats?.MaxTons || "?",
        faction: variants[0]?.faction || "Unknown",
        order,
      };
    })
    .sort(sortChassisGroups);
}

function factionSectionsForChassisGroups(chassisGroups) {
  const sections = [];
  chassisGroups.forEach((group) => {
    const last = sections[sections.length - 1];
    if (!last || last.faction !== group.faction) {
      sections.push({
        faction: group.faction,
        groups: [],
        variantCount: 0,
      });
    }
    const section = sections[sections.length - 1];
    section.groups.push(group);
    section.variantCount += group.variants.length;
  });
  return sections;
}

function sortedClassNames(grouped) {
  return Array.from(grouped.keys()).sort((a, b) => {
    const aIndex = WEIGHT_CLASS_ORDER.indexOf(a);
    const bIndex = WEIGHT_CLASS_ORDER.indexOf(b);
    return (aIndex === -1 ? 99 : aIndex) - (bIndex === -1 ? 99 : bIndex) || a.localeCompare(b);
  });
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

function loadoutForMech(mech) {
  return state.loadouts[mech?.stock_loadout] || {};
}

function podById(id) {
  return id ? state.omnipods[String(id)] || null : null;
}

function hasFixedOmnipods(mech) {
  const loadout = loadoutForMech(mech);
  return Object.values(loadout.components || {}).some((component) => component.omnipod);
}

function omnipodIcon(mech) {
  if (!hasFixedOmnipods(mech)) return "";
  return `
    <span class="omnipod-icon" title="Omnipod" role="img" aria-label="Omnipod">
      <svg viewBox="0 0 32 32" focusable="false" aria-hidden="true">
        <path d="M13 3h6l1 3-2 2h-4l-2-2 1-3Z"></path>
        <path d="M11 9h10l1.5 5-3.5 3h-6l-3.5-3L11 9Z"></path>
        <path d="M5 9h4l-1 9-4 2-1-6 2-5Z"></path>
        <path d="M23 9h4l2 5-1 6-4-2-1-9Z"></path>
        <path d="M11 18h4l-1 11H8l1-7 2-4Z"></path>
        <path d="M17 18h4l2 4 1 7h-6l-1-11Z"></path>
      </svg>
    </span>
  `;
}

function findOmnipod(chassis, setName, componentName) {
  const wantedChassis = String(chassis || "").toLowerCase();
  const wantedSet = String(setName || "").toLowerCase();
  const wantedComponent = String(componentName || "").toLowerCase();
  return Object.values(state.omnipods || {}).find((pod) => (
    String(pod.chassis || "").toLowerCase() === wantedChassis
    && String(pod.set || "").toLowerCase() === wantedSet
    && String(pod.component || "").toLowerCase() === wantedComponent
  )) || null;
}

function dominantOmnipodSet(mech, build) {
  const counts = new Map();
  Object.values(build?.components || {}).forEach((component) => {
    const pod = podById(component.omnipod);
    if (!pod?.set) return;
    counts.set(pod.set, (counts.get(pod.set) || 0) + 1);
  });
  if (!counts.size) return "";
  const loadoutName = String(mech?.stock_loadout || mech?.name || "").toLowerCase();
  return Array.from(counts.entries()).sort((a, b) => {
    const countDiff = b[1] - a[1];
    if (countDiff) return countDiff;
    const aExact = a[0] === loadoutName ? 1 : 0;
    const bExact = b[0] === loadoutName ? 1 : 0;
    return bExact - aExact || a[0].localeCompare(b[0]);
  })[0][0];
}

function applyFixedOmnipods(mech, build) {
  const loadout = loadoutForMech(mech);
  build.components ||= {};
  for (const name of COMPONENT_ORDER) {
    build.components[name] ||= { armor: 0, items: [] };
    const stockPodId = loadout.components?.[name]?.omnipod;
    if (stockPodId) build.components[name].omnipod = stockPodId;
  }
  const centre = build.components.centre_torso;
  if (centre && !centre.omnipod) {
    const setName = dominantOmnipodSet(mech, build);
    const centrePod = findOmnipod(mech?.chassis, setName, "centre_torso");
    if (centrePod?.id) centre.omnipod = centrePod.id;
  }
  return build;
}

function buildFromLoadout(mech) {
  const loadout = loadoutForMech(mech);
  const components = {};
  for (const name of COMPONENT_ORDER) {
    const component = loadout.components?.[name] || {};
    components[name] = {
      armor: number(component.armor),
      omnipod: component.omnipod || null,
      items: (component.items || []).map((entry) => ({ ...entry })),
    };
  }
  const rearArmor = REAR_ARMOR_COMPONENTS.reduce((sum, name) => {
    return sum + number(loadout.components?.[name]?.armor);
  }, 0);
  return applyFixedOmnipods(mech, {
    mechId: mech.id,
    loadoutName: mech.stock_loadout,
    components,
    rearArmor,
    upgrades: JSON.parse(JSON.stringify(loadout.upgrades || {})),
  });
}

function savedKey(mech) {
  return `local-mwo-build:${mech.name}`;
}

function loadBuild(mech) {
  const saved = localStorage.getItem(savedKey(mech));
  if (saved) {
    try {
      return applyFixedOmnipods(mech, JSON.parse(saved));
    } catch {
      localStorage.removeItem(savedKey(mech));
    }
  }
  return buildFromLoadout(mech);
}

function currentDefinition(mech = state.selectedMech) {
  return mech?.definition || {};
}

function hardpointsFromLoadoutItems(buildComponent) {
  const byType = new Map();
  (buildComponent?.items || []).forEach((entry) => {
    const item = itemById(entry.item_id);
    if (item?.item_type !== "weapon") return;
    const type = item.hardpoint_type || String(item.stats?.type || "").toLowerCase();
    if (!type) return;
    byType.set(type, (byType.get(type) || 0) + itemSlots(item));
  });
  return Array.from(byType.entries()).map(([type, slots]) => ({
    hardpoint_type: type,
    Type: type,
    Slots: slots,
    inferred: true,
  }));
}

function effectiveComponentDefinition(mech = state.selectedMech, build = state.currentBuild, componentName) {
  const base = currentDefinition(mech).components?.[componentName] || {};
  const buildComponent = build?.components?.[componentName] || {};
  const pod = podById(buildComponent.omnipod);
  const hardpoints = pod?.hardpoints?.length
    ? pod.hardpoints
    : (base.hardpoints?.length ? base.hardpoints : hardpointsFromLoadoutItems(buildComponent));
  return {
    ...base,
    hardpoints: hardpoints.map((hp) => ({ ...hp })),
  };
}

function effectiveDefinition(mech = state.selectedMech, build = state.currentBuild) {
  const definition = currentDefinition(mech);
  const components = {};
  for (const name of Object.keys(definition.components || {})) {
    components[name] = effectiveComponentDefinition(mech, build, name);
  }
  return {
    ...definition,
    components,
  };
}

function setMainTab(tabName) {
  if (tabName === "mechlab") tabName = "info";
  const isCompareTab = tabName === "compare";
  state.activeMainTab = tabName;
  state.compareMode = isCompareTab;
  if (isCompareTab) {
    state.compareMechIds = [];
    state.compareBaselineMechId = null;
    state.selectedChassis = "";
  } else if (state.selectedMech) {
    state.selectedChassis = state.selectedMech.chassis || "";
  }
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
  renderMechList();
  renderInfoPanel();
  renderComparePanel();
  renderStatsPanel();
  updateCompareOverlay();
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

function effectiveQuirks(mech = state.selectedMech, build = state.currentBuild) {
  const collector = new Map();
  const definition = currentDefinition(mech);
  (definition.quirks || []).forEach((quirk) => addQuirk(collector, quirk, "Variant"));

  const setCounts = {};
  const setBonuses = {};
  for (const [component, buildComponent] of Object.entries(build?.components || {})) {
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

function effectiveQuirkValues(mech = state.selectedMech, build = state.currentBuild) {
  const values = {};
  effectiveQuirks(mech, build).forEach((quirk) => {
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

function baseMaxArmor(componentName, mech = state.selectedMech) {
  if (componentName === "head") return 18;
  return number(currentDefinition(mech).components?.[componentName]?.hp) * 2;
}

function armorInfoRows(values, mech = state.selectedMech) {
  return INFO_COMPONENTS.map((component) => {
    const frontBase = baseMaxArmor(component.key, mech);
    const front = frontBase + quirkAdd(values, "armorresist", component.suffix);
    const rearBase = 0;
    const rear = component.rearSuffix
      ? rearBase + number(values.armorresist_all_additive) + number(values[`armorresist_${component.rearSuffix}_additive`])
      : null;
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

function structureInfoRows(values, mech = state.selectedMech) {
  return INFO_COMPONENTS.map((component) => {
    const base = number(currentDefinition(mech).components?.[component.key]?.hp);
    return {
      label: component.label,
      base,
      total: base + quirkAdd(values, "internalresist", component.suffix),
    };
  });
}

function combinedDurabilityRows(armorRows, structureRows) {
  return armorRows.map((armor, index) => {
    const structure = structureRows[index] || { base: 0, total: 0 };
    const frontBase = armor.frontBase + structure.base;
    const front = armor.front + structure.total;
    const rearBase = armor.rearBase;
    const rear = armor.rear;
    return {
      label: armor.label,
      totalBase: armor.totalBase + structure.base,
      total: armor.total + structure.total,
      frontBase,
      front,
      rearBase,
      rear,
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

function specMobilityText(finalText, hasDelta) {
  const finalClass = state.infoApplyQuirks && hasDelta ? "" : " spec-final-base";
  return `
    <span class="spec-value spec-mobility-value">
      <span class="spec-final${finalClass}">${finalText}</span>
      <span class="spec-detail spec-detail-empty"></span>
    </span>
  `;
}

function specMobilityValue(base, final, digits = 1, unit = "") {
  const hasDelta = Math.abs(final - base) >= 0.0001;
  const value = state.infoApplyQuirks && hasDelta ? final : base;
  return specMobilityText(`${formatInfoNumber(value, digits)}${unit}`, hasDelta);
}

function specMobilityList(baseValues, finalValues, digits = 1, unit = "") {
  const hasDelta = finalValues.some((value, index) => Math.abs(value - baseValues[index]) >= 0.0001);
  const values = state.infoApplyQuirks && hasDelta ? finalValues : baseValues;
  const finalText = `${values.map((value) => formatInfoNumber(value, digits)).join(" / ")}${unit}`;
  return specMobilityText(finalText, hasDelta);
}

function specAnglePair(baseTorso, finalTorso, arm, axis, digits = 1) {
  const torsoChanged = Math.abs(finalTorso - baseTorso) >= 0.0001;
  const torso = state.infoApplyQuirks && torsoChanged ? finalTorso : baseTorso;
  const torsoClass = state.infoApplyQuirks && torsoChanged ? "spec-angle-boosted" : "";
  return specMobilityText(`
    <span class="${torsoClass}">${formatInfoNumber(torso, digits)}</span>
    <span class="spec-speed-sep">/</span>
    <span>${formatInfoNumber(arm, digits)}</span>
  `, false);
}

function speedPairHtml(forward, reverse, forwardChanged, reverseChanged, digits = 1, unit = "") {
  const forwardClass = forwardChanged ? "spec-speed-boosted" : "";
  const reverseClass = reverseChanged ? "spec-speed-boosted" : "";
  return `
    <span class="${forwardClass}">${formatInfoNumber(forward, digits)}</span>
    <span class="spec-speed-sep">-</span>
    <span class="${reverseClass}">${formatInfoNumber(reverse, digits)}${unit}</span>
  `;
}

function specMobilitySpeed(baseForward, baseReverse, finalForward, finalReverse, digits = 1, unit = "") {
  const forwardChanged = Math.abs(finalForward - baseForward) >= 0.0001;
  const reverseChanged = Math.abs(finalReverse - baseReverse) >= 0.0001;
  const hasDelta = forwardChanged || reverseChanged;
  const forward = state.infoApplyQuirks && hasDelta ? finalForward : baseForward;
  const reverse = state.infoApplyQuirks && hasDelta ? finalReverse : baseReverse;
  const finalText = speedPairHtml(
    forward,
    reverse,
    state.infoApplyQuirks && forwardChanged,
    state.infoApplyQuirks && reverseChanged,
    digits,
    unit,
  );
  return specMobilityText(finalText, false);
}

function movementInfo(values, mech = state.selectedMech) {
  const stats = currentDefinition(mech).stats || {};
  const movement = currentDefinition(mech).movement || {};
  const tons = number(stats.MaxTons);
  const maxEngine = number(stats.MaxEngineRating);
  const baseSpeed = tons ? number(movement.MaxMovementSpeed) * maxEngine / tons : 0;
  const reverseMultiplier = number(movement.ReverseSpeedMultiplier);
  const speedMultiplier = quirkMultiplier(values, ["mechtopspeed_multiplier"]);
  const reverseSpeedMultiplier = quirkMultiplier(values, ["reversespeed_multiplier"]);
  const accelMultiplier = quirkMultiplier(values, ["mechacceleration_multiplier", "accellerp_all_multiplier"]);
  const decelMultiplier = quirkMultiplier(values, ["mechdeceleration_multiplier", "decellerp_all_multiplier"]);
  const turnMultiplier = quirkMultiplier(values, ["turnrate_multiplier", "turnlerp_all_multiplier"]);
  const baseAcceleration = number(movement.AccelLerpMidRate);
  const baseDeceleration = tons ? number(movement.DecelLerpMidRate) / tons : 0;
  const baseTurnSpeed = number(movement.TurnLerpMidRate) * 180 / Math.PI;
  const baseTorsoSpeed = number(movement.TorsoTurnSpeedYaw);
  const baseTorsoAngleYaw = number(movement.MaxTorsoAngleYaw);
  const baseTorsoAnglePitch = number(movement.MaxTorsoAnglePitch);
  const baseArmAngleYaw = number(movement.MaxArmRotationYaw);
  const baseArmAnglePitch = number(movement.MaxArmRotationPitch);
  const yawAngle = (number(movement.MaxTorsoAngleYaw) + number(values.torso_yawangle_additive)) * quirkMultiplier(values, ["torso_yawangle_multiplier"]);
  const pitchAngle = number(movement.MaxTorsoAnglePitch) + number(values.torso_pitchangle_additive);

  return {
    baseMaxSpeed: baseSpeed,
    maxSpeed: baseSpeed * speedMultiplier,
    baseReverseSpeed: baseSpeed * reverseMultiplier,
    reverseSpeed: baseSpeed * reverseMultiplier * speedMultiplier * reverseSpeedMultiplier,
    baseAcceleration,
    acceleration: baseAcceleration * accelMultiplier,
    baseDeceleration,
    deceleration: baseDeceleration * decelMultiplier,
    baseAngleX: [baseTorsoAngleYaw, baseArmAngleYaw],
    angleX: [yawAngle, baseArmAngleYaw],
    baseAngleY: [baseTorsoAnglePitch, baseArmAnglePitch],
    angleY: [pitchAngle, baseArmAnglePitch],
    baseTorsoSpeed,
    torsoSpeed: baseTorsoSpeed * quirkMultiplier(values, ["torso_yawspeed_multiplier"]),
    baseTurnSpeed,
    turnSpeed: baseTurnSpeed * turnMultiplier,
  };
}

function renderInfoTable(title, headers, rows, options = {}) {
  const classes = ["info-card", options.compact ? "info-card-compact" : ""].filter(Boolean).join(" ");
  return `
    <section class="${classes}">
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

function quirkSectionTitle(quirk) {
  const match = (quirk.source_text || "").match(/\b(\d+)pc\b/i);
  return match ? `SET OF ${match[1]}` : "QUIRKS";
}

function quirkToneClass(quirk) {
  const text = `${quirk.name || ""} ${quirk.display_name || ""}`.toLowerCase();
  if (text.includes("laser") || text.includes("energy")) return "quirk-tone-energy";
  if (text.includes("missile") || text.includes("lrm") || text.includes("srm") || text.includes("atm") || text.includes("narc")) return "quirk-tone-missile";
  if (text.includes("armor") || text.includes("structure") || text.includes("resist")) return "quirk-tone-armor";
  return "quirk-tone-default";
}

function quirkReduction(quirks, name) {
  const quirk = quirks.find((entry) => entry.name.toLowerCase() === name);
  return Math.max(0, -number(quirk?.value));
}

function weaponQuirkTargets() {
  if (state.weaponQuirkTargetCache) return state.weaponQuirkTargetCache;

  const aliasTypes = new Map();
  const weapons = [];
  for (const item of Object.values(state.equipment?.items || {})) {
    if (item.item_type !== "weapon" && item.family !== "weapons") continue;
    const type = String(item.hardpoint_type || item.stats?.type || "").toLowerCase();
    if (!["energy", "missile", "ballistic"].includes(type)) continue;

    const keys = new Set([
      item.name,
      item.display_name,
      ...(String(item.aliases || "").split(",")),
    ].map(normalizeLookupKey).filter(Boolean));

    weapons.push({ type, keys });

    for (const key of keys) {
      if (!aliasTypes.has(key)) aliasTypes.set(key, new Set());
      aliasTypes.get(key).add(type);
    }
  }

  state.weaponQuirkTargetCache = { aliasTypes, weapons };
  return state.weaponQuirkTargetCache;
}

function weaponQuirkTypeLookup() {
  if (state.weaponQuirkTypeCache) return state.weaponQuirkTypeCache;
  state.weaponQuirkTypeCache = weaponQuirkTargets().aliasTypes;
  return state.weaponQuirkTypeCache;
}

function cooldownQuirkPrefix(quirkName) {
  const name = String(quirkName || "").toLowerCase();
  if (!name.endsWith("_cooldown_multiplier") || DIRECT_COOLDOWN_QUIRKS.has(name)) return "";
  return normalizeLookupKey(name.replace(/_cooldown_multiplier$/, ""));
}

function cooldownQuirkWeaponType(quirkName) {
  const prefix = cooldownQuirkPrefix(quirkName);
  if (!prefix) return null;
  const types = weaponQuirkTypeLookup().get(prefix);
  if (!types || types.size !== 1) return null;
  return Array.from(types)[0];
}

function energyWeaponCooldownMax(quirks) {
  const activeCooldowns = quirks
    .map((quirk) => ({
      prefix: cooldownQuirkPrefix(quirk.name),
      value: Math.max(0, -number(quirk.value)),
    }))
    .filter((quirk) => quirk.prefix && quirk.value > 0);

  let maxCooldown = 0;
  for (const weapon of weaponQuirkTargets().weapons) {
    if (weapon.type !== "energy") continue;
    const cooldown = activeCooldowns.reduce((sum, quirk) => (
      weapon.keys.has(quirk.prefix) ? sum + quirk.value : sum
    ), 0);
    maxCooldown = Math.max(maxCooldown, cooldown);
  }
  return maxCooldown;
}

function formatQuirkSummaryPercent(value) {
  return value > 0 ? `${fmt(value * 100, 1)}%` : "-";
}

function attackQuirkSummary(quirks) {
  const allCooldown = quirkReduction(quirks, "all_cooldown_multiplier");
  const weaponCooldownMax = { energy: 0, missile: 0, ballistic: 0 };

  for (const quirk of quirks) {
    const type = cooldownQuirkWeaponType(quirk.name);
    if (!type) continue;
    weaponCooldownMax[type] = Math.max(weaponCooldownMax[type], Math.max(0, -number(quirk.value)));
  }

  const energyCooldown = allCooldown + quirkReduction(quirks, "energy_cooldown_multiplier") + energyWeaponCooldownMax(quirks);
  const groups = [
    {
      label: "ENERGY COOLDOWN",
      className: "quirk-tone-energy",
      value: energyCooldown,
    },
    {
      label: "MISSILE COOLDOWN",
      className: "quirk-tone-missile",
      value: allCooldown + quirkReduction(quirks, "missile_cooldown_multiplier") + weaponCooldownMax.missile,
    },
    {
      label: "BALLISTIC COOLDOWN",
      className: "quirk-tone-default",
      value: allCooldown + quirkReduction(quirks, "ballistic_cooldown_multiplier") + weaponCooldownMax.ballistic,
    },
  ];
  const maxCooldown = Math.max(allCooldown, ...groups.map((group) => group.value));
  if (maxCooldown <= 0) return "";

  return `
    <div class="quirk-summary">
      <div class="quirk-summary-title">ATTACK SUMMARY</div>
      <div class="quirk-summary-grid">
        <div class="quirk-summary-item quirk-summary-max">
          <span>MAX COOLDOWN</span>
          <strong>${formatQuirkSummaryPercent(maxCooldown)}</strong>
        </div>
        ${groups
          .map((group) => `
            <div class="quirk-summary-item ${group.className}">
              <span>${group.label}</span>
              <strong>${formatQuirkSummaryPercent(group.value)}</strong>
            </div>
          `)
          .join("")}
      </div>
    </div>
  `;
}

function renderQuirkList(quirks, emptyText = "No quirks") {
  if (!quirks.length) return `<div class="empty">${emptyText}</div>`;

  const sections = [];
  for (const quirk of quirks) {
    const title = quirkSectionTitle(quirk);
    let section = sections.find((entry) => entry.title === title);
    if (!section) {
      section = { title, quirks: [] };
      sections.push(section);
    }
    section.quirks.push(quirk);
  }

  return `${attackQuirkSummary(quirks)}${sections
    .map((section) => `
      <div class="quirk-section">
        ${section.title === "QUIRKS" ? "" : `<div class="quirk-section-title">${section.title}</div>`}
        <div class="quirk-rows">
          ${section.quirks
            .map((quirk) => {
              const tone = quirkToneClass(quirk);
              return `
                <div class="quirk ${tone}" title="${quirk.source_text || quirk.name}">
                  <span class="quirk-name">${quirk.display_name}</span>
                  <span class="quirk-value">${quirk.value_text}</span>
                </div>
              `;
            })
            .join("")}
        </div>
      </div>
    `)
    .join("")}`;
}

function renderInfoQuirks(quirks) {
  return `
    <section class="info-card info-quirks-card">
      <div class="section-title-row">
        <h3>QUIRKS</h3>
      </div>
      <div class="quirks">${renderQuirkList(quirks)}</div>
    </section>
  `;
}

function compareMechs() {
  return state.compareMechIds.map((id) => mechById(id)).filter(Boolean);
}

function compareBuildForMech(mech) {
  if (state.selectedMech && String(state.selectedMech.id) === String(mech.id)) {
    return state.currentBuild || loadBuild(mech);
  }
  return loadBuild(mech);
}

function infoDataForMech(mech) {
  const build = compareBuildForMech(mech);
  const values = state.infoApplyQuirks ? effectiveQuirkValues(mech, build) : {};
  const armorRows = armorInfoRows(values, mech);
  const structureRows = structureInfoRows(values, mech);
  const combinedRows = combinedDurabilityRows(armorRows, structureRows);
  const stats = currentDefinition(mech).stats || {};

  return {
    mech,
    stats,
    quirks: effectiveQuirks(mech, build),
    armorRows,
    structureRows,
    combinedRows,
    armorTotal: armorRows.reduce((sum, row) => sum + number(row.total), 0),
    armorBaseTotal: armorRows.reduce((sum, row) => sum + number(row.totalBase), 0),
    structureTotal: structureRows.reduce((sum, row) => sum + number(row.total), 0),
    structureBaseTotal: structureRows.reduce((sum, row) => sum + number(row.base), 0),
    combinedTotal: combinedRows.reduce((sum, row) => sum + number(row.total), 0),
    combinedBaseTotal: combinedRows.reduce((sum, row) => sum + number(row.totalBase), 0),
    movement: movementInfo(values, mech),
  };
}

function compareText(value) {
  return { text: value || "-", rank: null, deltaDigits: 1, deltaUnit: "" };
}

function formatCompareNumber(value, digits = 1) {
  if (!Number.isFinite(value)) return "-";
  for (let precision = digits; precision >= 0; precision -= 1) {
    const text = fmt(value, precision);
    if (text.length <= 4) return text;
  }
  return fmt(value, 0);
}

function signedCompareNumber(value, digits = 1) {
  if (!Number.isFinite(value)) return "-";
  return `${value >= 0 ? "+" : "-"}${formatCompareNumber(Math.abs(value), digits)}`;
}

function compareNumber(value, digits = 1, unit = "") {
  return {
    text: `${formatCompareNumber(value, digits)}${unit}`,
    rank: Number.isFinite(value) ? value : null,
    deltaDigits: digits,
    deltaUnit: unit,
  };
}

function compareNumberList(values, digits = 1, unit = "") {
  const numericValues = values.filter((value) => Number.isFinite(value));
  return {
    text: `${values.map((value) => formatCompareNumber(value, digits)).join("/")}${unit}`,
    rank: numericValues.length ? numericValues.reduce((sum, value) => sum + value, 0) : null,
    deltaDigits: digits,
    deltaUnit: unit,
  };
}

function sameCompareRank(a, b) {
  return Math.abs(a - b) < COMPARE_RANK_EPSILON;
}

function renderCompareDelta(delta, cell) {
  if (Math.abs(delta) < COMPARE_RANK_EPSILON) return "";
  const direction = delta > 0 ? "up" : "down";
  const icon = delta > 0 ? "▲" : "▼";
  return `
    <span class="compare-delta compare-delta-${direction}">
      <span class="compare-delta-icon" aria-hidden="true">${icon}</span>
      <span>${signedCompareNumber(delta, cell.deltaDigits)}${cell.deltaUnit}</span>
    </span>
  `;
}

function compareDeltaForCell(cell, cells, entry) {
  if (!state.compareShowDeltas) return "";
  if (!Number.isFinite(cell.rank)) return "";
  const rankedCells = cells.filter((item) => Number.isFinite(item.cell.rank));
  if (rankedCells.length < 2) return "";

  if (state.compareBaselineMechId !== null) {
    const baseline = rankedCells.find((item) => String(item.entry.mech.id) === String(state.compareBaselineMechId));
    if (!baseline || String(entry.mech.id) === String(state.compareBaselineMechId)) return "";
    return renderCompareDelta(cell.rank - baseline.cell.rank, cell);
  }

  const ranks = rankedCells.map((item) => item.cell.rank);
  const minRank = Math.min(...ranks);
  const maxRank = Math.max(...ranks);
  if (sameCompareRank(minRank, maxRank)) return "";
  const referenceRank = sameCompareRank(cell.rank, maxRank) ? minRank : maxRank;
  return renderCompareDelta(cell.rank - referenceRank, cell);
}

function compareColorClassForCell(cell, cells, entry) {
  if (!Number.isFinite(cell.rank)) return "";
  const rankedCells = cells.filter((item) => Number.isFinite(item.cell.rank));
  if (rankedCells.length < 2) return "";

  if (state.compareBaselineMechId !== null) {
    const baseline = rankedCells.find((item) => String(item.entry.mech.id) === String(state.compareBaselineMechId));
    if (!baseline || String(entry.mech.id) === String(state.compareBaselineMechId)) return "";
    if (sameCompareRank(cell.rank, baseline.cell.rank)) return "";
    return cell.rank > baseline.cell.rank ? "compare-high" : "compare-low";
  }

  const ranks = rankedCells.map((item) => item.cell.rank);
  const minRank = Math.min(...ranks);
  const maxRank = Math.max(...ranks);
  if (sameCompareRank(minRank, maxRank)) return "";
  if (sameCompareRank(cell.rank, maxRank)) return "compare-high";
  if (sameCompareRank(cell.rank, minRank)) return "compare-low";
  return "";
}

function renderCompareCell(row, data, entry) {
  const cells = data.map((dataEntry) => ({ entry: dataEntry, cell: row.value(dataEntry) }));
  const cell = cells.find((item) => item.entry === entry)?.cell || row.value(entry);
  const isBaseline = String(state.compareBaselineMechId) === String(entry.mech.id);
  const classAttribute = isBaseline ? ` class="compare-baseline-column"` : "";
  const ranks = cells
    .map((item) => item.cell.rank)
    .filter((rank) => Number.isFinite(rank));
  if (data.length < 2 || !Number.isFinite(cell.rank) || ranks.length < 2) {
    return `<td${classAttribute}><span class="compare-cell-value">${cell.text}</span></td>`;
  }

  const className = compareColorClassForCell(cell, cells, entry);
  return `
    <td${classAttribute}>
      <span class="compare-cell-value ${className}">${cell.text}</span>
      ${compareDeltaForCell(cell, cells, entry)}
    </td>
  `;
}

function renderCompareTable(mechs) {
  if (!mechs.length) {
    return `<div class="empty compare-empty">왼쪽 리스트에서 비교할 멕을 선택하세요.</div>`;
  }

  const data = mechs.map(infoDataForMech);
  const bodyRows = INFO_COMPONENTS.map((component, index) => ({
    label: component.label,
    combined: (entry) => compareNumber(entry.combinedRows[index].total, 0),
    armor: (entry) => compareNumber(entry.armorRows[index].total, 0),
    structure: (entry) => compareNumber(entry.structureRows[index].total, 0),
  }));
  const rows = [
    { group: "기본 정보" },
    { label: "톤수", value: (entry) => compareNumber(number(entry.stats.MaxTons), 0, "t") },
    { label: "진영", value: (entry) => compareText(entry.mech.faction || "Unknown") },
    { label: "체급", value: (entry) => compareText(WEIGHT_CLASS_LABELS[entry.mech.weight_class] || entry.mech.weight_class || "Unknown") },
    { label: "최소 엔진", value: (entry) => compareNumber(number(entry.stats.MinEngineRating), 0) },
    { label: "최대 엔진", value: (entry) => compareNumber(number(entry.stats.MaxEngineRating), 0) },
    { group: "내구도 요약" },
    { label: "아머 + 스트럭쳐 총합", value: (entry) => compareNumber(entry.combinedTotal, 0) },
    { label: "아머 총합", value: (entry) => compareNumber(entry.armorTotal, 0) },
    { label: "스트럭쳐 총합", value: (entry) => compareNumber(entry.structureTotal, 0) },
    { group: "기동성" },
    { label: "최대 속도", value: (entry) => compareNumber(entry.movement.maxSpeed, 1) },
    { label: "가속도", value: (entry) => compareNumber(entry.movement.acceleration, 1) },
    { label: "감속도", value: (entry) => compareNumber(entry.movement.deceleration, 1) },
    { label: "선회 속도", value: (entry) => compareNumber(entry.movement.turnSpeed, 2) },
    { label: "회전각 X", value: (entry) => compareNumberList(entry.movement.angleX, 1) },
    { label: "회전각 Y", value: (entry) => compareNumberList(entry.movement.angleY, 1) },
    { label: "몸통 회전속도", value: (entry) => compareNumber(entry.movement.torsoSpeed, 1) },
    { group: "종합 내구" },
    { label: "아머 + 스트럭쳐 총합", value: (entry) => compareNumber(entry.combinedTotal, 0) },
    ...bodyRows.map((row) => ({ label: row.label, value: row.combined })),
    { group: "아머 정보" },
    { label: "최대 아머 포인트 총합", value: (entry) => compareNumber(entry.armorTotal, 0) },
    ...bodyRows.map((row) => ({ label: row.label, value: row.armor })),
    { group: "스트럭쳐 정보" },
    { label: "스트럭쳐 총합", value: (entry) => compareNumber(entry.structureTotal, 0) },
    ...bodyRows.map((row) => ({ label: row.label, value: row.structure })),
    { group: "쿼크" },
    { label: "쿼크 수", value: (entry) => compareNumber(entry.quirks.length, 0) },
  ];

  return `
    <div class="compare-table-wrap">
      <table class="compare-table">
        <thead>
          <tr>
            <th scope="col">항목</th>
            ${data
              .map((entry) => {
                const isBaseline = String(state.compareBaselineMechId) === String(entry.mech.id);
                return `
                <th
                  class="${isBaseline ? "compare-baseline-column" : ""}"
                  data-compare-baseline="${entry.mech.id}"
                  scope="col"
                  title="기준으로 설정"
                >
                  <span class="compare-title">
                    <label class="compare-baseline-toggle" data-compare-baseline="${entry.mech.id}" title="기준">
                      <input
                        data-compare-baseline="${entry.mech.id}"
                        name="compare-baseline"
                        type="radio"
                        ${String(state.compareBaselineMechId) === String(entry.mech.id) ? "checked" : ""}
                      >
                      <span>기준</span>
                    </label>
                    <strong>${variantCode(entry.mech)}</strong>
                    <button class="compare-remove" data-remove-compare="${entry.mech.id}" type="button" aria-label="${entry.mech.display_name} 비교에서 제거">x</button>
                  </span>
                  <span class="compare-meta">${entry.mech.faction || "Unknown"} - ${entry.stats.MaxTons || "?"}t</span>
                </th>
              `;
              })
              .join("")}
          </tr>
        </thead>
        <tbody>
          ${rows
            .reduce((html, row) => {
              if (row.group) {
                const collapsed = state.collapsedCompareCategories.has(row.group);
                html.currentGroupCollapsed = collapsed;
                html.rows.push(`
                  <tr class="compare-group${collapsed ? " compare-group-collapsed" : ""}">
                    <th scope="row" colspan="${data.length + 1}">
                      <button class="compare-group-toggle" data-compare-category="${row.group}" type="button" aria-expanded="${!collapsed}">
                        <span class="compare-group-icon" aria-hidden="true">${collapsed ? "+" : "-"}</span>
                        <span>${row.group}</span>
                      </button>
                    </th>
                  </tr>
                `);
                return html;
              }
              if (html.currentGroupCollapsed) return html;
              html.rows.push(`
                <tr>
                  <th scope="row">${row.label}</th>
                  ${data.map((entry) => renderCompareCell(row, data, entry)).join("")}
                </tr>
              `);
              return html;
            }, { rows: [], currentGroupCollapsed: false }).rows
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

function compareSelectionText(mechs = compareMechs()) {
  return `${mechs.length}/${MAX_COMPARE_MECHS} 선택됨${mechs.length ? ` - ${mechs.map(variantCode).join(", ")}` : ""}`;
}

function renderCompareOverlayCell(entry) {
  const isBaseline = String(state.compareBaselineMechId) === String(entry.mech.id);
  return `
    <div
      class="compare-header-overlay-cell ${isBaseline ? "compare-baseline-column" : ""}"
      data-compare-baseline="${entry.mech.id}"
      title="기준으로 설정"
    >
      <span class="compare-title">
        <label class="compare-baseline-toggle" data-compare-baseline="${entry.mech.id}" title="기준">
          <input
            data-compare-baseline="${entry.mech.id}"
            name="compare-baseline-overlay"
            type="radio"
            ${isBaseline ? "checked" : ""}
          >
          <span>기준</span>
        </label>
        <strong>${variantCode(entry.mech)}</strong>
      </span>
      <span class="compare-meta">${entry.mech.faction || "Unknown"} - ${entry.stats.MaxTons || "?"}t</span>
    </div>
  `;
}

function renderCompareOverlayHeader(mechs) {
  return `
    <div class="compare-header-overlay-cell compare-header-overlay-item">항목</div>
    <div class="compare-header-overlay-track">
      ${mechs.map((mech) => renderCompareOverlayCell(infoDataForMech(mech))).join("")}
    </div>
  `;
}

function shouldShowCompareOverlay() {
  if (state.activeMainTab !== "compare") return false;
  const layout = $("mech-browser-layout");
  const table = document.querySelector(".compare-table");
  const tableHead = document.querySelector(".compare-table thead");
  const tabContent = document.querySelector(".tab-content");
  if (!layout || layout.hidden || !table || !tableHead || !tabContent) return false;
  const tableRect = table.getBoundingClientRect();
  const headRect = tableHead.getBoundingClientRect();
  const contentRect = tabContent.getBoundingClientRect();
  return headRect.bottom <= contentRect.top + 6 && tableRect.bottom > contentRect.top + 56;
}

function updateCompareOverlay() {
  const overlay = $("compare-overlay");
  if (!overlay) return;
  const mechs = compareMechs();
  const shouldShow = shouldShowCompareOverlay();
  if (!shouldShow) {
    overlay.hidden = true;
    return;
  }

  const cells = $("compare-overlay-cells");
  if (cells) {
    cells.innerHTML = renderCompareOverlayHeader(mechs);
  }

  const tableWrap = document.querySelector(".compare-table-wrap");
  const tabContent = document.querySelector(".tab-content");
  const tableHead = document.querySelector(".compare-table thead");
  const headerCells = Array.from(document.querySelectorAll(".compare-table thead th"));
  if (!tableWrap || !tabContent) {
    overlay.hidden = true;
    return;
  }

  const wrapRect = tableWrap.getBoundingClientRect();
  const contentRect = tabContent.getBoundingClientRect();
  const left = Math.max(wrapRect.left, contentRect.left);
  const right = Math.min(wrapRect.right, window.innerWidth - 8);
  const top = Math.max(contentRect.top, 0);
  const width = right - left;

  if (width < 80) {
    overlay.hidden = true;
    return;
  }

  const track = cells?.querySelector(".compare-header-overlay-track");
  const overlayCells = cells ? Array.from(cells.querySelectorAll(".compare-header-overlay-cell")) : [];
  overlayCells.forEach((cell, index) => {
    const headerCell = headerCells[index];
    if (!headerCell) return;
    const width = headerCell.getBoundingClientRect().width;
    cell.style.width = `${width}px`;
    cell.style.minWidth = `${width}px`;
  });
  if (track) {
    track.style.transform = `translateX(${-tableWrap.scrollLeft}px)`;
  }

  overlay.style.left = `${left}px`;
  overlay.style.top = `${top}px`;
  overlay.style.width = `${width}px`;
  overlay.style.height = tableHead ? `${tableHead.getBoundingClientRect().height}px` : "";
  overlay.hidden = false;
}

function renderInfoPanel() {
  $("info-apply-quirks").checked = state.infoApplyQuirks;

  updateCompareOverlay();
  $("mech-info").className = "info-grid";
  const mech = state.selectedMech;
  if (!mech) {
    $("info-variant-name").textContent = "멕을 선택하세요";
    $("info-variant-meta").textContent = "왼쪽 목록에서 카테고리를 펼친 뒤 멕을 선택하세요.";
    $("mech-info").innerHTML = "";
    updateCompareOverlay();
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
  const combinedRows = combinedDurabilityRows(armorRows, structureRows);
  const combinedTotal = combinedRows.reduce((sum, row) => sum + number(row.total), 0);
  const combinedBaseTotal = combinedRows.reduce((sum, row) => sum + number(row.totalBase), 0);
  const movement = movementInfo(values);

  $("info-variant-name").textContent = mech.display_name;
  $("info-variant-meta").textContent = `${mech.faction || "Unknown"} - ${WEIGHT_CLASS_LABELS[mech.weight_class] || mech.weight_class || "Unknown"} - ${stats.MaxTons || "?"} tons`;
  $("mech-info").innerHTML = [
    renderInfoTable("아머 정보", ["부위", "수치"], [
      ["최대 아머 포인트 총합", specValue(armorBaseTotal, armorTotal, 0)],
      ...armorRows.map((row) => [row.label, specValue(row.totalBase, row.total, 0)]),
    ], { compact: true }),
    renderInfoTable("스트럭쳐 정보", ["부위", "수치"], [
      ["스트럭쳐 총합", specValue(structureBaseTotal, structureTotal, 0)],
      ...structureRows.map((row) => [row.label, specValue(row.base, row.total, 0)]),
    ], { compact: true }),
    renderInfoTable("종합 내구", ["부위", "수치"], [
      ["아머 + 스트럭쳐 총합", specValue(combinedBaseTotal, combinedTotal, 0)],
      ...combinedRows.map((row) => [row.label, specValue(row.totalBase, row.total, 0)]),
    ], { compact: true }),
    renderInfoTable("엔진", ["항목", "수치"], [
      ["최소 엔진", formatInfoNumber(number(stats.MinEngineRating), 0)],
      ["최대 엔진", formatInfoNumber(number(stats.MaxEngineRating), 0)],
    ]),
    renderInfoTable("기동성", ["항목", "수치"], [
      ["최대 속도", specMobilitySpeed(movement.baseMaxSpeed, movement.baseReverseSpeed, movement.maxSpeed, movement.reverseSpeed, 1, " kph")],
      ["가속도", specMobilityValue(movement.baseAcceleration, movement.acceleration, 1, " kph/s")],
      ["감속도", specMobilityValue(movement.baseDeceleration, movement.deceleration, 1, " kph/s")],
      ["선회 속도", specMobilityValue(movement.baseTurnSpeed, movement.turnSpeed, 2, " deg/s")],
      ["회전각 X", specAnglePair(movement.baseAngleX[0], movement.angleX[0], movement.angleX[1], "X", 1)],
      ["회전각 Y", specAnglePair(movement.baseAngleY[0], movement.angleY[0], movement.angleY[1], "Y", 1)],
      ["몸통 회전속도", specMobilityValue(movement.baseTorsoSpeed, movement.torsoSpeed, 1, " deg/s")],
    ]),
    renderInfoQuirks(quirks),
  ].join("");
}

function renderComparePanel() {
  $("compare-deltas").checked = state.compareShowDeltas;
  $("compare-apply-quirks").checked = state.infoApplyQuirks;
  const mechs = compareMechs();
  $("compare-variant-name").textContent = "멕 비교";
  $("compare-variant-meta").textContent = compareSelectionText(mechs);
  $("compare-info").innerHTML = renderCompareTable(mechs);
  document.querySelector(".compare-table-wrap")?.addEventListener("scroll", updateCompareOverlay, { passive: true });
  updateCompareOverlay();
}

function statsDurabilityEntries() {
  return state.mechs
    .map((mech) => ({
      mech,
      total: mechListSummary(mech).combinedTotal,
    }))
    .sort((a, b) => b.total - a.total || (a.mech.display_name || "").localeCompare(b.mech.display_name || "", undefined, { numeric: true }));
}

function renderStatsPanel() {
  document.querySelectorAll("[data-stats-view]").forEach((button) => {
    const active = button.dataset.statsView === state.activeStatsView;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });

  if (state.activeStatsView !== "durability") {
    $("stats-meta").textContent = "";
    $("stats-list").innerHTML = "";
    return;
  }

  const entries = statsDurabilityEntries();
  $("stats-meta").textContent = `종합 내구도 총합 기준 - ${entries.length}개 멕`;
  $("stats-list").innerHTML = entries.length
    ? entries
        .map((entry, index) => `
          <div class="stats-row ${factionClass(entry.mech.faction)}">
            <span class="stats-rank">${index + 1}</span>
            <span class="stats-mech-main">
              <span class="mech-title-main">${omnipodIcon(entry.mech)}<strong>${entry.mech.display_name || variantCode(entry.mech)}</strong></span>
              <span class="stats-subline">${factionLabel(entry.mech.faction)} - ${entry.mech.definition?.stats?.MaxTons || "?"}t</span>
            </span>
            <span class="stats-value-block">
              <span>내구도</span>
              <strong>${formatInfoNumber(entry.total, 0)}</strong>
            </span>
            <span class="stats-extra ${weightClassClass(entry.mech.weight_class)}">
              <span class="badge weight-slot ${weightClassClass(entry.mech.weight_class)}">${WEIGHT_CLASS_LABELS[entry.mech.weight_class] || entry.mech.weight_class || "Unknown"}</span>
              <span class="stats-hardpoints">${stockHardpointBadges(entry.mech) || `<span class="badge">하드포인트 없음</span>`}</span>
            </span>
          </div>
        `)
        .join("")
    : `<div class="empty">표시할 멕이 없습니다.</div>`;
}

function calculateBuild() {
  const mech = state.selectedMech;
  const definition = effectiveDefinition(mech, state.currentBuild);
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
  const filtered = filteredMechsForList();
  const grouped = groupMechsForList(filtered);
  const activeChassis = activeChassisForList();
  const classNames = sortedClassNames(grouped);

  const layout = $("mech-browser-layout");
  const list = $("mech-list");
  const toggle = $("mech-list-view-toggle");
  layout.classList.toggle("large-mech-list-layout", state.largeMechList);
  list.classList.toggle("mech-list-large", state.largeMechList);
  if (toggle) {
    toggle.classList.toggle("active", state.largeMechList);
    toggle.setAttribute("aria-pressed", String(state.largeMechList));
    toggle.textContent = state.largeMechList ? "<<" : ">>";
    toggle.title = state.largeMechList ? "작은 리스트 보기" : "큰 리스트 보기";
  }

  if (!filtered.length) {
    $("mech-list").innerHTML = `<div class="empty">No mechs match the current filters.</div>`;
    return;
  }

  if (state.largeMechList) {
    renderLargeMechList(classNames, grouped, activeChassis);
    return;
  }

  $("mech-list").innerHTML = classNames
    .map((weightClass) => {
      const chassisGroups = chassisGroupsForWeight(grouped, weightClass);
      const factionSections = factionSectionsForChassisGroups(chassisGroups);
      const count = chassisGroups.reduce((sum, group) => sum + group.variants.length, 0);
      return `
        <section class="class-section">
          <div class="class-heading">
            <strong>${WEIGHT_CLASS_LABELS[weightClass] || formatChassisName(weightClass)}</strong>
            <span>${chassisGroups.length} chassis / ${count} variants</span>
          </div>
          ${factionSections.map((section) => renderFactionSection(section, activeChassis, false)).join("")}
        </section>
      `;
    })
    .join("");
}

function filteredMechsForList() {
  const search = $("mech-search").value.trim().toLowerCase();
  const factionFilter = $("faction-filter").value;
  const weightFilter = $("weight-filter").value;
  return state.mechs.filter((mech) => {
    const matchesSearch = !search || `${mech.display_name} ${mech.name} ${mech.chassis}`.toLowerCase().includes(search);
    const matchesFaction = !factionFilter || mech.faction === factionFilter;
    const matchesWeight = !weightFilter || mech.weight_class === weightFilter;
    return matchesSearch && matchesFaction && matchesWeight;
  });
}

function activeChassisForList() {
  const firstCompareMech = compareMechs()[0];
  return state.selectedChassis || (state.compareMode ? firstCompareMech?.chassis : state.selectedMech?.chassis) || "";
}

function findChassisGroupForCurrentList(chassis) {
  const grouped = groupMechsForList(filteredMechsForList());
  for (const weightClass of sortedClassNames(grouped)) {
    const group = chassisGroupsForWeight(grouped, weightClass).find((item) => item.chassis === chassis);
    if (group) return group;
  }
  return null;
}

function chassisGroupElement(chassis) {
  return Array.from($("mech-list").querySelectorAll(".chassis-group"))
    .find((element) => element.dataset.chassisGroup === chassis) || null;
}

function syncMechListActiveStates(activeChassis = activeChassisForList()) {
  const selectedMechId = state.selectedMech?.id;
  const compareIds = new Set(state.compareMechIds.map((id) => String(id)));
  $("mech-list").querySelectorAll(".chassis-group").forEach((group) => {
    const active = group.dataset.chassisGroup === activeChassis;
    group.classList.toggle("active", active);
    group.querySelector("[data-chassis]")?.classList.toggle("active", active);
  });
  $("mech-list").querySelectorAll("[data-mech]").forEach((button) => {
    const mech = mechById(button.dataset.mech);
    const selected = state.compareMode
      ? compareIds.has(String(button.dataset.mech))
      : String(selectedMechId || "") === String(button.dataset.mech);
    button.classList.toggle("active", selected);
    if (button.classList.contains("mech-card")) {
      button.classList.toggle("chassis-active", mech?.chassis === activeChassis);
    }
  });
}

function renderChassisGroupInPlace(chassis) {
  const element = chassisGroupElement(chassis);
  const group = findChassisGroupForCurrentList(chassis);
  if (!element || !group) return false;
  const activeChassis = activeChassisForList();
  element.outerHTML = state.largeMechList
    ? renderLargeChassisGroup(group, activeChassis)
    : renderSmallChassisGroup(group, activeChassis);
  syncMechListActiveStates(activeChassis);
  return true;
}

function renderLargeMechList(classNames, grouped, activeChassis) {
  $("mech-list").innerHTML = classNames
    .map((weightClass) => {
      const chassisGroups = chassisGroupsForWeight(grouped, weightClass);
      const factionSections = factionSectionsForChassisGroups(chassisGroups);
      const count = chassisGroups.reduce((sum, group) => sum + group.variants.length, 0);
      return `
        <section class="class-section mech-card-section">
          <div class="class-heading">
            <strong>${WEIGHT_CLASS_LABELS[weightClass] || formatChassisName(weightClass)}</strong>
            <span>${chassisGroups.length} chassis / ${count} variants</span>
          </div>
          ${factionSections.map((section) => renderFactionSection(section, activeChassis, true)).join("")}
        </section>
      `;
    })
    .join("");
}

function renderFactionSection(section, activeChassis, large) {
  const listClass = large ? "chassis-list large-chassis-list" : "chassis-list";
  const groupHtml = section.groups.map((group) => large ? renderLargeChassisGroup(group, activeChassis) : renderSmallChassisGroup(group, activeChassis)).join("");
  return `
    <section class="faction-section ${factionClass(section.faction)}">
      <div class="faction-heading ${factionClass(section.faction)}">
        <strong>${factionLabel(section.faction)}</strong>
        <span>${section.groups.length} chassis / ${section.variantCount} variants</span>
      </div>
      <div class="${listClass}">
        ${groupHtml}
      </div>
    </section>
  `;
}

function renderSmallChassisGroup(group, activeChassis) {
  const active = group.chassis === activeChassis ? " active" : "";
  const expanded = state.expandedChassis.has(group.chassis);
  return `
    <div class="chassis-group${active}${expanded ? " expanded" : ""}" data-chassis-group="${group.chassis}">
      <button class="chassis-row${active}" data-chassis="${group.chassis}" type="button" aria-expanded="${expanded}">
        <span class="row-title">
          <span class="chassis-title"><span class="expand-indicator" aria-hidden="true">${expanded ? "-" : "+"}</span><strong>${group.label}</strong></span>
          <span>${group.tons}t</span>
        </span>
        <span class="badge-line">
          <span class="badge">${group.variants.length} variants</span>
        </span>
      </button>
      ${expanded ? `
        <div class="variant-list">
          ${group.variants.map(renderVariantRow).join("")}
        </div>
      ` : ""}
    </div>
  `;
}

function renderVariantRow(mech) {
  const isSelected = state.compareMode
    ? state.compareMechIds.some((id) => String(id) === String(mech.id))
    : state.selectedMech?.id === mech.id;
  const selected = isSelected ? " active" : "";
  return `
    <button class="mech-row variant-row${selected}" data-mech="${mech.id}" type="button">
      <span class="row-title">
        <span class="mech-title-main">${omnipodIcon(mech)}<strong>${variantCode(mech)}</strong></span>
        <span>${mech.faction || "unknown"}</span>
      </span>
      <span class="badge-line">${stockHardpointBadges(mech)}</span>
    </button>
  `;
}

function renderLargeChassisGroup(group, activeChassis) {
  const active = group.chassis === activeChassis ? " active" : "";
  const expanded = state.expandedChassis.has(group.chassis);
  return `
    <div class="chassis-group${active}${expanded ? " expanded" : ""}" data-chassis-group="${group.chassis}">
      <button class="chassis-row large-chassis-row${active}" data-chassis="${group.chassis}" type="button" aria-expanded="${expanded}">
        <span class="chassis-title">
          <span class="expand-indicator" aria-hidden="true">${expanded ? "-" : "+"}</span>
          <strong>${group.label}</strong>
        </span>
        <span class="large-chassis-ton">${group.tons}t</span>
        <span class="large-chassis-count">${group.variants.length}</span>
      </button>
      ${expanded ? `
        <div class="mech-card-grid">
          ${group.variants.map((mech) => renderMechCard(mech, activeChassis)).join("")}
        </div>
      ` : ""}
    </div>
  `;
}

function renderMechCard(mech, activeChassis) {
  const data = mechListSummary(mech);
  const selected = state.compareMode
    ? state.compareMechIds.some((id) => String(id) === String(mech.id))
    : state.selectedMech?.id === mech.id;
  const active = selected ? " active" : "";
  const chassisActive = mech.chassis === activeChassis ? " chassis-active" : "";
  const durabilityBoosted = state.infoApplyQuirks && Math.abs(data.combinedTotal - data.baseCombinedTotal) >= 0.0001;
  const accelerationBoosted = state.infoApplyQuirks && Math.abs(data.movement.acceleration - data.baseMovement.acceleration) >= 0.0001;
  const decelerationBoosted = state.infoApplyQuirks && Math.abs(data.movement.deceleration - data.baseMovement.deceleration) >= 0.0001;
  const turnBoosted = state.infoApplyQuirks && Math.abs(data.movement.turnSpeed - data.baseMovement.turnSpeed) >= 0.0001;
  return `
    <button class="mech-card${active}${chassisActive}" data-mech="${mech.id}" type="button">
      <span class="mech-card-title">
        <strong>${omnipodIcon(mech)}<span>${mech.display_name || variantCode(mech)}</span></strong>
        <span>${mech.faction || "Unknown"} · ${data.stats.MaxTons || "?"}t</span>
      </span>
      <span class="mech-card-stats">
        <span><span>총 내구도</span><strong class="${durabilityBoosted ? "boosted" : ""}">${formatInfoNumber(data.combinedTotal, 0)}</strong></span>
        <span><span>가속/감속</span><strong><span class="${accelerationBoosted ? "boosted" : ""}">${formatInfoNumber(data.movement.acceleration, 1)}</span> / <span class="${decelerationBoosted ? "boosted" : ""}">${formatInfoNumber(data.movement.deceleration, 1)}</span></strong></span>
        <span><span>선회속도</span><strong class="${turnBoosted ? "boosted" : ""}">${formatInfoNumber(data.movement.turnSpeed, 2)}</strong></span>
      </span>
      <span class="badge-line">${stockHardpointBadges(mech)}</span>
    </button>
  `;
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
  const calc = calculateBuild();
  $("components").innerHTML = COMPONENT_ORDER.map((name) => {
    const buildComp = state.currentBuild.components[name] || { items: [] };
    const compDef = effectiveComponentDefinition(state.selectedMech, state.currentBuild, name);
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
  $("quirk-count").textContent = "";
  $("quirks").innerHTML = renderQuirkList(quirks, "No quirks found for this mech.");
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

function renderSelectionPrompt() {
  $("variant-name").textContent = "멕을 선택하세요";
  $("variant-meta").textContent = "왼쪽 목록에서 카테고리를 펼친 뒤 멕을 선택하세요.";
  renderSummary();
  $("quirk-count").textContent = "";
  $("quirks").innerHTML = `<div class="empty">멕을 선택하면 쿼크가 표시됩니다.</div>`;
  $("components").innerHTML = `<div class="empty">멕을 선택하면 구성 부품이 표시됩니다.</div>`;
}

function renderAll() {
  renderMechList();
  renderEquipmentList();
  renderSelectedItem();
  renderInfoPanel();
  renderComparePanel();
  renderStatsPanel();
  if (state.selectedMech) {
    renderVariant();
  } else {
    renderSelectionPrompt();
  }
}

function selectMech(id) {
  state.selectedMech = mechById(id) || state.mechs[0];
  state.selectedChassis = state.selectedMech?.chassis || "";
  if (state.selectedChassis) state.expandedChassis.add(state.selectedChassis);
  state.currentBuild = loadBuild(state.selectedMech);
  renderAll();
}

function toggleCompareMech(id) {
  const mech = mechById(id);
  if (!mech) return;
  const index = state.compareMechIds.findIndex((mechId) => String(mechId) === String(id));
  if (index >= 0) {
    state.compareMechIds.splice(index, 1);
    if (String(state.compareBaselineMechId) === String(id)) {
      state.compareBaselineMechId = null;
    }
    if (!state.compareMechIds.length) {
      state.selectedChassis = "";
    }
  } else if (state.compareMechIds.length < MAX_COMPARE_MECHS) {
    state.compareMechIds.push(mech.id);
    state.selectedChassis = mech.chassis || state.selectedChassis;
  } else {
    $("data-status").textContent = `비교는 최대 ${MAX_COMPARE_MECHS}개까지 선택할 수 있습니다.`;
    return;
  }
  if (state.selectedChassis) state.expandedChassis.add(state.selectedChassis);
  renderAll();
}

function removeCompareMech(id) {
  const index = state.compareMechIds.findIndex((mechId) => String(mechId) === String(id));
  if (index < 0) return;
  state.compareMechIds.splice(index, 1);
  if (String(state.compareBaselineMechId) === String(id)) {
    state.compareBaselineMechId = null;
  }
  if (!state.compareMechIds.length) {
    state.selectedChassis = "";
  }
  renderAll();
}

function clearCompareMechs() {
  state.compareMechIds = [];
  state.compareBaselineMechId = null;
  if (state.compareMode) {
    state.selectedChassis = "";
  }
  renderAll();
}

function toggleCompareBaseline(id) {
  const exists = state.compareMechIds.some((mechId) => String(mechId) === String(id));
  if (!exists) return;
  state.compareBaselineMechId = String(state.compareBaselineMechId) === String(id) ? null : id;
  renderComparePanel();
}

function toggleCompareCategory(category) {
  if (!category) return;
  if (state.collapsedCompareCategories.has(category)) {
    state.collapsedCompareCategories.delete(category);
  } else {
    state.collapsedCompareCategories.add(category);
  }
  renderComparePanel();
}

function selectItem(id) {
  state.selectedItemId = id;
  renderEquipmentList();
  renderSelectedItem();
}

function addSelectedItem(component) {
  const item = itemById(state.selectedItemId);
  if (!item || !state.currentBuild?.components?.[component]) return;
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
  const items = state.currentBuild?.components?.[component]?.items;
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
  $("weight-filter").addEventListener("change", renderMechList);
  $("mech-sort").addEventListener("change", (event) => {
    state.mechSort = event.target.value;
    renderMechList();
  });
  $("item-search").addEventListener("input", renderEquipmentList);
  $("item-family").addEventListener("change", renderEquipmentList);
  $("info-apply-quirks").addEventListener("change", (event) => {
    state.infoApplyQuirks = event.target.checked;
    renderMechList();
    renderInfoPanel();
    renderComparePanel();
    renderStatsPanel();
  });
  $("mech-list-view-toggle").addEventListener("click", () => {
    state.largeMechList = !state.largeMechList;
    renderMechList();
    updateCompareOverlay();
  });
  $("compare-clear-compare").addEventListener("click", clearCompareMechs);
  $("compare-deltas").addEventListener("change", (event) => {
    state.compareShowDeltas = event.target.checked;
    renderComparePanel();
  });
  $("compare-apply-quirks").addEventListener("change", (event) => {
    state.infoApplyQuirks = event.target.checked;
    renderMechList();
    renderInfoPanel();
    renderComparePanel();
    renderStatsPanel();
  });
  document.querySelectorAll("[data-stats-view]").forEach((button) => {
    button.addEventListener("click", () => {
      state.activeStatsView = button.dataset.statsView;
      renderStatsPanel();
    });
  });
  $("compare-overlay").addEventListener("click", (event) => {
    const remove = event.target.closest("[data-remove-compare]");
    if (remove) {
      removeCompareMech(remove.dataset.removeCompare);
      return;
    }
    const baseline = event.target.closest("[data-compare-baseline]");
    if (baseline) {
      event.preventDefault();
      toggleCompareBaseline(baseline.dataset.compareBaseline);
    }
  });
  document.querySelector(".tab-content").addEventListener("scroll", updateCompareOverlay, { passive: true });
  window.addEventListener("resize", updateCompareOverlay, { passive: true });
  $("compare-info").addEventListener("click", (event) => {
    const remove = event.target.closest("[data-remove-compare]");
    if (remove) {
      removeCompareMech(remove.dataset.removeCompare);
      return;
    }
    const category = event.target.closest("[data-compare-category]");
    if (category) {
      event.preventDefault();
      toggleCompareCategory(category.dataset.compareCategory);
      return;
    }
    const baseline = event.target.closest("[data-compare-baseline]");
    if (baseline) {
      event.preventDefault();
      toggleCompareBaseline(baseline.dataset.compareBaseline);
      return;
    }
  });

  $("mech-list").addEventListener("click", (event) => {
    const chassis = event.target.closest("[data-chassis]");
    if (chassis) {
      state.selectedChassis = chassis.dataset.chassis;
      if (state.expandedChassis.has(state.selectedChassis)) {
        state.expandedChassis.delete(state.selectedChassis);
      } else {
        state.expandedChassis.add(state.selectedChassis);
      }
      if (!renderChassisGroupInPlace(state.selectedChassis)) {
        renderMechList();
      }
      updateCompareOverlay();
      return;
    }
    const button = event.target.closest("[data-mech]");
    if (button) {
      if (state.compareMode) {
        toggleCompareMech(button.dataset.mech);
      } else {
        selectMech(button.dataset.mech);
      }
    }
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
    if (!state.selectedMech) return;
    state.currentBuild = buildFromLoadout(state.selectedMech);
    renderVariant();
  });
  $("save-build").addEventListener("click", () => {
    if (!state.selectedMech || !state.currentBuild) return;
    localStorage.setItem(savedKey(state.selectedMech), JSON.stringify(state.currentBuild));
    $("data-status").textContent = "Build saved locally";
  });
  $("clear-build").addEventListener("click", () => {
    if (!state.currentBuild) return;
    for (const component of Object.values(state.currentBuild.components)) {
      component.items = [];
    }
    renderVariant();
  });
}

async function loadJson(path) {
  try {
    const response = await fetch(path);
    if (!response.ok) throw new Error(`Could not load ${path}`);
    return response.json();
  } catch (error) {
    if (location.protocol === "file:") {
      throw new Error("Local data cannot be loaded from file://. Serve the public folder over http:// for local preview.");
    }
    throw error;
  }
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
    renderAll();
  } catch (error) {
    $("data-status").textContent = error.message;
    console.error(error);
  }
}

init();
