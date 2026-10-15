#!/usr/bin/env python3
"""Render the v16 one-team sheet with known marks, then warp the photo.

The JPEG is rotated a few degrees, perspective-shifted, and lightly blurred.
expected-v16.json is what the browser reader should recover.
"""
import json
from pathlib import Path

import numpy as np
import pymupdf
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
OUT = Path(__file__).resolve().parent / "fixtures"
PDF = ROOT / "scoresheet" / "roslyn_scansheet_v16.pdf"
SPEC = ROOT / "scoresheet" / "scansheet_v16_layout_spec.json"

# Roster ids. None is an empty slot (not zero).
ROSTER = {"A": 12, "B": 7, "C": 23, "D": 4, "E": None, "F": 15, "G": 31, "H": 8}

# who is a letter, a list of letters (ambiguous), or None.
# score None is blank. A score under 10 leaves the tens bubbles empty.
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
    radius = spec["bubble_radius"]["pt"] * (sx + sy) / 2.0

    def point(nx, ny):
        return origin_x + nx * span_x, origin_y + ny * span_y

    return point, radius


def fill_circle(draw, x, y, radius):
    r = radius * 0.9
    draw.ellipse((x - r, y - r, x + r, y + r), fill=(6, 6, 8))


def fill_value(draw, bubbles, value, point, radius):
    for bubble in bubbles:
        if bubble["value"] == value:
            fill_circle(draw, *point(*bubble["center_norm"]), radius)


def fill_score(draw, field, score, point, radius):
    if score is None:
        return
    tens, ones = divmod(int(score), 10)
    if tens:
        fill_value(draw, field["tens"]["bubbles"], tens, point, radius)
    fill_value(draw, field["ones"]["bubbles"], ones, point, radius)


def fill_roster(draw, field, value, point, radius):
    if value is None:
        return
    tens, ones = divmod(int(value), 10)
    fill_value(draw, field["tens"]["bubbles"], tens, point, radius)
    fill_value(draw, field["ones"]["bubbles"], ones, point, radius)


def scribble_boxes(draw, spec, point):
    for box in spec.get("human_only", {}).get("score_boxes") or []:
        x, y, w, h = box["bbox_norm"]
        a = point(x + 0.18 * w, y + 0.28 * h)
        b = point(x + 0.82 * w, y + 0.72 * h)
        c = point(x + 0.22 * w, y + 0.70 * h)
        d = point(x + 0.78 * w, y + 0.30 * h)
        draw.line([a, b], fill=(12, 12, 14), width=4)
        draw.line([c, d], fill=(12, 12, 14), width=4)


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
    pad = 64
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
        shooters = []
        for row in block["rows"]:
            shooters.append({
                "who": expected_who(row["who"]),
                "score": expected_score(row["score"]),
            })
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
    }


def main():
    spec = json.loads(SPEC.read_text())
    doc = pymupdf.open(PDF)
    page = doc[0]
    pix = page.get_pixmap(matrix=pymupdf.Matrix(2.15, 2.15), alpha=False)
    image = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
    point, radius = mapper(spec, image.width, image.height)
    draw = ImageDraw.Draw(image)
    fill_value(draw, spec["side_field"], "home", point, radius)
    for slot, value in ROSTER.items():
        fill_roster(draw, spec["roster"][slot], value, point, radius)
    for number, block in GAMES.items():
        game = spec["games"][str(number)]
        for index, row in enumerate(block["rows"]):
            who = row["who"]
            letters = who if isinstance(who, list) else ([] if who is None else [who])
            for letter in letters:
                fill_value(draw, game["shooters"][index]["who"]["bubbles"], letter, point, radius)
            fill_score(draw, game["shooters"][index], row["score"], point, radius)
        hundreds, rest = divmod(int(block["team"]), 100)
        tens, ones = divmod(rest, 10)
        if hundreds:
            fill_value(draw, game["team"]["hundreds"]["bubbles"], 1, point, radius)
        fill_value(draw, game["team"]["tens"]["bubbles"], tens, point, radius)
        fill_value(draw, game["team"]["ones"]["bubbles"], ones, point, radius)
        fill_value(draw, game["result"], block["result"], point, radius)
    scribble_boxes(draw, spec, point)
    photo = distort(image)
    OUT.mkdir(parents=True, exist_ok=True)
    jpg = OUT / "filled-v16.jpg"
    photo.save(jpg, format="JPEG", quality=78)
    expected = build_expected()
    (OUT / "expected-v16.json").write_text(json.dumps(expected, indent=2) + "\n")
    print("wrote", jpg, photo.size)


if __name__ == "__main__":
    main()
