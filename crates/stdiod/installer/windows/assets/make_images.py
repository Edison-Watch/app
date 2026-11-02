"""Render the setup program's images from the two sources in src/.

    uv run --with pillow python make_images.py

Writes, next to this file:
  banner-*.bmp  the Welcome/Finished side banner, one per DPI (WizardImageFile)
  header-*.bmp  the small icon in each page's header (WizardSmallImageFile)
  setup.ico     the setup program's own icon (SetupIconFile)

The sizes are the ones Inno Setup lists for WizardStyle=modern, 100% to 250%;
it picks the closest for the screen.
"""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
ICON = Image.open(HERE / "src" / "sealgate-beeper.png").convert("RGBA")
WORDMARK = Image.open(HERE / "src" / "wordmark-black.png").convert("RGBA")

BANNER_BG = (0xE9, 0xFB, 0xFA)
BANNER_EDGE = (0xC9, 0xEE, 0xEC)
CAPTION = (0x3D, 0x55, 0x54)
HEADER_BG = (0xFF, 0xFF, 0xFF)

BANNER_SIZES = [(164, 314), (192, 386), (246, 459), (273, 556), (328, 604), (355, 700), (410, 797)]
HEADER_SIZES = [(55, 55), (64, 68), (83, 80), (92, 97), (110, 106), (119, 123), (138, 140)]
FONTS = ["/System/Library/Fonts/Avenir Next.ttc", "/System/Library/Fonts/Helvetica.ttc"]


def font(px: int) -> ImageFont.FreeTypeFont:
    for path in FONTS:
        if Path(path).exists():
            return ImageFont.truetype(path, px)
    return ImageFont.load_default(px)


def fit(im: Image.Image, width: int) -> Image.Image:
    return im.resize((width, round(im.height * width / im.width)), Image.LANCZOS)


def banner(w: int, h: int) -> Image.Image:
    """Combined icon at the top; wordmark and FOR BEEPER at the bottom."""
    s = w / 164
    out = Image.new("RGB", (w, h), BANNER_BG)
    ImageDraw.Draw(out).line([(w - 1, 0), (w - 1, h)], fill=BANNER_EDGE, width=max(1, round(s)))
    icon = fit(ICON, round(104 * s))
    out.paste(icon, ((w - icon.width) // 2, round(40 * s)), icon)

    caption = "FOR BEEPER"
    f = font(round(9 * s))
    spacing = 1.6 * s
    widths = [f.getlength(c) for c in caption]
    cap_w = sum(widths) + spacing * (len(caption) - 1)
    cap_y = h - round(30 * s)
    draw = ImageDraw.Draw(out)
    x = (w - cap_w) / 2
    for c, cw in zip(caption, widths):
        draw.text((x, cap_y), c, font=f, fill=CAPTION)
        x += cw + spacing

    mark = fit(WORDMARK, round(118 * s))
    out.paste(mark, ((w - mark.width) // 2, cap_y - round(10 * s) - mark.height), mark)
    return out


def header(w: int, h: int) -> Image.Image:
    out = Image.new("RGB", (w, h), HEADER_BG)
    side = min(w, h)
    icon = ICON.resize((side, side), Image.LANCZOS)
    out.paste(icon, ((w - side) // 2, (h - side) // 2), icon)
    return out


def main() -> None:
    for w, h in BANNER_SIZES:
        banner(w, h).save(HERE / f"banner-{w}.bmp")
    for w, h in HEADER_SIZES:
        header(w, h).save(HERE / f"header-{w}.bmp")
    ICON.save(HERE / "setup.ico", sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])


if __name__ == "__main__":
    main()
