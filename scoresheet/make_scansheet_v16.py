#!/usr/bin/env python3
"""Results Scan Sheet v16 - ONE-TEAM sheet (each team fills its own). Letter, portrait or landscape (--landscape).
(derived from v15) - roster + WHO picker. HOME left | AWAY right, one page, no QR.
Per team: team/captain line; ROSTER of 8 slots A-H (tall name line + 2-digit player ID = two 0-9 keypads
+ write-in box); game header; 4 shooter rows + TEAM TOTAL per game. Each shooter row/game:
  [WHO picker A B C / D E F]  [TENS 1-4 column]  [ONES keypad 1 2 3 / 4 5 6 / 7 8 9 / 0 under 8]
  with a write-in box for the whole score under the WHO picker.
TEAM TOTAL per game: '100' key above TENS 1, TENS + ONES keypads (0 under 8), small box under each 7.
  python3 make_scansheet_v13.py           -> letter landscape (roster 3 x 2 grid)
  python3 make_scansheet_v13.py --legal   -> legal landscape alternative (roster 3 x 3, ID box left of pads)
Outputs roslyn_scansheet_v13[_legal].pdf + scansheet_v13[_legal]_layout_spec.json"""
import json, sys
from reportlab.lib.pagesizes import letter, legal, landscape
from reportlab.pdfgen import canvas
from reportlab.lib.colors import Color, black, white, HexColor

LEGAL = "--legal" in sys.argv
VERSION = "v16"
LAND = "--landscape" in sys.argv
W, H = landscape(letter) if LAND else letter
SUF = "_landscape" if LAND else ""
OUT, SPEC = f"roslyn_scansheet_v16{SUF}.pdf", f"scansheet_v16{SUF}_layout_spec.json"
NAVY = Color(0.04, 0.08, 0.22); DIGIT = Color(0.28, 0.28, 0.31); GRAY = Color(0.2, 0.2, 0.2)
TINT = Color(0.90, 0.90, 0.90)
# light pastels only; rows alternate two shades of the team family, TEAM TOTAL its own shade
PALETTE_HEX = {"home": {"a": "#E3EFFF", "b": "#CCE0FA", "team": "#D6D0F5"},
               "away": {"a": "#FFEEDD", "b": "#FFDCC2", "team": "#FFF0B3"}}
PAL = {t: {k: HexColor(v) for k, v in d.items()} for t, d in PALETTE_HEX.items()}
LW = 1.3; MIN_GAP = 2.2; CLR = 3.5; ASPECT_MAX = 1.25
POS = [(0,0),(1,0),(2,0),(0,1),(1,1),(2,1),(0,2),(1,2),(2,2),(1,3)]   # 0 under 8
DIGITS = [1,2,3,4,5,6,7,8,9,0]; SLOTS = list("ABCDEFGH")

M = 21.6; FID = 22
fid = {k: (x + FID/2, y + FID/2) for k, (x, y) in {
    "TL": (M, H-M-FID), "TR": (W-M-FID, H-M-FID), "BL": (M, M), "BR": (W-M-FID, M)}.items()}
X0, X1, YT, YB = fid["TL"][0], fid["TR"][0], fid["TL"][1], fid["BL"][1]
nx = lambda x: round((x - X0)/(X1 - X0), 5)
ny = lambda y: round((YT - y)/(YT - YB), 5)
nbox = lambda x, y, w, h: [nx(x), ny(y + h), round(w/(X1-X0), 5), round(h/(YT-YB), 5)]

HEADER_H = FID + 4; WIN_H = 46; TEAMLINE_H = 28 + 22 + 16; GAMEHDR_H = 18   # team block: team+side / captain+opponent / instructions
LABEL_W = 22; PG = 8; SPLIT = 12; BPAD = 1.0; G1 = 3; G2 = 4      # G1: WHO->TENS gap, G2: TENS->ONES gap
WHO_F = 0.85                                   # WHO bubble pitch as a fraction of PX
RC = 4; RROWS = 2                              # roster grid 4 columns x 2 rows (8 slots A-H)
RN_H = 26                    # roster name strip height (name baseline ~18pt below top)
BOX_IN_STRIP = not LEGAL
ID_BOXW = 40 if BOX_IN_STRIP else 38; KGI = 3
ID_RATIO = 0.8                                 # ID key height ~ 0.8 x score key height

HALF = W - 2*M
PANEL_W = (HALF - LABEL_W - 2*PG) / 3
PX = (PANEL_W - G1 - G2) / (4*WHO_F + 4); PW = WHO_F*PX
G2_LIGHTEN = 0.55; GBOX_LW = 3.0; TEAM_XPAD = 2.6               # bold game-box outline; extra pad under TEAM TOTAL keys
avail = (H - 2*M) - HEADER_H - WIN_H - TEAMLINE_H - GAMEHDR_H - 2*BPAD*(5 + RROWS) - RROWS*RN_H - TEAM_XPAD
# avail = 21*PY + RROWS*4*PYI,  PYI = MIN_GAP + ID_RATIO*(PY - MIN_GAP)
PY = (avail - RROWS*4*MIN_GAP*(1 - ID_RATIO)) / (21 + RROWS*4*ID_RATIO)
PYI = MIN_GAP + ID_RATIO*(PY - MIN_GAP)
rx = (PX - MIN_GAP)/2; ry = (PY - MIN_GAP)/2
rx = min(rx, ry*ASPECT_MAX); ry = min(ry, rx*ASPECT_MAX)
FS = min(2*ry*0.80, 2*rx*0.95/0.62)
colw = HALF / RC
PXI = (colw - 6 - KGI - (0 if BOX_IN_STRIP else ID_BOXW + CLR + 4)) / 6
ryi = (PYI - MIN_GAP)/2; rxi = min((PXI - MIN_GAP)/2, ryi*ASPECT_MAX); ryi = min(ryi, rxi*ASPECT_MAX)
FSI = min(2*ryi*0.80, 2*rxi*0.95/0.62)
rw = min((PW - MIN_GAP)/2, ry*ASPECT_MAX); rhw = min(ry, rw*ASPECT_MAX)     # WHO bubble radii
FSW = min(2*rhw*0.78, 2*rw*0.68/0.72)   # letters are wider than digits
mm = lambda v: v/72*25.4
print(f"{'LANDSCAPE' if LAND else 'PORTRAIT'}: score key {2*rx:.2f} x {2*ry:.2f}pt ({mm(2*rx):.1f} x {mm(2*ry):.1f}mm) digit {FS:.1f}pt | "
      f"WHO {2*rw:.2f} x {2*rhw:.2f}pt | ID key {2*rxi:.2f} x {2*ryi:.2f}pt digit {FSI:.1f}pt")

c = canvas.Canvas(OUT, pagesize=(W, H))
c.setTitle(f"Roslyn VFW Dart League - Results Scan Sheet {VERSION}")
roster, who, fields, winners, lines, boxes = {}, {}, {}, {}, [], []
GCLR = {}
clr = [1e9]
def txt(s, x, y, size=10, font="Helvetica", color=GRAY, align="l"):
    c.setFont(font, size); c.setFillColor(color)
    {"l": c.drawString, "c": c.drawCentredString, "r": c.drawRightString}[align](x, y, s)
def wline(name, x, y, w, h=14):
    c.setStrokeColor(black); c.setLineWidth(0.9); c.line(x, y, x + w, y)
    lines.append(dict(name=name, type="handwritten_not_scanned", bbox_norm=nbox(x, y, w, h)))
def key(x, y, label, a=None, b=None, size=None):
    a = a or rx; b = b or ry; size = size or FS
    c.setStrokeColor(NAVY); c.setLineWidth(LW); c.setFillColor(white)
    c.ellipse(x - a, y - b, x + a, y + b, fill=1)
    txt(label, x, y - size*0.36, size, "Helvetica-Bold", DIGIT, "c")
def wbox(name, x, y, w, h, desc):
    c.setFillColor(white); c.setStrokeColor(black); c.setLineWidth(1.2)
    c.rect(x, y, w, h, fill=1, stroke=1)
    boxes.append(dict(name=name, type="human_only_not_scanned", covers=desc, bbox_norm=nbox(x, y, w, h)))
def pad(x, ytop, px_, py_, a, b, fs):
    out = []
    for v, (col, row) in zip(DIGITS, POS):
        cx, cy = x + (col + 0.5)*px_, ytop - (row + 0.5)*py_
        key(cx, cy, str(v), a, b, fs); out.append(dict(value=v, center_norm=[nx(cx), ny(cy)]))
    return out

# ---------- page furniture ----------
c.setFillColor(black)
for cx, cy in fid.values(): c.rect(cx-FID/2, cy-FID/2, FID, FID, stroke=0, fill=1)
c.setFillColor(white); c.rect(fid["TL"][0]-4, fid["TL"][1]-4, 8, 8, stroke=0, fill=1)
hy = H - M - FID/2 - 5; hx = M + FID + 10; hr = W - M - FID - 10
txt("Roslyn VFW Dart League · Results", hx, hy, 15, "Helvetica-Bold", black)
dx = hx + c.stringWidth("Roslyn VFW Dart League · Results", "Helvetica-Bold", 15) + 16
txt("Date", dx, hy, 12, "Helvetica-Bold", black); wline("date", dx + 32, hy - 2, hr - dx - 32)
side_pick = []
def team(side, xl, y):
    tag = "team"; xr = xl + HALF; P = PAL["home"]
    px = lambda g: xl + LABEL_W + g*(PANEL_W + PG)
    # row 1: big team name + HOME/AWAY
    ty = y - 21
    txt("TEAM", xl, ty, 16, "Helvetica-Bold", black)
    sx = xr - 150
    wline("team_name", xl + 52, ty - 3, sx - xl - 64, 24)
    txt("We are:", sx, ty + 1, 10.5, "Helvetica-Bold", black)
    for k_, (val, l_) in enumerate((("home", "HOME"), ("away", "AWAY"))):
        bx = sx + 64 + k_*44; key(bx, ty + 4, l_, 20, 10.5, 8)
        side_pick.append(dict(value=val, center_norm=[nx(bx), ny(ty + 4)]))
    # row 2: captain + opponent
    ty -= 22; half_ = (HALF - 10)/2
    txt("Captain", xl, ty, 11, "Helvetica-Bold", black); wline("captain", xl + 48, ty - 2, half_ - 52)
    ox = xl + half_ + 10
    txt("Opponent", ox, ty, 11, "Helvetica-Bold", black); wline("opponent", ox + 58, ty - 2, xr - ox - 58)
    # row 3: instructions
    ty -= 17
    txt("Fill dark.  Roster: name + 2-digit ID (47 = 4,7).  Each row: WHO shot (roster letter A-H), then score.  Under 10: TENS blank.",
        xl, ty, 9.5 if LAND else 8.6, "Helvetica-Oblique", black)
    y -= TEAMLINE_H
    # ---------- ROSTER ----------
    slot_h = RN_H + 4*PYI + 2*BPAD
    IDW = 6*PXI + KGI
    for k, L in enumerate(SLOTS):
        r_, c_ = divmod(k, RC); x0 = xl + c_*colw; y0 = y - r_*slot_h
        c.setFillColor(P["a"] if (r_ + c_) % 2 == 0 else P["b"]); c.rect(x0, y0 - slot_h, colw, slot_h, stroke=0, fill=1)
        txt(L, x0 + 4, y0 - 17, 15, "Helvetica-Bold", black)
        ky = y0 - RN_H - BPAD
        if BOX_IN_STRIP:
            wline(f"{tag}_roster_{L}_name", x0 + 20, y0 - RN_H + 4, colw - 26, RN_H - 5)   # full-width name line, no ID box
            kx = x0 + (colw - IDW)/2
        else:
            wline(f"{tag}_roster_{L}_name", x0 + 16, y0 - RN_H + 3, colw - 22, RN_H - 4)
            kx = x0 + colw - 3 - IDW
            top = ky - (0.5*PYI - ryi) - 2.6; bot = ky - (3.5*PYI + ryi) + 2.6
            bh = min(top - bot, 40); mid = (top + bot)/2
            bxl = x0 + 4; bxr = kx + 0.5*PXI - rxi - CLR
            wbox(f"{tag}_roster_{L}_id_written", bxl, mid - bh/2, bxr - bxl, bh, "whole 2-digit player ID")
        dl = []
        for j, place in enumerate(("tens", "ones")):
            dl.append(dict(place=place, layout="keypad_0_under_8",
                           bubbles=pad(kx + j*(3*PXI + KGI), ky, PXI, PYI, rxi, ryi, FSI)))
        roster[f"{tag}_{L}"] = dict(slot=L, type="player_id", format="[0-9]{2}", max_ids=100,
                                    blank_slot_allowed=True, digits=dl)
    c.setStrokeColor(black); c.setLineWidth(1.5)
    for r_ in range(1, RROWS + 1): c.line(xl, y - r_*slot_h, xr, y - r_*slot_h)
    for c_ in range(1, RC): c.line(xl + c_*colw, y, xl + c_*colw, y - RROWS*slot_h)
    y -= RROWS*slot_h
    # ---------- game header ----------
    for g in range(3):
        c.setFillColor(TINT); c.rect(px(g), y - GAMEHDR_H + 1, PANEL_W, GAMEHDR_H - 1, stroke=0, fill=1)
        txt("WHO", px(g) + 2*PW, y - 12.5, 9, "Helvetica-Bold", black, "c")
        txt(f"GAME {g+1}", px(g) + 4*PW + G1 + (PANEL_W - 3*PW - G1)/2, y - 13, 12, "Helvetica-Bold", black, "c")
    ytop_g = y; y -= GAMEHDR_H; ytop_b = y; divs = []
    for s in range(1, 6):
        shooter = s < 5
        bh = (4 if shooter else 5)*PY + 2*BPAD + (0 if shooter else TEAM_XPAD)
        c.setFillColor((P["a"] if s % 2 else P["b"]) if shooter else P["team"])
        c.rect(xl, y - bh, HALF, bh, stroke=0, fill=1)
        bc = (P["a"] if s % 2 else P["b"]) if shooter else P["team"]   # GAME 2 column: blend 55% toward white
        c.setFillColor(Color(*(v + G2_LIGHTEN*(1 - v) for v in (bc.red, bc.green, bc.blue))))
        c.rect(px(1) - PG/2, y - bh, PANEL_W + PG, bh, stroke=0, fill=1)
        if shooter:
            txt(f"S{s}", xl + 8, y - bh/2 - 4, 11, "Helvetica-Bold", black, "c")
        else:
            c.saveState(); c.translate(xl + 12, y - bh/2); c.rotate(90)
            txt("TEAM TOTAL", 0, 0, 10, "Helvetica-Bold", black, "c"); c.restoreState()
        yt = y - BPAD
        for g in range(3):
            x = px(g); name = f"{tag}_g{g+1}_{'s'+str(s) if shooter else 'team'}"
            xt = x + 4*PW + G1            # TENS column left edge
            xo = xt + PX + G2             # ONES pad left edge
            digits = []
            if shooter:
                # WHO picker: A B C D / E F G H in the top two rows
                wb = []
                for k, L in enumerate(SLOTS):
                    r_, c_ = divmod(k, 4)
                    cx, cy = x + (c_ + 0.5)*PW, yt - (r_ + 0.5)*PY
                    key(cx, cy, L, rw, rhw, FSW); wb.append(dict(value=L, center_norm=[nx(cx), ny(cy)]))
                who[name.replace("_s", "_s")] = dict(rule="exactly one", options=SLOTS, bubbles=wb)
                # whole-score write-in box under the WHO picker (rows 3-4)
                btop = yt - (1.5*PY + rhw) - CLR; bbot = yt - 4*PY + (3.6 - BPAD)
                bl_, br_ = x + 1.5, xt + (PX/2 - rx) - CLR
                wbox(f"{name}_score_written", bl_, bbot, br_ - bl_, btop - bbot, "whole 2-digit shooter score")
                SB = (br_ - bl_, btop - bbot)
                t = []
                for k, v in enumerate((1, 2, 3, 4)):
                    cx, cy = xt + PX/2, yt - (k + 0.5)*PY
                    key(cx, cy, str(v)); t.append(dict(value=v, center_norm=[nx(cx), ny(cy)]))
                digits.append(dict(place="tens", layout="column_1_to_4", blank_means=0, bubbles=t))
                digits.append(dict(place="ones", layout="keypad_0_under_8", bubbles=pad(xo, yt, PX, PY, rx, ry, FS)))
                fields[name] = dict(type="shooter_game_total", max=49, who_field=name, digits=digits)
            else:
                xT = xt + PX - 3*PX       # team TENS pad ends where the shooter TENS column ends
                cx, cy = xT + 0.5*PX, yt - 0.5*PY
                key(cx, cy, "100", size=min(FS, 2*rx*0.36))
                txt("if 100+", cx + rx + 4, cy - 3.6, 10, "Helvetica-Bold", black)
                digits.append(dict(place="hundreds", type="flag", meaning="filled = +100, blank = 0",
                                   bubbles=[dict(value=1, center_norm=[nx(cx), ny(cy)])]))
                for place, xx in (("tens", xT), ("ones", xo)):
                    digits.append(dict(place=place, layout="keypad_0_under_8", bubbles=pad(xx, yt - PY, PX, PY, rx, ry, FS)))
                    cy3 = yt - PY - 3.5*PY; bh_ = min(2*ry + 1, 2*(PY - ry - CLR))
                    bl_ = xx + 0.5*PX - rx; br_ = xx + 1.5*PX - rx - CLR
                    wbox(f"{name}_{place}_written", bl_, cy3 - bh_/2, br_ - bl_, bh_, f"team total {place} digit")
                    TB = (br_ - bl_, bh_)
                fields[name] = dict(type="team_game_total", max=199, digits=digits)
        y -= bh
        if shooter: divs.append(y)
    c.setStrokeColor(black); c.setLineWidth(0.75)
    for yy in divs: c.line(xl, yy, xr, yy)
    # bold box around each game column: GAME n header down through TEAM TOTAL
    c.setLineWidth(GBOX_LW)
    for g in range(3):
        c.rect(px(g) - PG/2, y, PANEL_W + PG, ytop_g - y, stroke=1, fill=0)
    gb = GBOX_LW/2
    GCLR.update(left=(px(0) + PW/2 - rw) - (px(0) - PG/2 + gb),
                right=(px(0) + PANEL_W + PG/2 - gb) - (px(0) + PANEL_W - (PX/2 - rx)),
                bottom=(y + BPAD + TEAM_XPAD + (PY/2 - ry)) - (y + gb))
    return y, SB, TB

y0 = H - M - HEADER_H
yb, SB, TB = team("Team", M, y0)

# ---------- our results: WON / LOST ----------
winners = {}
items = [("game1_result", "Game 1"), ("game2_result", "Game 2"), ("game3_result", "Game 3"),
         ("beer_frame_result", "Beer frame"), ("total_points_result", "Total pts")]
xa, xb = M + FID + 8, W - M - FID - 8; step = (xb - xa) / 5
ow, oh = (16, 10) if not LAND else (18, 10.5)
lab_y = M + WIN_H - 16; by = M + 10
for k_, (nm, lab) in enumerate(items):
    cxm = xa + (k_ + 0.5)*step
    txt(lab, cxm, lab_y, 11, "Helvetica-Bold", black, "c"); winners[nm] = []
    for j_, val in enumerate(("WON", "LOST")):
        bx = cxm + (j_ - 0.5)*(2*ow + 5); key(bx, by, val, ow, oh, 8.5)
        winners[nm].append(dict(value=val.lower(), center_norm=[nx(bx), ny(by)]))
txt(VERSION, W - M - FID - 4, M + FID + 3, 7, "Helvetica", GRAY, "r")
print(f"shooter score box {SB[0]:.1f}x{SB[1]:.1f}pt; team pad box {TB[0]:.1f}x{TB[1]:.1f}pt; boxes {len(boxes)}; "
      f"game-box clearance {', '.join(f'{k} {v:.1f}' for k, v in GCLR.items())}; grid bottom {yb:.1f} vs results top {M+WIN_H:.1f}; WHO letter {FSW:.1f}pt")
c.showPage(); c.save()

json.dump({"sheet": "Roslyn VFW Dart League Results Scan Sheet", "version": VERSION,
    "page": {"size_pt": [W, H], "orientation": f"{'landscape' if LAND else 'portrait'} letter", "pages": 1,
             "safe_margin_pt": M, "team_arrangement": "one team per sheet; side given by side_field"},
    "coordinate_system": "Normalized to corner-marker centres: (0,0)=TL, (1,0)=TR, (0,1)=BL; y down.",
    "fiducials": {k: {"center_pt_topleft": [v[0], H - v[1]], "size_pt": FID} for k, v in fid.items()},
    "orientation": "Determined from the corner squares alone: only TL has a white notch.",
    "version_marker": {"text": VERSION, "note": "No QR code. Version identified by the small printed marker (bottom right, above BR marker) and the layout."},
    "band_colors_hex": PALETTE_HEX,
    "digit_layout": "0-9 keypads: 1-2-3 / 4-5-6 / 7-8-9 / 0 under 8. Shooter TENS: column 1-4 (blank = 0). WHO: A B C D / E F G H.",
    "bubble_size_pt": {"score": {"width": round(2*rx, 2), "height": round(2*ry, 2), "pitch_x": round(PX, 2), "pitch_y": round(PY, 2)},
                       "who": {"width": round(2*rw, 2), "height": round(2*rhw, 2), "pitch_x": round(PW, 2), "pitch_y": round(PY, 2)},
                       "roster_id": {"width": round(2*rxi, 2), "height": round(2*ryi, 2), "pitch_x": round(PXI, 2), "pitch_y": round(PYI, 2)},
                       "result": {"width": 2*ow, "height": 2*oh}},
    "bubble_radius_norm": {"score": [round(rx/(X1-X0), 5), round(ry/(YT-YB), 5)],
                           "who": [round(rw/(X1-X0), 5), round(rhw/(YT-YB), 5)],
                           "roster_id": [round(rxi/(X1-X0), 5), round(ryi/(YT-YB), 5)],
                           "result": [round(ow/(X1-X0), 5), round(oh/(YT-YB), 5)]},
    "reading_rules": "Roster: each used slot A-H has a 2-digit ID (one key per pad); unused slots blank. WHO: exactly one of A-H per shooter row per game, naming the roster slot that shot. Shooter TENS (1-4 column): zero or one, blank = 0; ONES: exactly one; shooter max 49. Team total: '100' flag (filled = +100), TENS and ONES exactly one each; max 199. Side: exactly one of home/away. Results: one of won/lost per group. Ignore all human_only regions.",
    "roster_fields": roster, "who_fields": who, "number_fields": fields, "side_field": {"rule": "exactly one", "bubbles": side_pick}, "result_fields": winners,
    "handwritten_lines": lines,
    "human_only": {"note": "Handwritten write-in boxes for people; scanner must ignore.", "write_in_boxes": boxes}},
    open(SPEC, "w"), indent=1)
