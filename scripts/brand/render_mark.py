"""Filebridge-Lan brand renderer: one vector master, every raster derived from it.

Design rules encoded here:
- the handwritten F keeps its hand-drawn wobble; weight is added by widening the
  stem and middle bar, never by switching to a monospaced letterform;
- small frames (16/20/24 px) get +5% extra weight so the stem never breaks up;
- 16 px and 20 px drop the outer signal arcs so the dot does not merge into ink;
  32 px and above show the full three-arc wifi.
"""
import os

from PIL import Image, ImageDraw

# ---- master geometry (2048 unit artboard) -------------------------------------
TOP = (
    "M 1276.00 174.81 L 1245.00 175.18 L 1171.00 181.15 L 1163.00 180.47 L 1148.00 183.16 "
    "L 1124.00 184.23 L 1108.00 187.15 L 1083.00 187.17 L 1054.00 191.06 L 1029.00 191.24 "
    "L 1003.00 196.07 L 966.00 199.23 L 862.00 221.89 L 845.00 222.41 L 833.00 226.66 "
    "L 814.00 230.88 L 703.00 250.22 L 642.00 262.42 L 604.00 271.88 L 587.00 274.42 "
    "L 556.00 283.67 L 541.00 285.20 L 506.00 293.91 L 468.00 305.66 L 373.00 323.92 "
    "L 335.00 338.12 L 310.00 343.74 L 300.00 349.39 L 269.00 360.45 L 237.00 380.67 "
    "L 223.00 394.45 L 212.00 402.66 L 209.58 408.00 L 208.43 417.00 L 209.72 422.00 "
    "L 212.72 426.00 L 218.36 431.00 L 224.00 432.92 L 236.00 432.87 L 264.00 427.05 "
    "L 294.00 423.72 L 310.00 418.43 L 338.00 405.79 L 376.00 394.50 L 411.00 386.25 "
    "L 423.00 384.72 L 445.00 378.25 L 464.00 376.72 L 479.00 370.48 L 532.00 359.25 "
    "L 547.00 357.93 L 574.00 352.25 L 588.00 352.04 L 622.00 346.92 L 639.00 340.25 "
    "L 658.00 338.93 L 711.00 328.25 L 721.00 328.07 L 756.00 322.93 L 814.00 308.26 "
    "L 832.00 305.25 L 851.00 304.10 L 887.00 296.26 L 927.00 292.10 L 951.00 285.43 "
    "L 977.00 281.92 L 1010.00 274.42 L 1022.00 274.11 L 1054.00 268.27 L 1065.00 268.11 "
    "L 1117.00 260.27 L 1134.00 259.11 L 1140.00 256.45 L 1154.00 255.11 L 1169.00 251.27 "
    "L 1196.00 248.28 L 1213.00 248.11 L 1235.00 243.40 L 1264.00 240.28 L 1298.00 240.69 "
    "L 1300.63 243.00 L 1301.44 246.00 L 1298.00 254.86 L 1278.00 280.74 L 1267.11 292.00 "
    "L 1243.00 312.20 L 1211.00 344.11 L 1198.23 353.00 L 1187.09 363.00 L 1188.00 365.39 "
    "L 1193.00 367.83 L 1209.00 369.99 L 1223.00 370.04 L 1265.00 361.67 L 1313.00 344.33 "
    "L 1361.00 314.03 L 1423.12 257.00 L 1429.52 248.00 L 1433.43 238.00 L 1432.12 229.00 "
    "L 1420.00 208.24 L 1404.00 193.81 L 1389.00 186.64 L 1378.00 183.56 L 1366.00 183.13 "
    "L 1332.00 178.31 L 1277.00 174.56 Z"
)

STEM = (
    "M 633.00 474.73 L 624.00 478.88 L 610.45 494.00 L 606.41 515.00 L 598.71 539.00 "
    "L 591.24 581.00 L 559.72 719.00 L 554.45 769.00 L 551.73 777.00 L 548.45 805.00 "
    "L 542.73 829.00 L 540.45 848.00 L 529.73 893.00 L 527.40 910.00 L 523.75 922.00 "
    "L 522.44 938.00 L 516.94 956.00 L 513.45 976.00 L 495.45 1053.00 L 486.93 1084.00 "
    "L 484.43 1100.00 L 475.93 1132.00 L 452.44 1241.00 L 439.17 1292.00 L 428.95 1323.00 "
    "L 427.65 1343.00 L 420.44 1378.00 L 409.96 1413.00 L 401.96 1452.00 L 401.43 1460.00 "
    "L 394.97 1477.00 L 394.79 1493.00 L 392.43 1508.00 L 374.97 1568.00 L 373.80 1592.00 "
    "L 366.98 1630.00 L 365.65 1649.00 L 359.98 1667.00 L 359.81 1684.00 L 357.89 1695.00 "
    "L 358.87 1730.00 L 356.25 1743.00 L 359.00 1751.99 L 375.00 1776.50 L 384.00 1780.89 "
    "L 398.00 1780.38 L 405.21 1775.00 L 421.38 1750.00 L 427.68 1729.00 L 437.19 1682.00 "
    "L 444.45 1661.00 L 445.02 1642.00 L 448.69 1629.00 L 449.02 1616.00 L 452.84 1599.00 "
    "L 452.93 1580.00 L 458.84 1542.00 L 460.03 1523.00 L 470.69 1496.00 L 474.83 1468.00 "
    "L 476.02 1440.00 L 487.01 1387.00 L 491.52 1369.00 L 499.49 1348.00 L 507.51 1312.00 "
    "L 510.64 1304.00 L 517.08 1294.00 L 521.47 1282.00 L 521.99 1265.00 L 537.98 1191.00 "
    "L 544.22 1175.00 L 565.98 1085.00 L 590.47 999.00 L 603.97 935.00 L 613.47 899.00 "
    "L 630.98 807.00 L 639.25 778.00 L 648.98 733.00 L 651.44 727.00 L 657.47 693.00 "
    "L 662.75 646.00 L 672.47 597.00 L 673.54 534.00 L 659.07 492.00 L 648.00 483.55 "
    "L 642.00 476.76 L 637.00 474.16 L 634.00 474.41 Z"
)

MID = (
    "M 1123.00 950.92 L 1105.00 953.92 L 1083.00 955.10 L 1069.00 957.92 L 1033.00 959.11 "
    "L 963.00 972.91 L 945.00 974.10 L 873.00 985.91 L 849.00 987.10 L 834.00 992.54 "
    "L 796.00 1000.30 L 744.00 1014.03 L 697.00 1030.65 L 677.00 1041.53 L 630.49 1057.00 "
    "L 626.65 1063.00 L 621.52 1080.00 L 624.00 1084.90 L 631.00 1089.20 L 644.00 1091.94 "
    "L 659.00 1092.13 L 675.00 1097.80 L 696.00 1097.93 L 713.00 1092.13 L 744.00 1090.94 "
    "L 762.00 1087.13 L 784.00 1085.80 L 812.00 1080.13 L 839.00 1078.95 L 851.00 1075.13 "
    "L 893.00 1071.03 L 922.00 1069.95 L 950.00 1064.12 L 966.00 1062.04 L 980.00 1061.95 "
    "L 998.00 1056.29 L 1021.00 1052.69 L 1022.72 1051.00 L 1023.42 1044.00 L 1026.00 1042.15 "
    "L 1083.00 1042.04 L 1113.00 1038.96 L 1133.00 1035.50 L 1160.00 1026.28 L 1192.00 1024.96 "
    "L 1219.00 1017.15 L 1257.00 1015.96 L 1269.00 1013.39 L 1284.00 1006.42 L 1288.03 1003.00 "
    "L 1292.45 993.00 L 1292.59 984.00 L 1290.87 979.00 L 1286.00 975.70 L 1276.00 973.31 "
    "L 1250.00 963.62 L 1226.00 959.56 L 1215.00 954.15 L 1191.00 953.97 L 1183.00 952.05 "
    "L 1149.00 950.04 L 1124.00 950.74 Z"
)

DOT = (1737.5, 1772.0, 50.0)
ARC_RADII = (166.5, 353.0, 542.5)
ARC_WIDTH = 71.0

STEM_GAIN = 0.12
MID_GAIN = 0.10
SMALL_GAIN = 0.05

SIZES = (16, 20, 24, 32, 40, 48, 64, 128, 256)
ARTBOARD = 2048.0


def points(path):
    tokens = path.replace(",", " ").split()
    cmd, out, i = None, [], 0
    while i < len(tokens):
        tok = tokens[i]
        if tok.isalpha():
            cmd = tok
            i += 1
            continue
        if cmd in ("M", "L"):
            out.append((float(tokens[i]), float(tokens[i + 1])))
            i += 2
        else:
            i += 1
    return out


def widen(pts, gain, axis):
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    cx = (min(xs) + max(xs)) / 2.0
    cy = (min(ys) + max(ys)) / 2.0
    out = []
    for x, y in pts:
        if axis == "x":
            out.append((cx + (x - cx) * (1 + gain), y))
        elif axis == "y":
            out.append((x, cy + (y - cy) * (1 + gain)))
        else:
            out.append((cx + (x - cx) * (1 + gain), cy + (y - cy) * (1 + gain)))
    return out


def arc_segment(cx, cy, radius, width, start_deg, end_deg, k, color, draw):
    steps = 24
    centers = []
    for i in range(steps + 1):
        t = start_deg + (end_deg - start_deg) * i / steps
        rad = t * 3.14159265358979 / 180.0
        centers.append(((cx + radius * __import__("math").cos(rad)) * k, (cy + radius * __import__("math").sin(rad)) * k))
    w = max(1.0, width * k)
    for (x, y) in centers:
        draw.ellipse([x - w / 2, y - w / 2, x + w / 2, y + w / 2], fill=color)
    for a, b in zip(centers, centers[1:]):
        draw.line([a, b], fill=color, width=int(round(w)))


def render(size, color):
    ss = 8 if size <= 64 else 4
    canvas = Image.new("RGBA", (size * ss, size * ss), (0, 0, 0, 0))
    draw = ImageDraw.Draw(canvas)
    k = size * ss / ARTBOARD
    small = size in (16, 20, 24)
    gain = STEM_GAIN + (SMALL_GAIN if small else 0.0)
    mid_gain = MID_GAIN + (SMALL_GAIN if small else 0.0)

    draw.polygon([(x * k, y * k) for x, y in points(TOP)], fill=color)
    draw.polygon([(x * k, y * k) for x, y in widen(points(STEM), gain, "x")], fill=color)
    draw.polygon([(x * k, y * k) for x, y in widen(points(MID), mid_gain, "y")], fill=color)

    cx, cy, r = DOT
    draw.ellipse([(cx - r) * k, (cy - r) * k, (cx + r) * k, (cy + r) * k], fill=color)

    radii = ARC_RADII[:1] if size <= 20 else ARC_RADII
    for radius in radii:
        arc_segment(cx, cy, radius, ARC_WIDTH, 180.0, 270.0, k, color, draw)

    return canvas.resize((size, size), Image.LANCZOS)


def contact_sheet(path):
    pad, cell = 12, 272
    height = pad + (cell + 56) * 2
    sheet = Image.new("RGB", (pad + (cell + pad) * len(SIZES) + pad, height), (255, 255, 255))
    draw = ImageDraw.Draw(sheet)
    rows = (("black", (243, 245, 249)), ("white", (27, 37, 51)))
    for row, (variant, bg) in enumerate(rows):
        y0 = pad + row * (cell + 56)
        draw.rectangle([0, y0 - pad, sheet.width, y0 + cell + 24], fill=bg)
        for col, size in enumerate(SIZES):
            color = (0, 0, 0, 255) if variant == "black" else (255, 255, 255, 255)
            tile = render(size, color)
            box = pad + col * (cell + pad)
            x = box + (cell - size) // 2
            y = y0 + (cell - size) // 2
            sheet.paste(tile, (x, y), tile)
            draw.text((box + 4, y0 + cell + 2), f"{size}px {variant}", fill=(110, 120, 135) if variant == "black" else (200, 208, 220))
    sheet.save(path)


if __name__ == "__main__":
    import sys

    out = sys.argv[1] if len(sys.argv) > 1 else "."
    os.makedirs(out, exist_ok=True)
    contact_sheet(os.path.join(out, "brand-contact-sheet.png"))
    print("contact sheet written")
