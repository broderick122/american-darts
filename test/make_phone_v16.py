#!/usr/bin/env python3
"""Phone-like photos of the approved v16 sheet: 1920x1080 and 1080x1920.

Perspective, blur, and uneven light. The sheet itself is the generator's PDF.
"""
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
import pymupdf
from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
OUT = Path(__file__).resolve().parent / "fixtures"
SCRIPT = ROOT / "scoresheet" / "make_scansheet_v16.py"


def find_coeffs(dst, src):
    matrix = []
    vector = []
    for (x, y), (u, v) in zip(dst, src):
        matrix.append([x, y, 1, 0, 0, 0, -u * x, -u * y])
        vector.append(u)
        matrix.append([0, 0, 0, x, y, 1, -v * x, -v * y])
        vector.append(v)
    solved = np.linalg.solve(np.array(matrix, dtype=float), np.array(vector, dtype=float))
    return tuple(float(v) for v in solved)


def render_sheet():
    work = Path(tempfile.mkdtemp(prefix="v16-phone-"))
    subprocess.check_call([sys.executable, str(SCRIPT)], cwd=work)
    doc = pymupdf.open(work / "roslyn_scansheet_v16.pdf")
    pix = doc[0].get_pixmap(matrix=pymupdf.Matrix(2.2, 2.2), alpha=False)
    return Image.frombytes("RGB", (pix.width, pix.height), pix.samples)


def phone(sheet, size, sheet_scale):
    width, height = size
    yy = np.linspace(0.55, 1.05, height, dtype=np.float32)[:, None]
    xx = np.linspace(0.75, 1.15, width, dtype=np.float32)[None, :]
    light = np.clip(yy * xx, 0, 1.4)
    base = np.zeros((height, width, 3), np.float32)
    base[..., 0] = 168 * light
    base[..., 1] = 150 * light
    base[..., 2] = 124 * light
    background = Image.fromarray(base.astype(np.uint8), "RGB")
    target_h = int(height * sheet_scale)
    target_w = max(1, int(sheet.width * target_h / sheet.height))
    thumb = sheet.resize((target_w, target_h), Image.BICUBIC)
    src = [(0, 0), (target_w - 1, 0), (target_w - 1, target_h - 1), (0, target_h - 1)]
    dst = [(18, 10), (target_w - 40, 36), (target_w - 8, target_h - 22), (28, target_h - 48)]
    warped = thumb.transform((target_w, target_h), Image.PERSPECTIVE, find_coeffs(dst, src), Image.BICUBIC)
    arr = np.array(warped)
    mask = Image.fromarray((arr.sum(axis=2) > 40).astype(np.uint8) * 255)
    background.paste(warped, ((width - target_w) // 2, (height - target_h) // 2 + int(height * 0.02)), mask)
    image = background.filter(ImageFilter.GaussianBlur(radius=1.15))
    pixels = np.array(image).astype(np.float32)
    cy, cx = height / 2, width / 2
    y, x = np.ogrid[:height, :width]
    radius = np.sqrt(((y - cy) / (height * 0.72)) ** 2 + ((x - cx) / (width * 0.72)) ** 2)
    vignette = np.clip(1.05 - 0.38 * radius, 0.45, 1.05)[..., None]
    return Image.fromarray(np.clip(pixels * vignette, 0, 255).astype(np.uint8), "RGB")


def main():
    sheet = render_sheet()
    OUT.mkdir(parents=True, exist_ok=True)
    phone(sheet, (1920, 1080), 0.86).save(OUT / "phone-land.jpg", quality=72)
    phone(sheet, (1080, 1920), 0.78).save(OUT / "phone-port.jpg", quality=72)
    print("wrote phone-land.jpg and phone-port.jpg")


if __name__ == "__main__":
    main()
