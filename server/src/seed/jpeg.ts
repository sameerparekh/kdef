/** Reads width/height from a JPEG's start-of-frame header. Throws if the bytes are not a JPEG. */
export function jpegSize(buf: Buffer): { width: number; height: number } {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) {
    throw new Error('not a JPEG (missing SOI marker)');
  }
  let i = 2;
  while (i + 4 <= buf.length) {
    if (buf[i] !== 0xff) throw new Error(`corrupt JPEG (expected marker at byte ${i})`);
    const marker = buf[i + 1]!;
    if (marker === 0xff) {
      i += 1; // fill byte
      continue;
    }
    // Standalone markers carry no length: TEM, RSTn, SOI, EOI.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
      i += 2;
      continue;
    }
    const length = buf.readUInt16BE(i + 2);
    // SOF0..SOF15 except DHT (C4), JPG (C8) and DAC (CC).
    const isSof = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
    if (isSof) {
      if (i + 9 > buf.length) break;
      return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    }
    i += 2 + length;
  }
  throw new Error('corrupt JPEG (no start-of-frame header found)');
}
