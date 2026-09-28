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
  frontal     the photo with the smallest |yaw|
  half_left   the face is turned toward the IMAGE's left (the nose points at the left edge)
  half_right  the face is turned toward the IMAGE's right
  unknown     anything we cannot label confidently: a group with fewer than 2 or more than 3
              photos, 2+ failed face detections, a "turned" photo that is not clearly turned (|yaw| < MIN_TURN), or two turned
              photos whose yaw has the same sign.
  Tolerated: a group of 2 photos is labelled from what is there; if exactly one photo of
  three fails detection and the other two are one frontal and one turned, the failed photo
  gets the opposite side (KDEF has one photo per side).

Output: seed/angles.csv with header `emotion,filename,angle`, sorted. Metadata only; no
image is copied anywhere.

Usage: classify-angles.py <kdef_dir> <out_csv> [--yaw-json <path>]
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

import cv2
import mediapipe as mp

EMOTIONS = ["angry", "disgust", "fear", "happy", "neutral", "sad", "surprise"]
FILE_RE = re.compile(r"^(\d+)_(\d+)\.jpg$")

NOSE_TIP = 1
CHEEK_IMAGE_LEFT = 234
CHEEK_IMAGE_RIGHT = 454
# A non-frontal photo must be turned at least this far (in yaw units) to get a side label.
MIN_TURN = 0.12


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
