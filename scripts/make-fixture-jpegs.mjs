// Dev-only: regenerate the synthetic 8x10 JPEG fixtures under server/test/fixtures/kdef/.
// Each file is a distinct solid colour so sha256 differs. Needs macOS `sips` for JPEG encoding.
// Usage: node scripts/make-fixture-jpegs.mjs
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Same names as EMOTIONS in shared/src/emotions.ts.
const EMOTIONS = ['angry', 'disgust', 'fear', 'happy', 'neutral', 'sad', 'surprise'];
const SUBJECTS = [0, 1];
const NS = [3, 7, 11];
const W = 8;
const H = 10;
const out = path.resolve('server/test/fixtures/kdef');
const tmp = mkdtempSync(path.join(tmpdir(), 'kdef-fixture-'));

function bmp(r, g, b) {
  const rowSize = Math.ceil((W * 3) / 4) * 4;
  const buf = Buffer.alloc(54 + rowSize * H);
  buf.write('BM', 0);
  buf.writeUInt32LE(buf.length, 2);
  buf.writeUInt32LE(54, 10);
  buf.writeUInt32LE(40, 14);
  buf.writeInt32LE(W, 18);
  buf.writeInt32LE(H, 22);
  buf.writeUInt16LE(1, 26);
  buf.writeUInt16LE(24, 28);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) buf.set([b, g, r], 54 + y * rowSize + x * 3);
  return buf;
}

let i = 0;
for (const emotion of EMOTIONS) {
  mkdirSync(path.join(out, emotion), { recursive: true });
  for (const s of SUBJECTS) {
    for (const n of NS) {
      i++;
      const src = path.join(tmp, 'x.bmp');
      writeFileSync(src, bmp((i * 37) % 256, (i * 91) % 256, (i * 151) % 256));
      const dest = path.join(out, emotion, `${s}_${n}.jpg`);
      execFileSync('sips', ['-s', 'format', 'jpeg', src, '--out', dest], { stdio: 'ignore' });
    }
  }
}
rmSync(tmp, { recursive: true });
