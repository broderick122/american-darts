#!/usr/bin/env python3
"""Fill a sheet rendered by scoresheet/make_scansheet_v16.py, then warp it.

The generator is run in a temp directory so the committed PDF stays byte-identical
to the approved file. expected-v16.json is what the reader should recover.
"""
import json
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
import pymupdf
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
OUT = Path(__file__).resolve().parent / "fixtures"
SCRIPT = ROOT / "scoresheet" / "make_scansheet_v16.py"
COMMITTED_SPEC = ROOT / "scoresheet" / "scansheet_v16_layout_spec.json"

ROSTER = {"A": 12, "B": 7, "C": 23, "D": 4, "E": None, "F": 15, "G": 31, "H": 8}
GAMES = {
    1: {
        "rows": [
            {"who": "A", "score": 21},
            {"who": "B", "score": 15},
            {"who": "C", "score": 8},
            {"who": "D", "score": 19},
        ],
        "team": 63,
        "result": "won",
    },
    2: {
        "rows": [
            {"who": "E", "score": 12},
            {"who": ["F", "G"], "score": 18},
            {"who": "A", "score": 4},
            {"who": "H", "score": 20},
        ],
        "team": 50,
        "result": "lost",
    },
    3: {
        "rows": [
            {"who": "A", "score": 11},
            {"who": "C", "score": 16},
            {"who": "A", "score": 9},
            {"who": "H", "score": 22},
        ],
        "team": 149,
        "result": "won",
    },
}


def render_sheet():
    work = Path(tempfile.mkdtemp(prefix="v16-sheet-"))
    subprocess.check_call([sys.executable, str(SCRIPT)], cwd=work)
    spec = json.loads((work / "scansheet_v16_layout_spec.json").read_text())
    committed = json.loads(COMMITTED_SPEC.read_text())
    left = spec["roster_fields"]["team_A"]["digits"][0]["bubbles"][0]["center_norm"]
    right = committed["roster_fields"]["team_A"]["digits"][0]["bubbles"][0]["center_norm"]
    if left != right:
        raise SystemExit("generator geometry does not match the committed v16 spec")
    return spec, work / "roslyn_scansheet_v16.pdf"


def mapper(spec, width, height):
    page_w, page_h = spec["page"]["size_pt"]
    sx = width / page_w
    sy = height / page_h
    tl = spec["fiducials"]["TL"]["center_pt_topleft"]
    tr = spec["fiducials"]["TR"]["center_pt_topleft"]
    bl = spec["fiducials"]["BL"]["center_pt_topleft"]
    origin_x = tl[0] * sx
    origin_y = tl[1] * sy
    span_x = (tr[0] - tl[0]) * sx
    span_y = (bl[1] - tl[1]) * sy
    span_pt_x = tr[0] - tl[0]
    span_pt_y = bl[1] - tl[1]

    def point(nx, ny):
        return origin_x + nx * span_x, origin_y + ny * span_y

    def radii(kind):
        if kind == "side":
            return 20 / span_pt_x * span_x, 10.5 / span_pt_y * span_y
        pair = spec["bubble_radius_norm"][kind]
        return pair[0] * span_x, pair[1] * span_y

    return point, radii


def fill_ellipse(draw, x, y, rx, ry):
    rx *= 0.82
    ry *= 0.82
    draw.ellipse((x - rx, y - ry, x + rx, y + ry), fill=(6, 6, 8))


def fill_value(draw, bubbles, value, point, radii):
    for bubble in bubbles:
        if bubble["value"] == value:
            fill_ellipse(draw, *point(*bubble["center_norm"]), *radii)


def fill_digits(draw, field, tens, ones, point, radii, fill_tens):
    for place in field["digits"]:
        if place["place"] == "tens" and fill_tens:
            fill_value(draw, place["bubbles"], tens, point, radii)
        elif place["place"] == "ones":
            fill_value(draw, place["bubbles"], ones, point, radii)
        elif place["place"] == "hundreds" and tens >= 10:
            fill_value(draw, place["bubbles"], 1, point, radii)


def scribble_boxes(draw, spec, point):
    for box in spec.get("human_only", {}).get("write_in_boxes") or []:
        x, y, w, h = box["bbox_norm"]
        a = point(x + 0.18 * w, y + 0.28 * h)
        b = point(x + 0.82 * w, y + 0.72 * h)
        c = point(x + 0.22 * w, y + 0.70 * h)
        d = point(x + 0.78 * w, y + 0.30 * h)
        draw.line([a, b], fill=(12, 12, 14), width=3)
        draw.line([c, d], fill=(12, 12, 14), width=3)


def find_coeffs(output_corners, input_corners):
    matrix = []
    vector = []
    for (x, y), (u, v) in zip(output_corners, input_corners):
        matrix.append([x, y, 1, 0, 0, 0, -u * x, -u * y])
        vector.append(u)
        matrix.append([0, 0, 0, x, y, 1, -v * x, -v * y])
        vector.append(v)
    solved = np.linalg.solve(np.array(matrix, dtype=float), np.array(vector, dtype=float))
    return tuple(float(v) for v in solved)


def distort(image):
    pad = 72
    table = (176, 166, 150)
    framed = Image.new("RGB", (image.width + pad * 2, image.height + pad * 2), table)
    framed.paste(image, (pad, pad))
    turned = framed.rotate(3.4, resample=Image.BICUBIC, expand=True, fillcolor=table)
    width, height = turned.size
    src = [(0, 0), (width - 1, 0), (width - 1, height - 1), (0, height - 1)]
    dst = [(22, 14), (width - 36, 28), (width - 16, height - 20), (30, height - 34)]
    warped = turned.transform(
        (width, height),
        Image.PERSPECTIVE,
        find_coeffs(dst, src),
        Image.BICUBIC,
        fillcolor=table,
    )
    return warped.filter(ImageFilter.GaussianBlur(radius=1.05))


def expected_who(who):
    if who is None:
        return {"value": "", "status": "blank"}
    if isinstance(who, list):
        return {"value": "", "status": "ambiguous"}
    return {"value": who, "status": "ok"}


def expected_score(score):
    if score is None:
        return {"value": None, "status": "blank"}
    return {"value": int(score), "status": "ok"}


def expected_roster(value):
    if value is None:
        return {"value": None, "status": "blank"}
    return {"value": int(value), "status": "ok"}


def build_expected():
    games = []
    for number in (1, 2, 3):
        block = GAMES[number]
        shooters = [
            {"who": expected_who(row["who"]), "score": expected_score(row["score"])}
            for row in block["rows"]
        ]
        known = all(item["score"]["value"] is not None for item in shooters)
        shooter_sum = sum(item["score"]["value"] for item in shooters) if known else None
        games.append({
            "shooters": shooters,
            "team": {"value": block["team"], "status": "ok"},
            "result": {"value": block["result"], "status": "ok"},
            "shooterSum": shooter_sum,
            "sumMismatch": shooter_sum is not None and shooter_sum != block["team"],
        })
    return {
        "version": "v16",
        "side": {"value": "home", "status": "ok"},
        "roster": {slot: expected_roster(value) for slot, value in ROSTER.items()},
        "games": games,
        "beer": {"value": "", "status": "blank"},
        "points": {"value": "won", "status": "ok"},
    }


def main():
    spec, pdf_path = render_sheet()
    doc = pymupdf.open(pdf_path)
    page = doc[0]
    pix = page.get_pixmap(matrix=pymupdf.Matrix(2.15, 2.15), alpha=False)
    image = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
    point, radii_of = mapper(spec, image.width, image.height)
    draw = ImageDraw.Draw(image)
    fill_value(draw, spec["side_field"]["bubbles"], "home", point, radii_of("side"))
    for slot, value in ROSTER.items():
        if value is None:
            continue
        tens, ones = divmod(int(value), 10)
        fill_digits(draw, spec["roster_fields"][f"team_{slot}"], tens, ones, point, radii_of("roster_id"), True)
    for number, block in GAMES.items():
        for index, row in enumerate(block["rows"], start=1):
            key = f"team_g{number}_s{index}"
            letters = row["who"] if isinstance(row["who"], list) else [row["who"]]
            for letter in letters:
                fill_value(draw, spec["who_fields"][key]["bubbles"], letter, point, radii_of("who"))
            tens, ones = divmod(int(row["score"]), 10)
            fill_digits(draw, spec["number_fields"][key], tens, ones, point, radii_of("score"), tens > 0)
        hundreds, rest = divmod(int(block["team"]), 100)
        tens, ones = divmod(rest, 10)
        team = spec["number_fields"][f"team_g{number}_team"]
        if hundreds:
            for place in team["digits"]:
                if place["place"] == "hundreds":
                    fill_value(draw, place["bubbles"], 1, point, radii_of("score"))
        fill_digits(draw, team, tens, ones, point, radii_of("score"), True)
        fill_value(draw, spec["result_fields"][f"game{number}_result"], block["result"], point, radii_of("result"))
    fill_value(draw, spec["result_fields"]["total_points_result"], "won", point, radii_of("result"))
    scribble_boxes(draw, spec, point)
    photo = distort(image)
    OUT.mkdir(parents=True, exist_ok=True)
    jpg = OUT / "filled-v16.jpg"
    photo.save(jpg, format="JPEG", quality=78)
    (OUT / "expected-v16.json").write_text(json.dumps(build_expected(), indent=2) + "\n")
    print("wrote", jpg, photo.size)


if __name__ == "__main__":
    main()
