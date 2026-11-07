"""Export every Filebridge-Lan brand asset from the single vector master.

Outputs:
  * transparent black / white SVG (explicit fill, no currentColor)
  * transparent black / white PNG + multi-size ICO (16..256)
  * white rounded app icon SVG / PNG / ICO
  * contact sheet for the size review
"""
import argparse
import os

from PIL import Image, ImageDraw

import render_mark as rm

BLACK = "#000000"
WHITE = "#FFFFFF"

APP_RADIUS = 450.6
APP_INSET = 258.78
APP_SCALE = 0.748044


def svg_mark(color):
    def widen_points(path, gain, axis):
        pts = rm.widen(rm.points(path), gain, axis)
        head = f"M {pts[0][0]:.2f} {pts[0][1]:.2f}"
        body = " ".join(f"L {x:.2f} {y:.2f}" for x, y in pts[1:])
        return f"{head} {body} Z"

    top = " ".join(f"{tok}" for tok in rm.TOP.split())
    stem = widen_points(rm.STEM, rm.STEM_GAIN, "x")
    mid = widen_points(rm.MID, rm.MID_GAIN, "y")
    cx, cy, r = rm.DOT
    arcs = [
        f'<path d="M {cx - rad:.1f} {cy:.1f} A {rad:.1f} {rad:.1f} 0 0 1 {cx:.1f} {cy - rad:.1f}" '
        f'fill="none" stroke="{color}" stroke-width="{rm.ARC_WIDTH:.0f}" stroke-linecap="round"/>'
        for rad in rm.ARC_RADII
    ]
    parts = [
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2048 2048" width="2048" height="2048">',
        "  <title>Filebridge-Lan mark</title>",
        f'  <path d="{top}" fill="{color}" fill-rule="evenodd"/>',
        f'  <path d="{stem}" fill="{color}" stroke="{color}" stroke-width="11" stroke-linejoin="round"/>',
        f'  <path d="{mid}" fill="{color}" stroke="{color}" stroke-width="8" stroke-linejoin="round"/>',
        *[f"  {arc}" for arc in arcs],
        f'  <circle cx="{cx}" cy="{cy}" r="{r:.1f}" fill="{color}"/>',
        "</svg>",
        "",
    ]
    return "\n".join(parts)


def svg_app_icon():
    return "\n".join(
        [
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2048 2048" width="2048" height="2048">',
            "  <title>Filebridge-Lan app icon</title>",
            f'  <rect width="2048" height="2048" rx="{APP_RADIUS}" fill="{WHITE}"/>',
            f'  <g transform="translate({APP_INSET} {APP_INSET}) scale({APP_SCALE})">',
            *[f"    {line}" for line in svg_mark(BLACK).splitlines()[2:-1]],
            "  </g>",
            "</svg>",
            "",
        ]
    )


def mark_png(size, color):
    return rm.render(size, color)


def app_icon(size):
    ss = 8 if size <= 64 else 4
    canvas = Image.new("RGBA", (size * ss, size * ss), (0, 0, 0, 0))
    draw = ImageDraw.Draw(canvas)
    k = size * ss / 2048.0
    radius = APP_RADIUS * k
    draw.rounded_rectangle([0, 0, size * ss - 1, size * ss - 1], radius=radius, fill=(255, 255, 255, 255))
    glyph = rm.render(size, (0, 0, 0, 255))
    inset = int(round(APP_INSET * k))
    scaled = int(round(size * ss * APP_SCALE))
    glyph = glyph.resize((scaled, scaled), Image.LANCZOS)
    canvas.alpha_composite(glyph, (inset, inset))
    out = canvas.resize((size, size), Image.LANCZOS)
    # keep the rounded corner alpha clean after downscaling
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, size - 1, size - 1], radius=APP_RADIUS * size / 2048.0, fill=255)
    out.putalpha(mask)
    return out


def write_ico(path, renderer, color=None):
    frames = []
    for size in rm.SIZES:
        frames.append(renderer(size) if color is None else renderer(size, color))
    frames[-1].save(path, format="ICO", sizes=[(s, s) for s in rm.SIZES], append_images=frames[:-1])


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", required=True)
    parser.add_argument("--design", required=True)
    args = parser.parse_args()
    os.makedirs(args.out, exist_ok=True)
    os.makedirs(args.design, exist_ok=True)

    for variant, color in (("black", BLACK), ("white", WHITE)):
        svg_path = os.path.join(args.out, f"filebridge-lan-logo-{variant}.svg")
        with open(svg_path, "w", encoding="utf-8") as handle:
            handle.write(svg_mark(color))
        rgba = (0, 0, 0, 255) if variant == "black" else (255, 255, 255, 255)
        mark_png(1024, rgba).save(os.path.join(args.out, f"filebridge-lan-logo-{variant}.png"))
        write_ico(os.path.join(args.out, f"filebridge-lan-logo-{variant}.ico"), mark_png, rgba)

    with open(os.path.join(args.out, "filebridge-lan-app-icon.svg"), "w", encoding="utf-8") as handle:
        handle.write(svg_app_icon())
    app_icon(1024).save(os.path.join(args.out, "filebridge-lan-app-icon.png"))
    write_ico(os.path.join(args.out, "filebridge-lan-app-icon.ico"), app_icon)

    # design source archive (same master, same exports)
    for name in os.listdir(args.out):
        if name.endswith((".svg", ".png", ".ico")):
            src = os.path.join(args.out, name)
            dst = os.path.join(args.design, name)
            with open(src, "rb") as handle:
                data = handle.read()
            with open(dst, "wb") as handle:
                handle.write(data)

    rm.contact_sheet(os.path.join(args.out, "brand-contact-sheet.png"))
    print("exported brand assets")


if __name__ == "__main__":
    main()
