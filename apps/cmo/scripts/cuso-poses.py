"""Builds Cuso's drawings in public/cuso/ from the brand guide's 2D SVGs.

Run once when the brand guide's poses change (https://github.com/masumi-network/Masumi-Family-Brand-Guide):

    python3 apps/cmo/scripts/cuso-poses.py "<Masumi-Family-Brand-Guide>/Cuso 2D Mascot"

It writes two things:
- `poses.svg`, the sidebar's animated Cuso (`cuso-rig.ts`): one nested <svg> per pose, all scaled
  so the body is the same size and the feet stand on the same line. The walking pose is cut into
  parts the rig moves: its body and arms are masked out of the drawing, and its legs are tubes the
  rig draws, each ending in the drawing's own shoe. The friendly pose's waving hand is cut out the
  same way. The cuts depend on the order of the paths in those two files, so check the sidebar in
  a browser after re-running this on new art.
- `<pose>.svg`, each pose's `-ground-shadow` drawing, for the stills (avatars, onboarding).

Adapted from the CMO.XYZ landing page's `scripts/cuso-poses.py`.
"""

import logging
import re
import sys
from pathlib import Path

BODY = 0.7  # the body's height as a share of the pose box; the feet stand at 97% of it


def pose_svg(root: Path, name: str) -> str:
    return (root / "poses" / name / "svg" / f"cuso-{name}-default.svg").read_text()


def inner(svg: str, prefix: str) -> str:
    body = svg[svg.index(">") + 1 : svg.rindex("</svg>")]
    # A mask without a size covers 120% of the box it is drawn in; in the smaller pose box that cut
    # the idea pose's feet off. Pin each one to the drawing's own canvas.
    x, y, w, h = re.search(r'viewBox="([^"]+)"', svg).group(1).split()
    body = body.replace('maskUnits="userSpaceOnUse">', f'maskUnits="userSpaceOnUse" x="{x}" y="{y}" width="{w}" height="{h}">')
    body = re.sub(r'id="([^"]+)"', rf'id="{prefix}\1"', body)
    return re.sub(r"url\(#([^)]+)\)", rf"url(#{prefix}\1)", body)


def box(body_h: float, bottom: float, cx: float) -> str:
    v = body_h / BODY
    return f"{cx - v / 2:.0f} {bottom - 0.97 * v:.0f} {v:.0f} {v:.0f}"


def rounded(svg: str) -> str:
    # One decimal is far below a pixel at the hero's size and cuts the file by about a third.
    return re.sub(r"\d+\.\d+", lambda m: f"{float(m.group()):.1f}".rstrip("0").rstrip("."), svg)


def mask(id_: str, shapes: str, box_: str = 'x="-100" y="-100" width="1700" height="1700"') -> str:
    return f'<mask id="{id_}" maskUnits="userSpaceOnUse" {box_}>{shapes}</mask>'


def walking(root: Path) -> str:
    # One white silhouette path and one black compound path whose holes are the parts.
    white_d, black_d = re.findall(r' d="([^"]*)"', pose_svg(root, "walking"))
    subs = [s for s in re.split(r"(?=M)", black_d) if s.strip()]
    body = subs[3] + "".join(subs[i] for i in (8, 10, 11, 12, 13, 14, 15))  # body and face
    arm_l, arm_r, leg_r = subs[4], subs[5] + subs[6] + subs[7] + subs[9], subs[2]  # armR: arm and fist
    cut = '<use href="#cuso-w-body" fill="#000" stroke="#000" stroke-width="66" stroke-linejoin="round"/>'
    fill = lambda d, w: f'<path d="{d}" fill="#fff" stroke="#fff" stroke-width="{w}" stroke-linejoin="round"/>'
    defs = (
        f'<path id="cuso-w-body" d="{body}"/>'
        f'<g id="cuso-w-art"><path fill="#fff" fill-rule="evenodd" d="{white_d}"/><path fill="#000" fill-rule="evenodd" d="{black_d}"/></g>'
        + mask("cuso-w-m-body", '<use href="#cuso-w-body" fill="#fff" stroke="#fff" stroke-width="74" stroke-linejoin="round"/>')
        + mask("cuso-w-m-arml", fill(arm_l, 92) + cut)
        + mask("cuso-w-m-armr", fill(arm_r, 92) + '<rect x="1190" y="610" width="160" height="290" fill="#fff"/>' + cut)
        # The near leg's shoe, cut off below the ankle; both feet use it.
        + mask("cuso-w-m-shoe", fill(leg_r, 46) + '<path d="M760 1000 L905 1000 L928 1150 L918 1212 L790 1222Z" fill="#000"/>')
    )
    leg = (
        '<g data-leg="{n}"><path data-tube fill="none" stroke="#000" stroke-width="100" stroke-linecap="round"/>'
        '<path data-tube fill="none" stroke="#fff" stroke-width="56" stroke-linecap="round"/>'
        '<g data-shoe><use href="#cuso-w-art" mask="url(#cuso-w-m-shoe)"/></g></g>'
    )
    parts = (
        '<g data-part="armL"><use href="#cuso-w-art" mask="url(#cuso-w-m-arml)"/></g>'
        + leg.format(n="far") + leg.format(n="near")
        + '<g data-part="armR"><use href="#cuso-w-art" mask="url(#cuso-w-m-armr)"/></g>'
        '<g data-part="body"><use href="#cuso-w-art" mask="url(#cuso-w-m-body)"/></g>'
    )
    return f"<defs>{defs}</defs>{parts}"


def friendly(root: Path) -> str:
    art = inner(pose_svg(root, "friendly"), "cuso-f-")
    paths = re.findall(r'<path ([^>]*?)d="([^"]*)"', art)
    # The waving arm's hole (22), its middle fingertip (29) and the two motion lines (33, 34).
    hand = (paths[22][1], paths[29][1] + paths[33][1] + paths[34][1])
    shapes = lambda c, w: "".join(
        f'<path d="{d}" fill="{c}" stroke="{c}" stroke-width="{w}" stroke-linejoin="round"/>' for d in hand
    ) + f'<rect x="1440" y="600" width="480" height="420" fill="{c}"/>'
    whole = 'x="0" y="0" width="2016" height="2048"'
    defs = (
        f'<g id="cuso-f-art">{art}</g>'
        + mask("cuso-f-m-rest", '<rect width="2016" height="2048" fill="#fff"/>' + shapes("#000", 70), whole)
        + mask("cuso-f-m-arm", shapes("#fff", 92), whole)
    )
    return (
        f'<defs>{defs}</defs><use href="#cuso-f-art" mask="url(#cuso-f-m-rest)"/>'
        '<g data-part="wave"><use href="#cuso-f-art" mask="url(#cuso-f-m-arm)"/></g>'
    )


def main() -> None:
    root = Path(sys.argv[1])
    # (body height, feet bottom, feet centre) of each pose, in its own SVG units. The body runs
    # from the tip of the arrow to where the legs start.
    poses = {
        "walking": ((952, 1344, 725), walking(root)),
        "friendly": ((1364, 1942, 950), friendly(root)),
        "pointing": ((952, 1364, 597), inner(pose_svg(root, "pointing"), "cuso-p-")),
        "thinking": ((952, 1372, 602), inner(pose_svg(root, "thinking"), "cuso-t-")),
        "researching": ((952, 1390, 779), inner(pose_svg(root, "researching"), "cuso-r-")),
        # Correct stands a little left of centre, so his check mark stays inside the sidebar.
        "correct": ((1261, 1836, 1000), inner(pose_svg(root, "correct"), "cuso-c-")),
    }
    nested = "".join(
        f'<svg data-pose="{k}" width="100" height="100" viewBox="{box(*m)}" overflow="visible" visibility="hidden">{body}</svg>'
        for k, (m, body) in poses.items()
    )
    out = Path(__file__).resolve().parent.parent / "public/cuso"
    (out / "poses.svg").write_text(rounded(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">{nested}</svg>\n'))
    for name in poses:
        still = (root / "poses" / name / "svg" / f"cuso-{name}-ground-shadow.svg").read_text()
        (out / f"{name}.svg").write_text(rounded(still))
    for file in sorted(out.glob("*.svg")):
        logging.info("wrote %s (%d KB)", file, file.stat().st_size // 1024)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    main()
