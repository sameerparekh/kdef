#!/usr/bin/env python3
"""Dev-only: label the camera angle of every KDEF photo and write seed/angles.csv.

Run it through scripts/classify-angles.sh (Docker), not on the host.

Method
------
KDEF has, for each (subject, emotion), exactly three photos taken from three camera angles:
the head turned toward one side, frontal, and turned toward the other side. The filename's
second number does not encode the angle, so we estimate head yaw from MediaPipe FaceMesh
landmarks: the nose tip (1) is compared with the two cheek-contour points (234 = the cheek
at the image's left, 454 = the cheek at the image's right):

    yaw = (d_left - d_right) / (d_left + d_right)
    d_left  = nose_x - cheek_left_x
    d_right = cheek_right_x - nose_x

yaw is 0 for a frontal face, positive when the nose sits toward the image's right edge and
negative when it sits toward the image's left edge.

Labels (per (subject, emotion) group of exactly three photos)
------------------------------------------------------------
  frontal     the photo with the smallest |yaw|, provided |yaw| < MAX_FRONTAL
  half_left   the face is turned toward the IMAGE's left (the nose points at the left edge)
  half_right  the face is turned toward the IMAGE's right
  unknown     anything we cannot label confidently: a group with fewer than 2 or more than 3
              photos, 2+ failed face detections, no clearly frontal photo (smallest
              |yaw| >= MAX_FRONTAL), a "turned" photo that is not clearly turned
              (|yaw| < MIN_TURN), or two turned photos whose yaw has the same sign.
  Tolerated: a group of 2 photos is labelled from what is there; if exactly one photo of
  three fails detection and the other two are one frontal and one turned, the failed photo
  gets the opposite side (KDEF has one photo per side).

Output: seed/angles.csv with header `emotion,filename,angle`, sorted. Metadata only; no
image is copied anywhere.

Optional review aids (never committed, they reference KDEF images):
  --contact-sheet [path]  write an HTML page with every group's photos and labels, for
                          spot-checking. Without a value it goes to
                          <system temp dir>/angles-contact-sheet.html.
  --image-base-url <url>  where the sheet loads images from; default file://<kdef_dir>.
                          Under Docker the dataset is mounted at /data/kdef, so pass the
                          host path (e.g. file:///Volumes/brenn/KDEF) and mount a writable
                          directory for the sheet.
  --yaw-json <path>       dump raw per-photo yaw estimates (debugging).

Usage: classify-angles.py <kdef_dir> <out_csv> [--contact-sheet [path]]
       [--image-base-url url] [--yaw-json path]
"""

from __future__ import annotations

import argparse
import html
import tempfile
import csv
import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

import cv2
import mediapipe as mp

# Same names as EMOTIONS in shared/src/emotions.ts (the KDEF folder names); the server
# validates this script's output against that list when it reads seed/angles.csv.
EMOTIONS = ["angry", "disgust", "fear", "happy", "neutral", "sad", "surprise"]
FILE_RE = re.compile(r"^(\d+)_(\d+)\.jpg$")

NOSE_TIP = 1
CHEEK_IMAGE_LEFT = 234
CHEEK_IMAGE_RIGHT = 454
# Yaw units are (d_left - d_right) / (d_left + d_right): 0 is frontal, about +-1 is a half
# profile. On the full KDEF set the photos chosen as frontal all have |yaw| < 0.28 and every
# turned photo has |yaw| > 0.69, so both thresholds sit in the empty gap between them.
# The photo with the smallest |yaw| in a group is only called frontal below this.
MAX_FRONTAL = 0.4
# A photo must be turned at least this far to get a half_left / half_right label.
MIN_TURN = 0.4


DEFAULT_SHEET = Path(tempfile.gettempdir()) / "angles-contact-sheet.html"
SHEET_ORDER = ["half_left", "frontal", "half_right", "unknown"]


def write_contact_sheet(path: Path, rows: list[tuple[str, str, str]], base_url: str) -> None:
    """One box per (emotion, subject); photos left to right as half_left, frontal, half_right."""
    groups: dict[tuple[str, int], list[tuple[str, str]]] = defaultdict(list)
    for emotion, filename, angle in rows:
        groups[(emotion, int(filename.split("_")[0]))].append((filename, angle))
    parts = [
        "<!doctype html><meta charset=utf-8><title>KDEF angle labels</title>"
        "<style>body{font:12px sans-serif}.g{display:inline-block;margin:6px;padding:4px;"
        "border:1px solid #ccc}.g img{height:160px}.c{display:inline-block;text-align:center}"
        "</style><h1>half_left = face turned toward the image's left</h1>"
    ]
    for (emotion, subject), items in sorted(groups.items()):
        parts.append(f"<div class=g><div>{emotion} subject {subject}</div>")
        for filename, angle in sorted(items, key=lambda x: SHEET_ORDER.index(x[1])):
            src = html.escape(f"{base_url.rstrip('/')}/{emotion}/{filename}")
            parts.append(
                f'<div class=c><img loading=lazy src="{src}"><br>{html.escape(angle)}'
                f"<br>{html.escape(filename)}</div>"
            )
        parts.append("</div>")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(parts))


def estimate_yaw(face_mesh, path: Path) -> float | None:
    img = cv2.imread(str(path))
    if img is None:
        return None
    result = face_mesh.process(cv2.cvtColor(img, cv2.COLOR_BGR2RGB))
    if not result.multi_face_landmarks:
        return None
    lm = result.multi_face_landmarks[0].landmark
    nose, left, right = lm[NOSE_TIP].x, lm[CHEEK_IMAGE_LEFT].x, lm[CHEEK_IMAGE_RIGHT].x
    d_left, d_right = nose - left, right - nose
    if d_left + d_right <= 1e-6:
        return None
    return (d_left - d_right) / (d_left + d_right)


def label_group(yaws: dict[str, float | None]) -> dict[str, str]:
    """yaws: filename -> yaw or None. Returns filename -> angle label."""
    labels = {f: "unknown" for f in yaws}
    detected = {f: y for f, y in yaws.items() if y is not None}
    failed = [f for f, y in yaws.items() if y is None]
    # A KDEF group has 3 photos (2 when a photo is missing from the dataset). One failed
    # detection is tolerated; more than that leaves too little to go on.
    if len(yaws) not in (2, 3) or len(failed) > 1 or len(detected) < 2:
        return labels
    ordered = sorted(detected, key=lambda f: abs(detected[f]))
    frontal, sides = ordered[0], ordered[1:]
    if abs(detected[frontal]) >= MAX_FRONTAL:  # no photo is clearly frontal
        return labels
    if any(abs(detected[f]) < MIN_TURN for f in sides):  # a "turned" photo that is not
        return labels
    if len({detected[f] > 0 for f in sides}) != len(sides):
        return labels  # two photos turned the same way: cannot tell which side is which
    labels[frontal] = "frontal"
    for f in sides:
        labels[f] = "half_right" if detected[f] > 0 else "half_left"
    if failed and len(sides) == 1:
        # Frontal + one side found: the undetected photo is the other side (one of each).
        labels[failed[0]] = "half_left" if detected[sides[0]] > 0 else "half_right"
    return labels


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("kdef_dir", type=Path)
    ap.add_argument("out_csv", type=Path)
    ap.add_argument("--contact-sheet", type=Path, nargs="?", const=DEFAULT_SHEET, default=None)
    ap.add_argument("--image-base-url", help="base URL for images in the contact sheet")
    ap.add_argument("--yaw-json", type=Path, help="also dump raw yaw per file (debugging)")
    args = ap.parse_args()

    face_mesh = mp.solutions.face_mesh.FaceMesh(static_image_mode=True, max_num_faces=1)
    groups: dict[tuple[str, int], dict[str, float | None]] = defaultdict(dict)
    for emotion in EMOTIONS:
        folder = args.kdef_dir / emotion
        if not folder.is_dir():
            print(f"missing emotion folder: {folder}", file=sys.stderr)
            return 1
        for p in sorted(folder.iterdir()):
            if p.name.startswith("."):
                continue
            m = FILE_RE.match(p.name)
            if not m:
                print(f"unexpected file name: {p}", file=sys.stderr)
                return 1
            groups[(emotion, int(m.group(1)))][p.name] = estimate_yaw(face_mesh, p)

    rows: list[tuple[str, str, str]] = []
    bad_groups = 0
    for (emotion, _subject), yaws in groups.items():
        labels = label_group(yaws)
        if "unknown" in labels.values():
            bad_groups += 1
        rows += [(emotion, f, lab) for f, lab in labels.items()]
    rows.sort()

    args.out_csv.parent.mkdir(parents=True, exist_ok=True)
    with args.out_csv.open("w", newline="") as fh:
        w = csv.writer(fh, lineterminator="\n")
        w.writerow(["emotion", "filename", "angle"])
        w.writerows(rows)

    if args.contact_sheet:
        base = args.image_base_url or args.kdef_dir.resolve().as_uri()
        write_contact_sheet(args.contact_sheet, rows, base)
        print(f"contact sheet: {args.contact_sheet}")

    if args.yaw_json:
        dump = {f"{e}/{f}": y for (e, _s), ys in groups.items() for f, y in ys.items()}
        args.yaw_json.write_text(json.dumps(dump, indent=0, sort_keys=True))

    by_angle = Counter(r[2] for r in rows)
    print(f"photos: {len(rows)}  groups: {len(groups)}  groups with any unknown: {bad_groups}")
    for angle, n in sorted(by_angle.items()):
        print(f"  {angle:11s} {n}")
    for emotion in EMOTIONS:
        c = Counter(r[2] for r in rows if r[0] == emotion)
        print(f"  {emotion:9s} {dict(sorted(c.items()))}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
