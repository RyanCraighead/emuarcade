#!/usr/bin/env python3
"""Generate the original, locally bundled EmuArcade splash montage."""

from __future__ import annotations

import argparse
import math
import shutil
import subprocess
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


FPS = 20
SCENE_SECONDS = 3
SCENE_FRAMES = FPS * SCENE_SECONDS
SCENE_COUNT = 4
FRAME_SIZE = (320, 180)
OUTPUT_SIZE = (640, 360)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path(__file__).resolve().parents[1] / "public",
    )
    parser.add_argument("--ffmpeg", default=shutil.which("ffmpeg"))
    return parser.parse_args()


def pixel_text(
    draw: ImageDraw.ImageDraw,
    position: tuple[int, int],
    text: str,
    fill: str = "#f7f3ea",
) -> None:
    draw.text(position, text, fill=fill, font=ImageFont.load_default())


def draw_space(frame: int) -> Image.Image:
    image = Image.new("RGB", FRAME_SIZE, "#07111f")
    draw = ImageDraw.Draw(image)

    for index in range(58):
        x = (index * 83 + index * index * 7) % FRAME_SIZE[0]
        y = (index * 47 + frame * (1 + index % 3)) % FRAME_SIZE[1]
        color = ("#d9f4ff", "#60a5fa", "#fbbf24")[index % 3]
        draw.rectangle((x, y, x + (index % 4 == 0), y + (index % 4 == 0)), fill=color)

    draw.rectangle((8, 8, 88, 18), fill="#101f34")
    draw.rectangle((11, 11, 66, 15), fill="#34d399")
    pixel_text(draw, (11, 23), "STAR RUNNER  8-BIT", "#8dc7ff")
    pixel_text(draw, (259, 8), f"{1280 + frame * 20:05d}", "#fbbf24")

    for enemy in range(5):
        phase = frame * 0.08 + enemy * 1.17
        x = 160 + int(math.sin(phase) * (84 - enemy * 7))
        y = 30 + enemy * 15 + int(math.cos(phase * 1.3) * 4)
        draw.polygon(
            [(x, y + 5), (x + 6, y), (x + 11, y + 5), (x + 8, y + 10), (x + 3, y + 10)],
            fill="#ff5a1f" if enemy % 2 == 0 else "#a78bfa",
        )
        draw.rectangle((x + 4, y + 4, x + 7, y + 7), fill="#f7f3ea")

    ship_x = 160 + int(math.sin(frame * 0.12) * 42)
    ship_y = 142 + int(math.sin(frame * 0.22) * 3)
    draw.polygon(
        [(ship_x, ship_y - 13), (ship_x - 10, ship_y + 10), (ship_x, ship_y + 6), (ship_x + 10, ship_y + 10)],
        fill="#dbeafe",
    )
    draw.polygon(
        [(ship_x, ship_y - 8), (ship_x - 4, ship_y + 6), (ship_x + 4, ship_y + 6)],
        fill="#60a5fa",
    )
    draw.rectangle((ship_x - 2, ship_y + 8, ship_x + 2, ship_y + 13), fill="#fbbf24")

    for laser in range(3):
        laser_y = ship_y - 22 - ((frame * 7 + laser * 43) % 108)
        draw.rectangle((ship_x - 1, laser_y, ship_x + 1, laser_y + 8), fill="#34d399")

    if 40 <= frame < 54:
        radius = 2 + (frame - 40) // 2
        draw.ellipse((212 - radius, 64 - radius, 212 + radius, 64 + radius), fill="#fbbf24")
        draw.rectangle((210 - radius, 62, 214 + radius, 66), fill="#ff5a1f")

    return image


def draw_platform(frame: int) -> Image.Image:
    image = Image.new("RGB", FRAME_SIZE, "#63b3d4")
    draw = ImageDraw.Draw(image)
    scroll = frame * 3

    draw.ellipse((238, 15, 264, 41), fill="#fbbf24")
    for index in range(6):
        x = ((index * 78 - scroll // 4) % 430) - 55
        height = 28 + (index % 3) * 9
        draw.polygon([(x, 117), (x + 35, 117 - height), (x + 72, 117)], fill="#398f83")
        draw.polygon([(x + 35, 117 - height), (x + 49, 117 - height // 2), (x + 72, 117)], fill="#277166")

    draw.rectangle((0, 116, 319, 179), fill="#4c9a52")
    draw.rectangle((0, 124, 319, 179), fill="#284b37")
    for index in range(22):
        x = (index * 19 - scroll) % 340 - 20
        draw.rectangle((x, 124, x + 17, 139), fill="#a96b3b")
        draw.line((x, 139, x + 17, 139), fill="#5c3828")
        draw.line((x + 8, 124, x + 8, 139), fill="#6e452f")

    for index in range(4):
        x = (220 + index * 72 - scroll) % 390 - 35
        y = 85 - (index % 2) * 18
        draw.rectangle((x, y, x + 20, y + 14), fill="#d8893a")
        draw.rectangle((x + 2, y + 2, x + 18, y + 12), outline="#f4c35d")

    hero_x = 106
    jump = max(0.0, math.sin((frame - 18) * math.pi / 34)) if 18 <= frame <= 52 else 0.0
    hero_y = 113 - int(jump * 35)
    leg = 2 if (frame // 4) % 2 else -2
    draw.rectangle((hero_x - 5, hero_y - 17, hero_x + 5, hero_y - 9), fill="#f6c58c")
    draw.rectangle((hero_x - 7, hero_y - 9, hero_x + 7, hero_y + 2), fill="#ff5a1f")
    draw.rectangle((hero_x - 6, hero_y + 2, hero_x - 1 + leg, hero_y + 10), fill="#243b64")
    draw.rectangle((hero_x + 1 - leg, hero_y + 2, hero_x + 6, hero_y + 10), fill="#243b64")
    draw.rectangle((hero_x - 7, hero_y - 19, hero_x + 4, hero_y - 16), fill="#fbbf24")

    coin_x = 172
    coin_y = 85
    coin_width = 2 + abs((frame // 3) % 8 - 4)
    draw.ellipse((coin_x - coin_width, coin_y - 6, coin_x + coin_width, coin_y + 6), fill="#ffe16b")
    pixel_text(draw, (8, 8), "COBALT KEEP  16-BIT")
    pixel_text(draw, (263, 8), "x 07", "#fff3a3")
    return image


def draw_racing(frame: int) -> Image.Image:
    image = Image.new("RGB", FRAME_SIZE, "#8ac6d1")
    draw = ImageDraw.Draw(image)
    draw.rectangle((0, 58, 319, 179), fill="#498554")
    bend = int(math.sin(frame * 0.08) * 26)
    road_top = 142 + bend
    road_bottom = 160 - bend
    draw.polygon([(road_top - 34, 58), (road_top + 34, 58), (road_bottom + 119, 179), (road_bottom - 119, 179)], fill="#4b4f56")
    draw.line((road_top - 36, 58, road_bottom - 121, 179), fill="#f7f3ea", width=3)
    draw.line((road_top + 36, 58, road_bottom + 121, 179), fill="#f7f3ea", width=3)

    for index in range(9):
        y = 62 + ((index * 22 + frame * 8) % 116)
        t = (y - 58) / 121
        center = int(road_top * (1 - t) + road_bottom * t)
        dash = max(1, int(1 + t * 5))
        draw.rectangle((center - dash, y, center + dash, min(179, y + 5 + dash)), fill="#fbbf24")

    for index in range(12):
        y = 60 + ((index * 31 + frame * 5) % 118)
        side = -1 if index % 2 == 0 else 1
        x = 160 + side * (58 + int((y - 58) * 0.7)) + bend
        size = max(2, int((y - 48) / 19))
        draw.rectangle((x - size, y - size * 2, x + size, y), fill="#173c28")
        draw.rectangle((x - size // 2, y - size * 3, x + size // 2, y - size), fill="#2f6d3c")

    rival_x = 156 + bend // 2
    rival_y = 83 + (frame * 2) % 28
    draw.rectangle((rival_x - 5, rival_y - 8, rival_x + 5, rival_y + 8), fill="#60a5fa")
    draw.rectangle((rival_x - 3, rival_y - 4, rival_x + 3, rival_y + 1), fill="#c8e3ff")

    player_x = 160 + int(math.sin(frame * 0.15) * 34)
    draw.polygon([(player_x - 12, 158), (player_x - 8, 137), (player_x + 8, 137), (player_x + 12, 158)], fill="#ff5a1f")
    draw.rectangle((player_x - 6, 141, player_x + 6, 148), fill="#1a2638")
    draw.rectangle((player_x - 11, 153, player_x - 7, 160), fill="#111")
    draw.rectangle((player_x + 7, 153, player_x + 11, 160), fill="#111")

    draw.rectangle((5, 5, 315, 24), fill="#172128")
    pixel_text(draw, (11, 10), "POCKET RALLY  32-BIT")
    pixel_text(draw, (222, 10), f"{92 + frame % 14:03d} KM/H", "#34d399")
    return image


def draw_poly(frame: int) -> Image.Image:
    image = Image.new("RGB", FRAME_SIZE, "#241c4b")
    draw = ImageDraw.Draw(image)
    draw.rectangle((0, 0, 319, 72), fill="#35245f")
    draw.ellipse((247, 18, 274, 45), fill="#f49b50")
    draw.polygon([(0, 76), (54, 38), (104, 76), (152, 48), (211, 76), (270, 41), (319, 76)], fill="#3b4668")
    draw.rectangle((0, 76, 319, 179), fill="#13182d")

    horizon = 78
    for index in range(1, 10):
        y = horizon + int((index / 9) ** 2 * 102)
        draw.line((0, y, 319, y), fill="#285c63")
    for x in range(-240, 561, 40):
        draw.line((160, horizon, x, 179), fill="#285c63")

    orbit = frame * 0.07
    crystal_x = 160 + int(math.sin(orbit) * 63)
    crystal_y = 105 + int(math.cos(orbit * 1.4) * 17)
    draw.polygon(
        [(crystal_x, crystal_y - 14), (crystal_x + 10, crystal_y), (crystal_x, crystal_y + 14), (crystal_x - 10, crystal_y)],
        fill="#34d399",
    )
    draw.polygon(
        [(crystal_x, crystal_y - 14), (crystal_x, crystal_y + 14), (crystal_x - 10, crystal_y)],
        fill="#147d64",
    )

    player_x = 160 + int(math.sin(frame * 0.12) * 38)
    player_y = 145 + int(math.cos(frame * 0.18) * 4)
    draw.polygon([(player_x, player_y - 20), (player_x - 17, player_y + 12), (player_x, player_y + 6), (player_x + 17, player_y + 12)], fill="#dfe9ff")
    draw.polygon([(player_x, player_y - 12), (player_x - 7, player_y + 6), (player_x + 7, player_y + 6)], fill="#60a5fa")
    draw.line((player_x - 8, player_y + 13, player_x - 3, player_y + 22), fill="#ff5a1f", width=3)
    draw.line((player_x + 8, player_y + 13, player_x + 3, player_y + 22), fill="#ff5a1f", width=3)

    for index in range(3):
        shot_y = player_y - 28 - ((frame * 5 + index * 36) % 82)
        draw.rectangle((player_x - 1, shot_y, player_x + 1, shot_y + 7), fill="#fbbf24")

    draw.rectangle((6, 6, 142, 26), fill="#15152c")
    pixel_text(draw, (11, 11), "POLY QUEST  64-BIT", "#d8d5ff")
    draw.rectangle((244, 10, 309, 15), fill="#17222f")
    draw.rectangle((246, 12, 292 - frame % 18, 13), fill="#ff5a1f")
    return image


SCENES = (draw_space, draw_platform, draw_racing, draw_poly)


def render_frame(index: int) -> Image.Image:
    scene_index = (index // SCENE_FRAMES) % SCENE_COUNT
    scene_frame = index % SCENE_FRAMES
    image = SCENES[scene_index](scene_frame)
    draw = ImageDraw.Draw(image, "RGBA")

    transition = min(scene_frame, SCENE_FRAMES - 1 - scene_frame)
    if transition < 5:
        draw.rectangle((0, 0, 319, 179), fill=(0, 0, 0, (5 - transition) * 34))

    for y in range(1, FRAME_SIZE[1], 3):
        draw.line((0, y, FRAME_SIZE[0], y), fill=(0, 0, 0, 24))

    return image.resize(OUTPUT_SIZE, Image.Resampling.NEAREST)


def main() -> None:
    args = parse_args()
    if not args.ffmpeg:
        raise SystemExit("ffmpeg is required to encode the splash montage")

    args.output_dir.mkdir(parents=True, exist_ok=True)
    video_path = args.output_dir / "splash-montage.mp4"
    poster_path = args.output_dir / "splash-montage-poster.webp"

    with tempfile.TemporaryDirectory(prefix="emuarcade-montage-") as temp_dir:
        frames_dir = Path(temp_dir)
        for index in range(SCENE_FRAMES * SCENE_COUNT):
            frame = render_frame(index)
            frame.save(frames_dir / f"{index:04d}.png", optimize=True)
            if index == 18:
                frame.save(poster_path, "WEBP", quality=84, method=6)

        subprocess.run(
            [
                args.ffmpeg,
                "-hide_banner",
                "-loglevel",
                "error",
                "-y",
                "-framerate",
                str(FPS),
                "-i",
                str(frames_dir / "%04d.png"),
                "-an",
                "-c:v",
                "libx264",
                "-preset",
                "slow",
                "-crf",
                "27",
                "-pix_fmt",
                "yuv420p",
                "-movflags",
                "+faststart",
                str(video_path),
            ],
            check=True,
        )

    print(f"Generated {video_path}")
    print(f"Generated {poster_path}")


if __name__ == "__main__":
    main()
