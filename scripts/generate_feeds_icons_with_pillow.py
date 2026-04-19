from __future__ import annotations

import argparse
from io import BytesIO
import struct
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any, cast

import cairosvg # type: ignore[import]
from PIL import Image, ImageChops, ImageStat # type: ignore[import]


@dataclass
class DiffResult:
    label: str
    max_channel_diff: int
    mean_abs_diff: float

    @property
    def is_exact(self) -> bool:
        return self.max_channel_diff == 0


def _render_svg_with_cairosvg(svg_path: Path, size: int, output_path: Path) -> None:
    cairosvg.svg2png(
        url=str(svg_path),
        write_to=str(output_path),
        output_width=size,
        output_height=size,
    )


def _load_rgba(path: Path) -> Image.Image:
    with Image.open(path) as image:
        return image.convert("RGBA")


def _compare_images(label: str, actual: Image.Image, reference: Image.Image) -> DiffResult:
    if actual.size != reference.size:
        raise ValueError(f"{label}: size mismatch {actual.size} vs {reference.size}")

    difference = ImageChops.difference(actual, reference)
    extrema = cast(tuple[tuple[int, int], ...], difference.getextrema())
    max_diff = max(channel_max for _, channel_max in extrema)
    stats = ImageStat.Stat(difference)
    mean_abs_diff = float(sum(stats.mean) / len(stats.mean))

    return DiffResult(
        label=label,
        max_channel_diff=max_diff,
        mean_abs_diff=mean_abs_diff,
    )


def _build_png_icons(svg_path: Path, output_dir: Path) -> dict[str, Path]:
    output_dir.mkdir(parents=True, exist_ok=True)

    png_targets = {
        "favicon-48x48": (48, output_dir / "favicon-48x48.png"),
        "android-144": (144, output_dir / "android-chrome-144x144.png"),
        "android-192": (192, output_dir / "android-chrome-192x192.png"),
        "android-512": (512, output_dir / "android-chrome-512x512.png"),
        "android-maskable-512": (512, output_dir / "android-chrome-maskable-512x512.png"),
    }

    with tempfile.TemporaryDirectory() as temp_dir_raw:
        temp_dir = Path(temp_dir_raw)
        for _, (size, target_path) in png_targets.items():
            temp_reference = temp_dir / f"reference-{size}.png"
            _render_svg_with_cairosvg(svg_path, size, temp_reference)
            reference_image = _load_rgba(temp_reference)
            reference_image.save(target_path, format="PNG", optimize=True)

    return {name: path for name, (_, path) in png_targets.items()}


def _build_ico_icon(svg_path: Path, favicon_ico_path: Path) -> None:
    """Build a multi-size ICO using exact SVG renders for each frame size."""

    frame_sizes = [16, 32, 48]
    frame_payloads: list[tuple[int, bytes]] = []

    with tempfile.TemporaryDirectory() as temp_dir_raw:
        temp_dir = Path(temp_dir_raw)
        for size in frame_sizes:
            temp_reference = temp_dir / f"ico-reference-{size}.png"
            _render_svg_with_cairosvg(svg_path, size, temp_reference)
            image = _load_rgba(temp_reference)

            png_buffer = BytesIO()
            image.save(png_buffer, format="PNG", optimize=True)
            frame_payloads.append((size, png_buffer.getvalue()))

    icon_count = len(frame_payloads)
    directory_size = 6 + (16 * icon_count)
    current_offset = directory_size

    header = struct.pack("<HHH", 0, 1, icon_count)
    directory_entries = bytearray()
    image_data = bytearray()

    for size, payload in frame_payloads:
        width_byte = 0 if size == 256 else size
        height_byte = 0 if size == 256 else size
        entry = struct.pack(
            "<BBBBHHII",
            width_byte,
            height_byte,
            0,
            0,
            1,
            32,
            len(payload),
            current_offset,
        )
        directory_entries.extend(entry)
        image_data.extend(payload)
        current_offset += len(payload)

    favicon_ico_path.write_bytes(header + directory_entries + image_data)


def _verify_png_icons(svg_path: Path, png_icons: dict[str, Path]) -> list[DiffResult]:
    results: list[DiffResult] = []

    size_map = {
        "favicon-48x48": 48,
        "android-144": 144,
        "android-192": 192,
        "android-512": 512,
        "android-maskable-512": 512,
    }

    with tempfile.TemporaryDirectory() as temp_dir_raw:
        temp_dir = Path(temp_dir_raw)
        for label, path in png_icons.items():
            size = size_map[label]
            temp_reference = temp_dir / f"verify-reference-{label}-{size}.png"
            _render_svg_with_cairosvg(svg_path, size, temp_reference)

            actual = _load_rgba(path)
            reference = _load_rgba(temp_reference)
            results.append(_compare_images(label, actual, reference))

    return results


def _verify_ico_icon(svg_path: Path, favicon_ico_path: Path) -> list[DiffResult]:
    results: list[DiffResult] = []

    with tempfile.TemporaryDirectory() as temp_dir_raw:
        temp_dir = Path(temp_dir_raw)
        with Image.open(favicon_ico_path) as favicon_ico:
            ico_reader = getattr(cast(Any, favicon_ico), "ico", None)
            if ico_reader is None:
                raise RuntimeError("Pillow ICO parser is unavailable for favicon verification")

            ico_sizes = sorted(size[0] for size in ico_reader.sizes())
            for frame_size in ico_sizes:
                frame_image = ico_reader.getimage((frame_size, frame_size)).convert("RGBA")

                temp_reference = temp_dir / f"verify-reference-ico-{frame_size}.png"
                _render_svg_with_cairosvg(svg_path, frame_size, temp_reference)
                reference = _load_rgba(temp_reference)

                label = f"favicon-ico-{frame_size}x{frame_size}"
                results.append(_compare_images(label, frame_image, reference))

    return results


def _print_results(results: list[DiffResult]) -> None:
    print("Verification results:")
    for result in results:
        status = "OK" if result.max_channel_diff <= 2 else "DIFF"
        print(
            f"  {status:4} {result.label:24} "
            f"max_diff={result.max_channel_diff:3d} mean_abs={result.mean_abs_diff:.4f}"
        )


def main() -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Regenerate feeds favicon/png assets using Pillow outputs and verify against "
            "the source SVG rasterized via CairoSVG."
        )
    )
    parser.add_argument(
        "--svg",
        type=Path,
        default=Path("website/static/icons/feeds-favicon.svg"),
        help="Path to source SVG icon",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path("website/static/icons/feeds"),
        help="Directory for generated icon files",
    )
    args = parser.parse_args()

    svg_path = args.svg.resolve()
    output_dir = args.output_dir.resolve()

    if not svg_path.exists():
        raise FileNotFoundError(f"SVG file not found: {svg_path}")

    png_icons = _build_png_icons(svg_path, output_dir)
    favicon_ico_path = output_dir / "favicon-48x48.ico"
    _build_ico_icon(svg_path, favicon_ico_path)

    png_results = _verify_png_icons(svg_path, png_icons)
    ico_results = _verify_ico_icon(svg_path, favicon_ico_path)
    all_results = png_results + ico_results

    _print_results(all_results)

    max_diff = max(result.max_channel_diff for result in all_results)
    if max_diff > 2:
        print("\nOne or more icons differ significantly from the source SVG render.")
        return 1

    print("\nAll generated icons are within tolerance of the source SVG render.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
