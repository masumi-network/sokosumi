"""Render the weekly "What's new in Sokosumi" video from a JSON brief.

Pure code: Pillow draws every frame and the ffmpeg bundled with
imageio-ffmpeg encodes them. No generative model is involved.

    pip install pillow imageio-ffmpeg
    python3 render.py brief.json out/weekly.mp4

brief.json:
    {
      "week": "Nov 10 - 16, 2026",
      "items": [{"title": "Contacts know who follows you on X",
                 "summary": "See who follows you and who follows back."}]
    }
"""

import json
import sys
import tempfile
import urllib.request
from dataclasses import dataclass
from pathlib import Path

import imageio_ffmpeg
from PIL import Image, ImageDraw, ImageFont

WIDTH, HEIGHT, FPS = 1280, 720, 30
INTRO_SECONDS, ITEM_SECONDS, OUTRO_SECONDS = 2.6, 3.4, 2.4
MAX_ITEMS = 6

# Masumi Family brand: white page, Neutral 950 text, Iris Flower as the one fill.
PAGE = (255, 255, 255)
INK = (10, 10, 10)
MUTED = (115, 115, 115)
HAIRLINE = (229, 229, 229)
IRIS = (255, 81, 255)

FONT_URL = "https://github.com/google/fonts/raw/main/ofl/inter/Inter%5Bopsz,wght%5D.ttf"
FONT_PATH = Path(tempfile.gettempdir()) / "sokosumi-weekly-video-Inter.ttf"


def font(size: int, weight: int) -> ImageFont.FreeTypeFont:
    if not FONT_PATH.exists():
        urllib.request.urlretrieve(FONT_URL, FONT_PATH)
    face = ImageFont.truetype(str(FONT_PATH), size)
    face.set_variation_by_axes([min(max(size, 14), 32), weight])
    return face


def ease_out(t: float) -> float:
    t = min(max(t, 0.0), 1.0)
    return 1 - (1 - t) ** 3


def wrap(draw: ImageDraw.ImageDraw, text: str, face, width: int) -> list[str]:
    lines: list[str] = []
    for word in text.split():
        candidate = f"{lines[-1]} {word}" if lines else word
        if lines and draw.textlength(candidate, font=face) <= width:
            lines[-1] = candidate
        else:
            lines.append(word)
    return lines


@dataclass
class Brief:
    week: str
    items: list[dict]


def load_brief(path: str) -> Brief:
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    items = [
        {"title": str(item["title"]).strip(), "summary": str(item.get("summary", "")).strip()}
        for item in data["items"]
        if str(item.get("title", "")).strip()
    ][:MAX_ITEMS]
    if not items:
        raise SystemExit("brief.json needs at least one item with a title")
    return Brief(week=str(data.get("week", "")).strip(), items=items)


def chrome(draw: ImageDraw.ImageDraw, progress: float) -> None:
    draw.text((80, 56), "sokosumi", font=font(26, 700), fill=INK)
    draw.rectangle((80, HEIGHT - 64, WIDTH - 80, HEIGHT - 62), fill=HAIRLINE)
    draw.rectangle((80, HEIGHT - 64, 80 + (WIDTH - 160) * progress, HEIGHT - 62), fill=INK)


def pill(draw: ImageDraw.ImageDraw, x: float, y: float, text: str) -> None:
    face = font(22, 600)
    width = draw.textlength(text, font=face) + 36
    draw.rounded_rectangle((x, y, x + width, y + 44), radius=22, fill=IRIS)
    draw.text((x + 18, y + 9), text, font=face, fill=INK)


def rise(draw, x, y, lines, face, color, t, gap) -> float:
    """Draws lines that rise 24px into place while fading in from the page."""
    shift = 24 * (1 - ease_out(t))
    alpha = ease_out(t)
    tone = tuple(int(page + (ink - page) * alpha) for page, ink in zip(PAGE, color))
    for line in lines:
        draw.text((x, y + shift), line, font=face, fill=tone)
        y += gap
    return y


def intro_frame(brief: Brief, t: float, total: float) -> Image.Image:
    image = Image.new("RGB", (WIDTH, HEIGHT), PAGE)
    draw = ImageDraw.Draw(image)
    chrome(draw, t / total)
    pill(draw, 80 + 40 * (1 - ease_out(t / 0.6)), 220, "This week")
    rise(draw, 80, 300, ["What's new in Sokosumi"], font(76, 700), INK, (t - 0.2) / 0.8, 90)
    if brief.week:
        rise(draw, 84, 410, [brief.week], font(34, 400), MUTED, (t - 0.5) / 0.8, 44)
    return image


def item_frame(brief: Brief, index: int, t: float, elapsed: float, total: float) -> Image.Image:
    image = Image.new("RGB", (WIDTH, HEIGHT), PAGE)
    draw = ImageDraw.Draw(image)
    chrome(draw, elapsed / total)
    item = brief.items[index]
    pill(draw, 80, 190, f"{index + 1:02d} / {len(brief.items):02d}")
    title_face = font(60, 700)
    title = wrap(draw, item["title"], title_face, WIDTH - 200)[:3]
    y = rise(draw, 80, 270, title, title_face, INK, t / 0.7, 72)
    if item["summary"]:
        summary_face = font(30, 400)
        summary = wrap(draw, item["summary"], summary_face, WIDTH - 260)[:3]
        rise(draw, 82, y + 24, summary, summary_face, MUTED, (t - 0.25) / 0.7, 42)
    return image


def outro_frame(t: float, elapsed: float, total: float) -> Image.Image:
    image = Image.new("RGB", (WIDTH, HEIGHT), PAGE)
    draw = ImageDraw.Draw(image)
    chrome(draw, elapsed / total)
    rise(draw, 80, 270, ["Try it in Sokosumi"], font(76, 700), INK, t / 0.7, 90)
    rise(draw, 84, 380, ["app.sokosumi.com"], font(34, 400), MUTED, (t - 0.3) / 0.7, 44)
    return image


def frames(brief: Brief):
    total = INTRO_SECONDS + ITEM_SECONDS * len(brief.items) + OUTRO_SECONDS
    for frame in range(round(INTRO_SECONDS * FPS)):
        yield intro_frame(brief, frame / FPS, total)
    for index in range(len(brief.items)):
        start = INTRO_SECONDS + ITEM_SECONDS * index
        for frame in range(round(ITEM_SECONDS * FPS)):
            yield item_frame(brief, index, frame / FPS, start + frame / FPS, total)
    start = total - OUTRO_SECONDS
    for frame in range(round(OUTRO_SECONDS * FPS)):
        yield outro_frame(frame / FPS, start + frame / FPS, total)


def render(brief: Brief, out: Path) -> None:
    out.parent.mkdir(parents=True, exist_ok=True)
    writer = imageio_ffmpeg.write_frames(
        str(out),
        (WIDTH, HEIGHT),
        fps=FPS,
        codec="libx264",
        pix_fmt_out="yuv420p",
        output_params=["-crf", "20", "-movflags", "+faststart"],
    )
    writer.send(None)
    for image in frames(brief):
        writer.send(image.tobytes())
    writer.close()


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("usage: python render.py brief.json out/weekly.mp4")
    render(load_brief(sys.argv[1]), Path(sys.argv[2]))
    print(sys.argv[2])
