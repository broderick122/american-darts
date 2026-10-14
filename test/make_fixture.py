#!/usr/bin/env python3
"""Render the v7 scan sheet with known filled bubbles, then nudge the photo.

The output is a JPEG with a few degrees of rotation, a small perspective
shift, and a light blur, plus expected.json for the reader test.
"""
import json
from pathlib import Path

import pymupdf
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
PDF = ROOT / "scoresheet" / "roslyn_scansheet_v7.pdf"
SPEC_PATH = ROOT / "scoresheet" / "scansheet_v7_layout_spec.json"
OUT = Path(__file__).resolve().parent / "fixtures"

# None means the shooter row is left blank. "amb" is a double-filled ones row.
HOME = {
    1: {"s": [27, 15, 8, 40], "team": 90},
    2: {"s": [12, 33, 5, None], "team": 50},
    3: {"s": [50, 7, 21, 18], "team": 90},
}
AWAY = {
    1: {"s": [42, 38, 25, 11], "team": 116},
    2: {"s": [9, "amb", 22, 6], "team": 37},
    3: {"s": [30, 17, 4, 28], "team": 79},
}
WINNERS = {
    "game1_winner": "away",
    "game2_winner": "home",
    "game3_winner": "home",
    "beer_frame_winner": None,
    "total_points_winner": "away",
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
    winner_radius = spec["winner_bubble_radius"]["pt"] * (sx + sy) / 2.0

    def point(nx, ny):
        return origin_x + nx * span_x, origin_y + ny * span_y

    return point, radius, winner_radius


def fill_circle(draw, x, y, radius):
    r = radius * 0.9
    draw.ellipse((x - r, y - r, x + r, y + r), fill=(6, 6, 8))


def fill_digit(draw, place, digit, point, radius):
    for bubble in place["bubbles"]:
        if bubble["value"] == digit:
            fill_circle(draw, *point(*bubble["center_norm"]), radius)


def fill_value(draw, field, value, point, radius):
    if value is None:
        return
    if value == "amb":
        for place in field["digits"]:
            if place["place"] == "tens":
                fill_digit(draw, place, 1, point, radius)
            elif place["place"] == "ones":
                fill_digit(draw, place, 4, point, radius)
                fill_digit(draw, place, 7, point, radius)
        return
    hundreds, rest = divmod(int(value), 100)
    tens, ones = divmod(rest, 10)
    for place in field["digits"]:
        if place["place"] == "hundreds":
            if hundreds:
                bubble = place["bubbles"][0]
                fill_circle(draw, *point(*bubble["center_norm"]), radius)
        elif place["place"] == "tens":
            fill_digit(draw, place, tens, point, radius)
        else:
            fill_digit(draw, place, ones, point, radius)


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


def expected_shooter(value):
    if value is None:
        return {"value": None, "status": "blank"}
    if value == "amb":
        return {"value": None, "status": "ambiguous"}
    return {"value": int(value), "status": "ok"}


def expected_side(block):
    games = []
    for game in (1, 2, 3):
        shooters = [expected_shooter(value) for value in block[game]["s"]]
        team_value = block[game]["team"]
        known = all(item["value"] is not None for item in shooters)
        shooter_sum = sum(item["value"] for item in shooters) if known else None
        games.append({
            "shooters": shooters,
            "team": {"value": team_value, "status": "ok"},
            "shooterSum": shooter_sum,
            "sumMismatch": shooter_sum is not None and shooter_sum != team_value,
        })
    return {"games": games}


def main():
    spec = json.loads(SPEC_PATH.read_text())
    OUT.mkdir(parents=True, exist_ok=True)
    doc = pymupdf.open(PDF)
    page = doc[0]
    pix = page.get_pixmap(matrix=pymupdf.Matrix(2.15, 2.15), alpha=False)
    image = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
    point, radius, winner_radius = mapper(spec, image.width, image.height)
    draw = ImageDraw.Draw(image)
    for side, block in (("home", HOME), ("away", AWAY)):
        for game, row in block.items():
            for index, value in enumerate(row["s"], start=1):
                fill_value(draw, spec["number_fields"][f"{side}_g{game}_s{index}"], value, point, radius)
            fill_value(draw, spec["number_fields"][f"{side}_g{game}_team"], row["team"], point, radius)
    for name, choice in WINNERS.items():
        if not choice:
            continue
        for bubble in spec["winner_fields"][name]:
            if bubble["value"] == choice:
                fill_circle(draw, *point(*bubble["center_norm"]), winner_radius)
    photo = distort(image)
    jpg = OUT / "filled-v7.jpg"
    photo.save(jpg, format="JPEG", quality=78)
    payload = {
        "home": expected_side(HOME),
        "away": expected_side(AWAY),
        "winners": {
            "game1": {"value": "away", "status": "ok"},
            "game2": {"value": "home", "status": "ok"},
            "game3": {"value": "home", "status": "ok"},
            "beer": {"value": "", "status": "blank"},
            "points": {"value": "away", "status": "ok"},
        },
        "homeGamesWon": 2,
        "awayGamesWon": 1,
    }
    (OUT / "expected.json").write_text(json.dumps(payload, indent=2))
    print(f"wrote {jpg} ({photo.size[0]}x{photo.size[1]})")


if __name__ == "__main__":
    main()
