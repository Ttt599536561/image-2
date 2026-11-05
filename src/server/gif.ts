/** Inspect GIF framing without decoding pixels or rewriting the animation bytes. */
export function readGifMetadata(bytes: Uint8Array): { width: number; height: number; frames: number } | undefined {
  if (bytes.length < 14) return undefined;
  const header = String.fromCharCode(...bytes.subarray(0, 6));
  if (header !== "GIF87a" && header !== "GIF89a") return undefined;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint16(6, true), height = view.getUint16(8, true);
  if (!width || !height) return undefined;
  let offset = 13;
  const skipPalette = (packed: number) => {
    if (packed & 0x80) offset += 3 * (1 << ((packed & 7) + 1));
    return offset <= bytes.length;
  };
  const skipSubBlocks = () => {
    while (offset < bytes.length) {
      const size = bytes[offset++];
      if (!size) return true;
      offset += size;
      if (offset > bytes.length) return false;
    }
    return false;
  };
  if (!skipPalette(bytes[10])) return undefined;
  let frames = 0;
  while (offset < bytes.length) {
    const marker = bytes[offset++];
    if (marker === 0x3b) return frames > 0 && offset === bytes.length ? { width, height, frames } : undefined;
    if (marker === 0x21) {
      // Extensions consist of a label followed by zero-terminated data sub-blocks.
      if (offset >= bytes.length) return undefined;
      offset++;
      if (!skipSubBlocks()) return undefined;
    } else if (marker === 0x2c) {
      if (offset + 9 > bytes.length) return undefined;
      const left = view.getUint16(offset, true), top = view.getUint16(offset + 2, true);
      const frameWidth = view.getUint16(offset + 4, true), frameHeight = view.getUint16(offset + 6, true);
      const packed = bytes[offset + 8];
      if (!(bytes[10] & 0x80) && !(packed & 0x80)) return undefined;
      if (!frameWidth || !frameHeight || left + frameWidth > width || top + frameHeight > height) return undefined;
      offset += 9;
      if (!skipPalette(packed) || offset >= bytes.length) return undefined;
      const minimumCodeSize = bytes[offset++];
      if (minimumCodeSize < 2 || minimumCodeSize > 8 || !bytes[offset] || !skipSubBlocks()) return undefined;
      frames++;
    } else return undefined;
  }
  return undefined;
}
