#!/usr/bin/env python3
import argparse
import json
import os
import sys
import zipfile
from collections import defaultdict
from pathlib import Path
from xml.etree import ElementTree as ET

GAME_DATA_PAK = Path("Game") / "GameData.pak"
LOCALIZATION_PAK = Path("Game") / "Localized" / "English_xml.pak"
MECHS_DIR = Path("Game") / "mechs"

HARDPOINT_TYPES = {
    "0": "ballistic",
    "1": "energy",
    "2": "missile",
    "3": "ams",
    "4": "ecm",
}

ITEM_FILES = [
    ("weapons", "Libs/Items/Weapons/Weapons.xml"),
    ("ammo", "Libs/Items/Modules/Ammo.xml"),
    ("engines", "Libs/Items/Modules/Engines.xml"),
    ("equipment", "Libs/Items/Modules/Equipment.xml"),
    ("internals", "Libs/Items/Modules/Internals.xml"),
    ("jumpjets", "Libs/Items/Modules/JumpJets.xml"),
    ("masc", "Libs/Items/Modules/MASC.xml"),
    ("weapon_mods", "Libs/Items/Modules/WeaponMods.xml"),
    ("upgrades", "Libs/Items/UpgradeTypes/UpgradeTypes.xml"),
]


def parse_xml(data: bytes, source: str):
    try:
        return ET.fromstring(data)
    except ET.ParseError as exc:
        raise RuntimeError(f"Could not parse {source}: {exc}") from exc


def maybe_num(value):
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return value
    text = str(value).strip()
    if text == "":
        return text
    try:
        if text.lower().startswith("0x"):
            return text
        if any(ch in text for ch in [".", "e", "E"]):
            return float(text)
        return int(text)
    except ValueError:
        return text


def attrs(element):
    return {key: maybe_num(value) for key, value in element.attrib.items()}


def loc_data(element):
    loc = element.find("Loc")
    if loc is None:
        return {}
    return {
        "name_tag": loc.attrib.get("nameTag", ""),
        "desc_tag": loc.attrib.get("descTag", ""),
        "icon_tag": loc.attrib.get("iconTag", ""),
    }


def display_from_tag(tag, localization, fallback):
    if not tag:
        return fallback
    key = tag[1:] if tag.startswith("@") else tag
    return localization.get(key, fallback)


def parse_localization(game_dir: Path):
    loc_pak = game_dir / LOCALIZATION_PAK
    if not loc_pak.exists():
        return {}
    with zipfile.ZipFile(loc_pak) as zf:
        root = parse_xml(zf.read("Localization/English/TheRealLoc.xml"), "TheRealLoc.xml")

    ns = {"ss": "urn:schemas-microsoft-com:office:spreadsheet"}
    data = {}
    for row in root.findall(".//ss:Row", ns):
        values = []
        for cell in row.findall("ss:Cell", ns):
            node = cell.find("ss:Data", ns)
            values.append(node.text if node is not None and node.text is not None else "")
        if len(values) >= 2:
            key = values[0].strip()
            value = values[1].strip()
            if key and value and key.lower() not in {"id", "name", "key"}:
                data[key] = value
    return data


def parse_item(element, family, localization):
    loc = loc_data(element)
    item = {
        "id": int(element.attrib["id"]),
        "name": element.attrib.get("name", ""),
        "family": family,
        "kind": element.tag.lower(),
        "ctype": element.attrib.get("CType", ""),
        "faction": element.attrib.get("faction", ""),
        "aliases": element.attrib.get("HardpointAliases", ""),
        "loc": loc,
        "display_name": display_from_tag(loc.get("name_tag"), localization, element.attrib.get("name", "")),
        "description": display_from_tag(loc.get("desc_tag"), localization, ""),
        "icon": "",
        "stats": {},
        "ranges": [],
    }

    for child in element:
        if child.tag.endswith("Stats") or child.tag == "ModuleStats":
            item["stats"].update(attrs(child))
        elif child.tag == "Ranges":
            item["ranges"] = [attrs(range_node) for range_node in child.findall("Range")]

    if family == "engines":
        item["item_type"] = "engine"
    elif family == "weapons":
        item["item_type"] = "weapon"
    elif family == "ammo":
        item["item_type"] = "ammo"
    elif family == "internals":
        item["item_type"] = "internal"
    elif family == "jumpjets":
        item["item_type"] = "jumpjet"
    elif family == "masc":
        item["item_type"] = "masc"
    elif family == "weapon_mods":
        item["item_type"] = "weapon_mod"
    elif family == "upgrades":
        item["item_type"] = "upgrade"
    else:
        item["item_type"] = "module"

    if item["stats"].get("type"):
        item["hardpoint_type"] = str(item["stats"]["type"]).lower()
    return item


def quirk_loc_candidates(name):
    base = name.lower()
    short = base.replace("_multiplier", "_mult").replace("_additive", "_add")
    candidates = [
        f"qrk_{short}",
        f"ui_quirk_{base}",
    ]
    aliases = {
        "critchance": "crit_chance",
        "armorresist": "armor_resist",
        "internalresist": "internal_resist",
        "heatdissipation": "heat_loss",
        "overheatdamage": "overheat_damage",
        "xpbonus": "xp_bonus",
        "cbbonus": "cb_bonus",
        "torso_yawangle": "torso_angle_yaw",
        "torso_pitchangle": "torso_angle_pitch",
    }
    for old, new in aliases.items():
        if old in base:
            candidates.append(f"ui_quirk_{base.replace(old, new)}")
        if old in short:
            candidates.append(f"qrk_{short.replace(old, new)}")
    return candidates


def fallback_quirk_name(name):
    text = name.lower()
    text = text.replace("_multiplier", "").replace("_additive", "")
    replacements = {
        "is": "IS ",
        "clan": "Clan ",
        "armorresist": "Armor",
        "internalresist": "Structure",
        "critchance": "Crit Chance",
        "heatdissipation": "Heat Dissipation",
        "overheatdamage": "Overheat Damage",
        "xpbonus": "XP Bonus",
        "cbbonus": "C-Bills Bonus",
        "ammocapacity": "Ammo Capacity",
        "cooldown": "Cooldown",
        "velocity": "Velocity",
        "range": "Range",
        "heat": "Heat",
        "duration": "Duration",
        "spread": "Spread",
        "jamchance": "Jam Chance",
        "jamtime": "Jam Time",
    }
    words = []
    for part in text.split("_"):
        words.append(replacements.get(part, part.replace("autocannon", "AutoCannon ").title()))
    return " ".join(words).replace("  ", " ").strip()


def format_quirk_value(name, value):
    numeric = maybe_num(value)
    if not isinstance(numeric, (int, float)):
        return str(value)
    if name.endswith("_multiplier"):
        percent = numeric * 100
        return f"{percent:+g}%"
    if name.endswith("_additive"):
        return f"{numeric:+g}"
    return f"{numeric:+g}"


def parse_quirk_node(node, localization, source=""):
    name = node.attrib.get("name", "")
    value = maybe_num(node.attrib.get("value", 0))
    display = ""
    for key in quirk_loc_candidates(name):
        if key in localization:
            display = localization[key]
            break
    if not display:
        display = fallback_quirk_name(name)
    return {
        "name": name,
        "value": value,
        "value_text": format_quirk_value(name, value),
        "display_name": display,
        "source": source,
    }


def parse_quirks(parent, localization, source=""):
    if parent is None:
        return []
    return [parse_quirk_node(node, localization, source) for node in parent.findall("Quirk")]


def parse_items(game_data, localization):
    items_by_id = {}
    by_family = defaultdict(list)

    for family, inner_path in ITEM_FILES:
        root = parse_xml(game_data.read(inner_path), inner_path)
        for element in list(root):
            if "id" not in element.attrib:
                continue
            item = parse_item(element, family, localization)
            items_by_id[str(item["id"])] = item
            by_family[family].append(item["id"])

    return items_by_id, by_family


def parse_mech_list(game_data):
    root = parse_xml(game_data.read("Libs/Items/Mechs/Mechs.xml"), "Mechs.xml")
    mechs = {}
    for node in root.findall("Mech"):
        mech = attrs(node)
        mech["id"] = int(mech["id"])
        mech["name"] = str(mech["name"]).lower()
        mech["chassis"] = str(mech["chassis"]).lower()
        mechs[str(mech["id"])] = mech
    return mechs


def parse_loadouts(game_data):
    loadouts = {}
    loadout_names = [name for name in game_data.namelist() if name.startswith("Libs/MechLoadout/") and name.endswith(".xml")]
    for inner_path in loadout_names:
        root = parse_xml(game_data.read(inner_path), inner_path)
        name = Path(inner_path).stem.lower()
        loadout = {
            "name": name,
            "display_name": root.attrib.get("Name", name).strip(),
            "mech_id": maybe_num(root.attrib.get("MechID")),
            "public": maybe_num(root.attrib.get("Public", "0")),
            "upgrades": {},
            "components": {},
        }

        upgrades = root.find("Upgrades")
        if upgrades is not None:
            for upgrade in list(upgrades):
                loadout["upgrades"][upgrade.tag.lower()] = attrs(upgrade)

        component_list = root.find("ComponentList")
        if component_list is not None:
            for comp in component_list.findall("component"):
                comp_name = comp.attrib.get("Name", "").lower()
                payload = {
                    "armor": maybe_num(comp.attrib.get("Armor", 0)),
                    "omnipod": maybe_num(comp.attrib.get("OmniPod")),
                    "items": [],
                }
                for child in list(comp):
                    item_id = child.attrib.get("ItemID")
                    if item_id is None:
                        continue
                    payload["items"].append({
                        "type": child.tag.lower(),
                        "item_id": int(item_id),
                        "weapon_group": maybe_num(child.attrib.get("WeaponGroup")),
                    })
                loadout["components"][comp_name] = payload
        loadouts[name] = loadout
    return loadouts


def parse_mdf(data: bytes, source: str, localization):
    root = parse_xml(data, source)
    mech_node = root.find("Mech")
    if mech_node is None:
        return None
    definition = {
        "variant": mech_node.attrib.get("Variant", Path(source).stem).lower(),
        "stats": attrs(mech_node),
        "movement": attrs(root.find("MovementTuningConfiguration")) if root.find("MovementTuningConfiguration") is not None else {},
        "components": {},
        "quirks": parse_quirks(root.find("QuirkList"), localization, "variant"),
    }
    component_list = root.find("ComponentList")
    if component_list is None:
        return definition

    for comp in component_list.findall("Component"):
        name = comp.attrib.get("Name", "").lower()
        hardpoints = []
        internals = []
        for child in list(comp):
            if child.tag == "Hardpoint":
                hp = attrs(child)
                hp["hardpoint_type"] = HARDPOINT_TYPES.get(str(hp.get("Type")), str(hp.get("Type", "")).lower())
                hardpoints.append(hp)
            elif child.tag == "Internal" and child.attrib.get("ItemID"):
                internals.append(int(child.attrib["ItemID"]))
        definition["components"][name] = {
            "name": name,
            "slots": maybe_num(comp.attrib.get("Slots", 0)),
            "hp": maybe_num(comp.attrib.get("HP", 0)),
            "hardpoints": hardpoints,
            "internals": internals,
        }
    return definition


def parse_detailed_omnipods(zf, localization):
    details = {}
    for inner_path in zf.namelist():
        if not inner_path.lower().endswith("-omnipods.xml"):
            continue
        try:
            root = parse_xml(zf.read(inner_path), inner_path)
        except Exception:
            continue
        chassis = Path(inner_path).parent.name.lower()
        for set_node in root.findall("Set"):
            set_name = set_node.attrib.get("name", "").lower()
            set_bonuses = []
            bonuses = set_node.find("SetBonuses")
            if bonuses is not None:
                for bonus in bonuses.findall("Bonus"):
                    set_bonuses.append({
                        "piece_count": maybe_num(bonus.attrib.get("PieceCount", 0)),
                        "quirks": parse_quirks(bonus, localization, "set bonus"),
                    })
            for comp in set_node.findall("component"):
                component = comp.attrib.get("name", "").lower()
                details[f"{chassis}|{set_name}|{component}"] = {
                    "chassis": chassis,
                    "set": set_name,
                    "component": component,
                    "quirks": parse_quirks(comp, localization, "omnipod"),
                    "set_bonuses": set_bonuses,
                }
    return details


def parse_mech_definitions(game_dir: Path, localization):
    definitions = {}
    omnipod_details = {}
    mech_dir = game_dir / MECHS_DIR
    if not mech_dir.exists():
        return definitions, omnipod_details
    for pak_path in sorted(mech_dir.glob("*.pak")):
        try:
            with zipfile.ZipFile(pak_path) as zf:
                omnipod_details.update(parse_detailed_omnipods(zf, localization))
                for inner_path in zf.namelist():
                    if not inner_path.lower().endswith(".mdf"):
                        continue
                    try:
                        definition = parse_mdf(zf.read(inner_path), f"{pak_path.name}:{inner_path}", localization)
                    except Exception:
                        continue
                    if definition:
                        definitions[Path(inner_path).stem.lower()] = definition
        except zipfile.BadZipFile:
            continue
    return definitions, omnipod_details


def parse_omnipods(game_data, omnipod_details):
    root = parse_xml(game_data.read("Libs/Items/OmniPods.xml"), "OmniPods.xml")
    pods = {}
    for node in root.findall("OmniPod"):
        pod = attrs(node)
        pod["chassis"] = str(pod.get("chassis", "")).lower()
        pod["set"] = str(pod.get("set", "")).lower()
        pod["component"] = str(pod.get("component", "")).lower()
        detail = omnipod_details.get(f"{pod['chassis']}|{pod['set']}|{pod['component']}", {})
        pod["quirks"] = detail.get("quirks", [])
        pod["set_bonuses"] = detail.get("set_bonuses", [])
        pods[str(pod["id"])] = pod
    return pods


def build_mech_payload(mechs, definitions, loadouts):
    payload = []
    by_mech_id = {str(loadout["mech_id"]): loadout for loadout in loadouts.values() if loadout.get("mech_id") is not None}
    for mech_id, mech in sorted(mechs.items(), key=lambda pair: int(pair[0])):
        definition = definitions.get(mech["name"], {})
        stats = definition.get("stats", {})
        max_tons = maybe_num(stats.get("MaxTons", 0))
        if isinstance(max_tons, (int, float)):
            weight_class = "light" if max_tons <= 35 else "medium" if max_tons <= 55 else "heavy" if max_tons <= 75 else "assault"
        else:
            weight_class = ""
        loadout = by_mech_id.get(mech_id) or loadouts.get(mech["name"])
        payload.append({
            "id": mech["id"],
            "name": mech["name"],
            "display_name": (loadout or {}).get("display_name", mech["name"].upper()),
            "chassis": mech["chassis"],
            "faction": mech.get("faction", ""),
            "weight_class": weight_class,
            "definition": definition,
            "stock_loadout": mech["name"] if mech["name"] in loadouts else (loadout or {}).get("name"),
        })
    return payload


def write_json(path: Path, data):
    path.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


def main(argv=None):
    parser = argparse.ArgumentParser(description="Extract local MechWarrior Online data for the local mechlab.")
    parser.add_argument("--game-dir", default=os.environ.get("MWO_GAME_DIR", ""))
    parser.add_argument("--out", default="public/data")
    args = parser.parse_args(argv)

    game_dir = Path(args.game_dir)
    out_dir = Path(args.out)

    if not args.game_dir:
        print("Set MWO_GAME_DIR or pass --game-dir.", file=sys.stderr)
        return 2

    game_data_path = game_dir / GAME_DATA_PAK
    if not game_data_path.exists():
        print(f"GameData.pak not found: {game_data_path}", file=sys.stderr)
        return 2

    out_dir.mkdir(parents=True, exist_ok=True)
    localization = parse_localization(game_dir)

    definitions, omnipod_details = parse_mech_definitions(game_dir, localization)

    with zipfile.ZipFile(game_data_path) as game_data:
        items_by_id, by_family = parse_items(game_data, localization)
        mechs = parse_mech_list(game_data)
        loadouts = parse_loadouts(game_data)
        omnipods = parse_omnipods(game_data, omnipod_details)

    mech_payload = build_mech_payload(mechs, definitions, loadouts)

    write_json(out_dir / "index.json", {
        "generated_from": "local game install",
        "counts": {
            "mechs": len(mech_payload),
            "items": len(items_by_id),
            "loadouts": len(loadouts),
            "omnipods": len(omnipods),
        },
        "files": {
            "mechs": "data/mechs.json",
            "equipment": "data/equipment.json",
            "loadouts": "data/loadouts.json",
            "omnipods": "data/omnipods.json",
        },
    })
    write_json(out_dir / "mechs.json", mech_payload)
    write_json(out_dir / "equipment.json", {"items": items_by_id, "families": by_family})
    write_json(out_dir / "loadouts.json", loadouts)
    write_json(out_dir / "omnipods.json", omnipods)

    print(f"Extracted {len(mech_payload)} mechs, {len(items_by_id)} items, {len(loadouts)} loadouts.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
