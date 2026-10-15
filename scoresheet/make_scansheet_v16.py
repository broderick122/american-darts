#!/usr/bin/env python3
"""One-team results scan sheet v16, US letter portrait.

Each team fills its own sheet: HOME or AWAY, roster IDs A–H, then three
games. A shooter row picks exactly one roster letter (WHO) and a score.
Shooter tens are only 1–4 (a blank tens with a ones digit is under 10).
Team totals add a 100 key. Each game is WON or LOST.
"""
import json
from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas
from reportlab.lib.colors import Color, black, white
from reportlab.graphics.barcode.qr import QrCodeWidget
from reportlab.graphics.shapes import Drawing
from reportlab.graphics import renderPDF

W, H = letter  # 612 x 792, portrait
M, FID = 16, 22
OUT = "scoresheet/roslyn_scansheet_v16.pdf"
SPEC = "scoresheet/scansheet_v16_layout_spec.json"
QR_TEXT = "ROSLYN|2026|WK01|ONE-TEAM"
NAVY = Color(0.04, 0.08, 0.22)
DIGIT = Color(0.30, 0.30, 0.33)
GRAY = Color(0.2, 0.2, 0.2)
BANDS = [Color(1.0, 0.96, 0.66), Color(0.78, 0.88, 1.0), Color(0.86, 0.95, 0.82)]

fid = {k: (x + FID / 2, y + FID / 2) for k, (x, y) in {
    "TL": (M, H - M - FID), "TR": (W - M - FID, H - M - FID),
    "BL": (M, M), "BR": (W - M - FID, M)}.items()}
X0, X1 = fid["TL"][0], fid["TR"][0]
YT, YB = fid["TL"][1], fid["BL"][1]


def nx(x):
    return round((x - X0) / (X1 - X0), 5)


def ny(y):
    return round((YT - y) / (YT - YB), 5)


def nbox(x, y, w, h):
    return [nx(x), ny(y + h), round(w / (X1 - X0), 5), round(h / (YT - YB), 5)]


c = canvas.Canvas(OUT, pagesize=(W, H))
c.setTitle("Roslyn VFW Dart League - One team scan sheet v16")
human_boxes = []
lines = []
R = 7.4


def txt(s, x, y, size=10, font="Helvetica", color=GRAY, align="l"):
    c.setFont(font, size)
    c.setFillColor(color)
    {"l": c.drawString, "c": c.drawCentredString, "r": c.drawRightString}[align](x, y, s)


def wline(name, x, y, w):
    c.setStrokeColor(black)
    c.setLineWidth(0.9)
    c.line(x, y, x + w, y)
    lines.append(dict(name=name, type="handwritten_not_scanned", bbox_norm=nbox(x, y, w, 12)))


def bubble(x, y, label, r=None, size=None):
    r = R if r is None else r
    size = size or min(11, r * 1.35)
    c.setStrokeColor(NAVY)
    c.setLineWidth(1.15)
    c.setFillColor(white)
    c.circle(x, y, r, fill=1, stroke=1)
    txt(str(label), x, y - size * 0.35, size, "Helvetica-Bold", DIGIT, "c")
    if isinstance(label, int) or (isinstance(label, str) and label.isdigit()):
        value = int(label)
    else:
        value = label
    return dict(value=value, center_norm=[nx(x), ny(y)])


def row_bubbles(x, y, labels, pitch):
    out = []
    for i, label in enumerate(labels):
        # value stored as int when the label is a digit, else the string
        item = bubble(x + i * pitch, y, label)
        if isinstance(label, int) or (isinstance(label, str) and label.isdigit()):
            item["value"] = int(label)
        out.append(item)
    return out


# Markers and the white notch in the top-left square.
c.setFillColor(black)
for cx, cy in fid.values():
    c.rect(cx - FID / 2, cy - FID / 2, FID, FID, stroke=0, fill=1)
c.setFillColor(white)
c.rect(fid["TL"][0] - 4, fid["TL"][1] - 4, 8, 8, stroke=0, fill=1)

# Header
txt("Roslyn VFW · One team", M + FID + 8, H - 46, 13, "Helvetica-Bold", black)
txt("Date", M + FID + 8, H - 66, 10, "Helvetica-Bold", black)
wline("date", M + FID + 40, H - 68, 90)
txt("Opponent", M + FID + 140, H - 66, 10, "Helvetica-Bold", black)
wline("opponent", M + FID + 198, H - 68, 120)

side_y = H - 64
side = []
txt("This sheet", 400, H - 46, 8, "Helvetica-Bold", black)
for i, (val, lab) in enumerate((("home", "H"), ("away", "A"))):
    bx = 430 + i * 36
    txt(lab, bx, side_y - 3, 9, "Helvetica-Bold", black, "c")
    # The readable letter is drawn above; the bubble itself carries a short mark.
    item = bubble(bx, side_y - 18, "H" if val == "home" else "A", R, 9)
    item["value"] = val
    side.append(item)
txt("HOME", 412, side_y - 34, 7, "Helvetica", black, "c")
txt("AWAY", 448, side_y - 34, 7, "Helvetica", black, "c")

qs = 34
q = QrCodeWidget(QR_TEXT)
q.barLevel = "M"
b = q.getBounds()
d = Drawing(qs, qs, transform=[qs / (b[2] - b[0]), 0, 0, qs / (b[3] - b[1]), 0, 0])
d.add(q)
qx, qy = W - M - FID - 8 - qs, H - M - qs - 2
renderPDF.draw(d, c, qx, qy)

# Roster A–H, two-digit ids. Tens includes 0 so an id like 07 can be marked.
txt("ROSTER", M + 4, H - 96, 11, "Helvetica-Bold", black)
txt("Name", 58, H - 96, 8, "Helvetica-Bold", GRAY)
txt("ID tens", 228, H - 96, 8, "Helvetica-Bold", GRAY)
txt("ID ones", 400, H - 96, 8, "Helvetica-Bold", GRAY)
roster = {}
roster_top = H - 102
row_h = 20
id_pitch = 15.2
for i, letter in enumerate("ABCDEFGH"):
    y = roster_top - i * row_h - 8
    c.setFillColor(Color(0.96, 0.96, 0.93))
    c.rect(M, y - 10, X1 - X0, row_h - 1, stroke=0, fill=1)
    txt(letter, M + 8, y - 3, 12, "Helvetica-Bold", black)
    wline(f"roster_{letter}_name", 40, y - 4, 150)
    tens = row_bubbles(230, y, list(range(10)), id_pitch)
    ones = row_bubbles(230 + 10 * id_pitch + 12, y, list(range(10)), id_pitch)
    roster[letter] = dict(tens=dict(place="tens", bubbles=tens), ones=dict(place="ones", bubbles=ones))

# Games. Shooter tens are 1–4 only. Ones are 0–9. WHO is A–H.
games = {}
g_top = roster_top - 8 * row_h - 16
who_x, tens_x, ones_x = 70, 228, 318
pitch = 17.2
s_row = 18
for g in range(1, 4):
    c.setFillColor(BANDS[g - 1])
    block_h = 16 + 4 * s_row + s_row + s_row + 4
    c.roundRect(M, g_top - block_h, X1 - X0, block_h, 4, stroke=0, fill=1)
    txt(f"GAME {g}", M + 6, g_top - 13, 11, "Helvetica-Bold", black)
    txt("WHO", who_x, g_top - 13, 8, "Helvetica-Bold", black)
    txt("TENS", tens_x, g_top - 13, 8, "Helvetica-Bold", black)
    txt("ONES", ones_x, g_top - 13, 8, "Helvetica-Bold", black)
    txt("1–4", tens_x + 36, g_top - 13, 7, "Helvetica", GRAY)
    shooters = []
    y = g_top - 16
    for s in range(1, 5):
        y -= s_row
        txt(str(s), M + 8, y - 3, 11, "Helvetica-Bold", black)
        who = []
        for k, letter in enumerate("ABCDEFGH"):
            item = bubble(who_x + k * pitch, y, letter, R, 8)
            item["value"] = letter
            who.append(item)
        st = row_bubbles(tens_x, y, [1, 2, 3, 4], pitch)
        so = row_bubbles(ones_x, y, list(range(10)), pitch)
        bx = ones_x + 10 * pitch + 6
        c.setFillColor(white)
        c.setStrokeColor(black)
        c.setLineWidth(1.1)
        c.rect(bx, y - 7, 36, 14, fill=1, stroke=1)
        human_boxes.append(dict(
            name=f"g{g}_s{s}_written",
            type="human_only_not_scanned",
            bbox_norm=nbox(bx, y - 7, 36, 14),
        ))
        shooters.append(dict(
            who=dict(place="who", bubbles=who),
            tens=dict(place="tens", bubbles=st),
            ones=dict(place="ones", bubbles=so),
        ))
    y -= s_row
    txt("TEAM", M + 4, y - 3, 8, "Helvetica-Bold", black)
    # Empty circle plus a caption. "100" inside the bubble reads as ink when the flag is blank.
    flag = bubble(who_x, y, "", R, 6)
    flag["value"] = 1
    txt("100", who_x + 18, y - 3, 8, "Helvetica-Bold", black)
    team_pitch = 15.2
    team_tens = row_bubbles(tens_x, y, list(range(10)), team_pitch)
    team_ones_x = tens_x + 10 * team_pitch + 14
    team_ones = row_bubbles(team_ones_x, y, list(range(10)), team_pitch)
    y -= s_row
    txt("RESULT", M + 4, y - 3, 8, "Helvetica-Bold", black)
    won = bubble(who_x + 20, y, "W", R + 0.4, 9)
    lost = bubble(who_x + 20 + 46, y, "L", R + 0.4, 9)
    won["value"] = "won"
    lost["value"] = "lost"
    txt("WON", who_x + 20, y - 16, 7, "Helvetica-Bold", black, "c")
    txt("LOST", who_x + 66, y - 16, 7, "Helvetica-Bold", black, "c")
    games[str(g)] = dict(
        shooters=shooters,
        team=dict(
            hundreds=dict(place="hundreds", type="flag", bubbles=[flag]),
            tens=dict(place="tens", bubbles=team_tens),
            ones=dict(place="ones", bubbles=team_ones),
        ),
        result=[won, lost],
    )
    g_top = y - 22

txt("Fill one bubble per group. Shooter tens are 1–4; leave them blank for a score under 10. Team 100+: also fill 100.",
    48, 50, 7.2, "Helvetica", black)

print("grid bottom", round(g_top, 1), "marker top of BL", round(fid["BL"][1] + FID / 2, 1))

spec = {
    "sheet": "Roslyn VFW Dart League One Team Scan Sheet",
    "version": "v16",
    "page": {"size_pt": [W, H], "orientation": "portrait letter", "pages": 1, "team_arrangement": "one_team"},
    "coordinate_system": "Normalized to corner-marker centres: (0,0)=TL, (1,0)=TR, (0,1)=BL; y down.",
    "fiducials": {k: {"center_pt_topleft": [v[0], H - v[1]], "size_pt": FID} for k, v in fid.items()},
    "fiducial_note": "Solid black squares; TL has white notch for orientation.",
    "bubble_radius": {"pt": round(R, 3), "norm_x": round(R / (X1 - X0), 5), "norm_y": round(R / (YT - YB), 5)},
    "qr": {"payload_placeholder": QR_TEXT, "bbox_norm": nbox(qx, qy, qs, qs)},
    "reading_rules": "One team per sheet. HOME/AWAY: exactly one. Roster A-H: two-digit id (00-99). Each game has four shooter rows; WHO is exactly one of A-H. Shooter tens bubbles are 1-4 only; a blank tens with a filled ones digit is a score under 10. Ones are 0-9. Team total is a 100 flag plus tens 0-9 and ones 0-9. Each game is WON or LOST. Handwritten name, date, opponent, and score boxes are not read.",
    "slots": list("ABCDEFGH"),
    "games_count": 3,
    "shooters_per_game": 4,
    "side_field": side,
    "roster": roster,
    "games": games,
    "handwritten_lines": lines,
    "human_only": {"note": "Handwritten lines and score boxes. The scanner must ignore them.", "score_boxes": human_boxes},
}
c.showPage()
c.save()
with open(SPEC, "w", encoding="utf-8") as handle:
    json.dump(spec, handle, indent=1)
print("wrote", OUT, "and", SPEC)
