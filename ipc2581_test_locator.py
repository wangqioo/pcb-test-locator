import argparse
import csv
import json
import math
import xml.etree.ElementTree as ET
from collections import defaultdict
from pathlib import Path


NS = {"ipc": "http://webstds.ipc.org/2581"}
INCH_TO_MM = 25.4
DEFAULT_SCORING_CONFIG = Path(__file__).resolve().parent / "config" / "scoring.default.json"


def local_name(tag):
    return tag.split("}", 1)[-1]


def f(value, default=0.0):
    if value is None:
        return default
    return float(value)


def child(elem, name):
    return elem.find(f"ipc:{name}", NS)


def children(elem, name):
    return elem.findall(f"ipc:{name}", NS)


def get_location(elem):
    loc = child(elem, "Location")
    if loc is None:
        return 0.0, 0.0
    return f(loc.get("x")), f(loc.get("y"))


def get_xform(elem):
    xf = child(elem, "Xform")
    if xf is None:
        return 0.0, False
    return f(xf.get("rotation")), xf.get("mirror", "").lower() == "true"


def transform_point(px, py, cx, cy, rotation_deg=0.0, mirror=False):
    # IPC package pad locations are local to the land pattern. Mirrored bottom
    # components need an X mirror before rotation for practical board lookup.
    if mirror:
        px = -px
    r = math.radians(rotation_deg % 360.0)
    x = px * math.cos(r) - py * math.sin(r)
    y = px * math.sin(r) + py * math.cos(r)
    return cx + x, cy + y


def polygon_points(poly):
    points = []
    begin = child(poly, "PolyBegin")
    if begin is None:
        return points
    current = (f(begin.get("x")), f(begin.get("y")))
    points.append(current)
    for step in list(poly):
        name = local_name(step.tag)
        if name == "PolyStepSegment":
            current = (f(step.get("x")), f(step.get("y")))
            points.append(current)
        elif name == "PolyStepCurve":
            end = (f(step.get("x")), f(step.get("y")))
            center = (f(step.get("centerX")), f(step.get("centerY")))
            clockwise = step.get("clockwise", "").lower() == "true"
            points.extend(arc_points(current, end, center, clockwise))
            current = end
    return points


def arc_points(start, end, center, clockwise, segments=12):
    sx, sy = start
    ex, ey = end
    cx, cy = center
    radius = math.hypot(sx - cx, sy - cy)
    if radius == 0:
        return [end]
    a0 = math.atan2(sy - cy, sx - cx)
    a1 = math.atan2(ey - cy, ex - cx)
    if clockwise:
        if a1 > a0:
            a1 -= math.tau
    else:
        if a1 < a0:
            a1 += math.tau
    return [
        (cx + radius * math.cos(a0 + (a1 - a0) * i / segments),
         cy + radius * math.sin(a0 + (a1 - a0) * i / segments))
        for i in range(1, segments + 1)
    ]


def refdes_family(refdes):
    return "".join(ch for ch in refdes if ch.isalpha()).upper()


def load_scoring_config(path=None):
    config_path = Path(path) if path else DEFAULT_SCORING_CONFIG
    with config_path.open("r", encoding="utf-8") as fh:
        return json.load(fh)


def add_score(score, reasons, rule):
    if not rule:
        return score
    score += int(rule.get("score", 0))
    reason = rule.get("reason")
    if reason:
        reasons.append(reason)
    return score


def score_candidate(
    scoring,
    kind,
    refdes="",
    package="",
    mount="",
    side="",
    pin="",
    diameter_in=None,
):
    family = refdes_family(refdes)
    score = 0
    reasons = []

    if kind == "via":
        score = add_score(score, reasons, scoring.get("kind", {}).get("via"))
        if diameter_in is not None:
            for rule in scoring.get("via_diameter_in", []):
                if diameter_in >= float(rule.get("min", 0)):
                    score = add_score(score, reasons, rule)
                    break

    family_rules = scoring.get("refdes_family", {})
    if family in family_rules:
        score = add_score(score, reasons, family_rules[family])
    elif refdes:
        score = add_score(score, reasons, scoring.get("default_component"))

    pkg = package.upper()
    for rule in scoring.get("package_contains", []):
        if str(rule.get("text", "")).upper() in pkg:
            score = add_score(score, reasons, rule)
            break
    if "BGA" in pkg or pin[:1].isalpha() and any(ch.isdigit() for ch in pin):
        if family in {"U", "IC"}:
            score = add_score(score, reasons, scoring.get("bga_ic_penalty"))

    score = add_score(score, reasons, scoring.get("mount_type", {}).get(mount))
    score = add_score(score, reasons, scoring.get("side", {}).get(side))

    return score, "; ".join(reasons)


def parse_ipc2581(path):
    tree = ET.parse(path)
    root = tree.getroot()
    units = "INCH"
    line_desc = root.find(".//ipc:DictionaryLineDesc", NS)
    if line_desc is not None and line_desc.get("units"):
        units = line_desc.get("units").upper()
    scale_to_mm = INCH_TO_MM if units == "INCH" else 1.0

    packages = {}
    for pkg in root.findall(".//ipc:Package", NS):
        pads = {}
        outlines = []
        outline = child(pkg, "Outline")
        if outline is not None:
            for poly in children(outline, "Polygon"):
                pts = polygon_points(poly)
                if len(pts) >= 2:
                    outlines.append(pts)
        for pad in pkg.findall(".//ipc:LandPattern/ipc:Pad", NS):
            pin_ref = child(pad, "PinRef")
            if pin_ref is None:
                continue
            pin = pin_ref.get("pin", "")
            px, py = get_location(pad)
            pads[pin] = {
                "x": px,
                "y": py,
                "padstack": pad.get("padstackDefRef", ""),
            }
        packages[pkg.get("name", "")] = {
            "attrs": pkg.attrib,
            "pads": pads,
            "outlines": outlines,
        }

    components = {}
    for comp in root.findall(".//ipc:Component", NS):
        refdes = comp.get("refDes", "")
        cx, cy = get_location(comp)
        rot, mirror = get_xform(comp)
        attrs = dict(comp.attrib)
        attrs.update({"x": cx, "y": cy, "rotation": rot, "mirror": mirror})
        for na in children(comp, "NonstandardAttribute"):
            attrs[f"attr_{na.get('name', '')}"] = na.get("value", "")
        components[refdes] = attrs

    logical_nets = defaultdict(list)
    for net in root.findall(".//ipc:LogicalNet", NS):
        net_name = net.get("name", "")
        for pr in children(net, "PinRef"):
            logical_nets[net_name].append(
                {"component": pr.get("componentRef", ""), "pin": pr.get("pin", "")}
            )

    phy_points = defaultdict(list)
    for phy in root.findall(".//ipc:PhyNet", NS):
        net_name = phy.get("name", "")
        for point in children(phy, "PhyNetPoint"):
            phy_points[net_name].append(
                {
                    "x": f(point.get("x")),
                    "y": f(point.get("y")),
                    "layer": point.get("layerRef", ""),
                    "net_node": point.get("netNode", ""),
                    "exposure": point.get("exposure", ""),
                    "via": point.get("via", ""),
                }
            )

    vias = defaultdict(list)
    for s in root.findall(".//ipc:Set", NS):
        net_name = s.get("net", "")
        comp_ref = s.get("componentRef", "")
        for hole in children(s, "Hole"):
            if hole.get("platingStatus") == "VIA" and not comp_ref:
                vias[net_name].append(
                    {
                        "x": f(hole.get("x")),
                        "y": f(hole.get("y")),
                        "diameter": f(hole.get("diameter"), None),
                        "geometry": s.get("geometry", ""),
                    }
                )

    board_profile = []
    profile = root.find(".//ipc:Profile", NS)
    if profile is not None:
        for poly in children(profile, "Polygon"):
            pts = polygon_points(poly)
            if len(pts) >= 2:
                board_profile.append(pts)

    return {
        "units": units,
        "scale_to_mm": scale_to_mm,
        "packages": packages,
        "components": components,
        "logical_nets": logical_nets,
        "phy_points": phy_points,
        "vias": vias,
        "board_profile": board_profile,
    }


def build_candidates(data, scoring):
    scale = data["scale_to_mm"]
    packages = data["packages"]
    components = data["components"]
    candidates = []

    for net_name, pins in data["logical_nets"].items():
        for link in pins:
            refdes = link["component"]
            pin = link["pin"]
            comp = components.get(refdes)
            if not comp:
                continue
            pkg_name = comp.get("packageRef", "")
            pkg = packages.get(pkg_name, {})
            pad = pkg.get("pads", {}).get(pin)
            board_x = comp["x"]
            board_y = comp["y"]
            padstack = ""
            if pad:
                board_x, board_y = transform_point(
                    pad["x"],
                    pad["y"],
                    comp["x"],
                    comp["y"],
                    comp["rotation"],
                    comp["mirror"],
                )
                padstack = pad.get("padstack", "")
            score, reason = score_candidate(
                scoring,
                "component",
                refdes=refdes,
                package=pkg_name,
                mount=comp.get("mountType", ""),
                side=comp.get("layerRef", ""),
                pin=pin,
            )
            candidates.append(
                {
                    "net": net_name,
                    "candidate": f"{refdes}.{pin}",
                    "kind": "component_pin",
                    "score": score,
                    "side": comp.get("layerRef", ""),
                    "x_in": board_x,
                    "y_in": board_y,
                    "x_mm": board_x * scale,
                    "y_mm": board_y * scale,
                    "refdes": refdes,
                    "pin": pin,
                    "package": pkg_name,
                    "part": comp.get("part", ""),
                    "value": comp.get("attr_VALUE", ""),
                    "padstack": padstack,
                    "reason": reason,
                }
            )

    for net_name, vias in data["vias"].items():
        for i, via in enumerate(vias, start=1):
            score, reason = score_candidate(
                scoring,
                "via", diameter_in=via.get("diameter")
            )
            candidates.append(
                {
                    "net": net_name,
                    "candidate": f"VIA{i}",
                    "kind": "via",
                    "score": score,
                    "side": "ALL",
                    "x_in": via["x"],
                    "y_in": via["y"],
                    "x_mm": via["x"] * scale,
                    "y_mm": via["y"] * scale,
                    "refdes": "",
                    "pin": "",
                    "package": via.get("geometry", ""),
                    "part": "",
                    "value": "",
                    "padstack": via.get("geometry", ""),
                    "reason": reason,
                }
            )

    return sorted(candidates, key=lambda r: (r["net"], -r["score"], r["candidate"]))


def build_board_json(data, candidates, top_per_net):
    nets = defaultdict(lambda: {"candidates": [], "summary": {}})
    bounds = {
        "min_x_mm": None,
        "min_y_mm": None,
        "max_x_mm": None,
        "max_y_mm": None,
    }

    def update_bounds(x, y):
        if bounds["min_x_mm"] is None:
            bounds.update(
                {"min_x_mm": x, "min_y_mm": y, "max_x_mm": x, "max_y_mm": y}
            )
            return
        bounds["min_x_mm"] = min(bounds["min_x_mm"], x)
        bounds["min_y_mm"] = min(bounds["min_y_mm"], y)
        bounds["max_x_mm"] = max(bounds["max_x_mm"], x)
        bounds["max_y_mm"] = max(bounds["max_y_mm"], y)

    per_net_count = defaultdict(int)
    for row in candidates:
        if per_net_count[row["net"]] >= top_per_net:
            continue
        per_net_count[row["net"]] += 1
        clean_row = dict(row)
        for key in ("x_mm", "y_mm", "x_in", "y_in"):
            clean_row[key] = round(float(clean_row[key]), 4)
        update_bounds(clean_row["x_mm"], clean_row["y_mm"])
        nets[row["net"]]["candidates"].append(clean_row)

    for net in sorted(set(data["logical_nets"]) | set(data["vias"])):
        nets[net]["summary"] = {
            "logical_pin_count": len(data["logical_nets"].get(net, [])),
            "via_count": len(data["vias"].get(net, [])),
            "phy_point_count": len(data["phy_points"].get(net, [])),
        }
        routed_points = []
        for point in data["phy_points"].get(net, []):
            routed_points.append(
                {
                    "x_mm": round(point["x"] * data["scale_to_mm"], 4),
                    "y_mm": round(point["y"] * data["scale_to_mm"], 4),
                    "side": point.get("layer", ""),
                    "via": str(point.get("via", "")).lower() == "true",
                    "node": point.get("net_node", ""),
                    "exposure": point.get("exposure", ""),
                }
            )
        nets[net]["routed_points"] = routed_points

    components = []
    component_outlines = []
    for refdes, comp in data["components"].items():
        x_mm = comp["x"] * data["scale_to_mm"]
        y_mm = comp["y"] * data["scale_to_mm"]
        update_bounds(x_mm, y_mm)
        package_name = comp.get("packageRef", "")
        components.append(
            {
                "refdes": refdes,
                "side": comp.get("layerRef", ""),
                "x_mm": round(x_mm, 4),
                "y_mm": round(y_mm, 4),
                "rotation": comp.get("rotation", 0.0),
                "mirror": comp.get("mirror", False),
                "package": package_name,
                "value": comp.get("attr_VALUE", ""),
                "part": comp.get("part", ""),
            }
        )
        pkg = data["packages"].get(package_name, {})
        for outline in pkg.get("outlines", [])[:1]:
            points = []
            for px, py in outline:
                bx, by = transform_point(
                    px, py, comp["x"], comp["y"], comp["rotation"], comp["mirror"]
                )
                points.append([round(bx * data["scale_to_mm"], 4), round(by * data["scale_to_mm"], 4)])
            if len(points) >= 2:
                component_outlines.append(
                    {
                        "refdes": refdes,
                        "side": comp.get("layerRef", ""),
                        "points": points,
                    }
                )

    profile = []
    for outline in data.get("board_profile", []):
        points = [
            [round(x * data["scale_to_mm"], 4), round(y * data["scale_to_mm"], 4)]
            for x, y in outline
        ]
        if len(points) >= 2:
            profile.append(points)

    return {
        "format": "pcb-test-locator-board-v1",
        "source_units": data["units"],
        "bounds": bounds,
        "stats": {
            "component_count": len(data["components"]),
            "package_count": len(data["packages"]),
            "net_count": len(set(data["logical_nets"]) | set(data["vias"])),
            "candidate_count": len(candidates),
            "top_per_net": top_per_net,
        },
        "profile": profile,
        "components": sorted(components, key=lambda r: r["refdes"]),
        "component_outlines": sorted(component_outlines, key=lambda r: r["refdes"]),
        "nets": dict(sorted(nets.items())),
    }


def write_csv(path, rows, fields):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8-sig") as fh:
        writer = csv.DictWriter(fh, fieldnames=fields)
        writer.writeheader()
        for row in rows:
            writer.writerow({field: row.get(field, "") for field in fields})


def write_json(path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, indent=2)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("ipc2581_xml")
    parser.add_argument("--out-dir", default="output")
    parser.add_argument("--top-per-net", type=int, default=8)
    parser.add_argument(
        "--scoring-config",
        default=None,
        help="Path to a scoring JSON file. Defaults to config/scoring.default.json.",
    )
    args = parser.parse_args()

    data = parse_ipc2581(args.ipc2581_xml)
    scoring = load_scoring_config(args.scoring_config)
    out_dir = Path(args.out_dir)
    candidates = build_candidates(data, scoring)

    fields = [
        "net",
        "candidate",
        "kind",
        "score",
        "side",
        "x_mm",
        "y_mm",
        "x_in",
        "y_in",
        "refdes",
        "pin",
        "value",
        "package",
        "padstack",
        "part",
        "reason",
    ]
    write_csv(out_dir / "all_testpoint_candidates.csv", candidates, fields)

    per_net_count = defaultdict(int)
    top_rows = []
    for row in candidates:
        if per_net_count[row["net"]] >= args.top_per_net:
            continue
        per_net_count[row["net"]] += 1
        top_rows.append(row)
    write_csv(out_dir / "recommended_testpoints_by_net.csv", top_rows, fields)

    net_summary = []
    for net in sorted(set(data["logical_nets"]) | set(data["vias"])):
        net_summary.append(
            {
                "net": net,
                "logical_pin_count": len(data["logical_nets"].get(net, [])),
                "via_count": len(data["vias"].get(net, [])),
                "phy_point_count": len(data["phy_points"].get(net, [])),
            }
        )
    write_csv(
        out_dir / "net_summary.csv",
        net_summary,
        ["net", "logical_pin_count", "via_count", "phy_point_count"],
    )
    write_json(
        out_dir / "board.json",
        build_board_json(data, candidates, args.top_per_net),
    )

    print(f"Units: {data['units']}")
    print(f"Components: {len(data['components'])}")
    print(f"Packages: {len(data['packages'])}")
    print(f"Nets: {len(set(data['logical_nets']) | set(data['vias']))}")
    print(f"Candidates: {len(candidates)}")
    print(f"Wrote: {out_dir.resolve()}")


if __name__ == "__main__":
    main()
