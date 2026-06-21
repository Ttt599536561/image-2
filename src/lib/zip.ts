// 极简 store-mode ZIP 打包（不压缩；PNG/JPEG 已压缩，store 足够）。浏览器端用，零依赖。
// 资产库「打包下载」(§24.9) + 本次面板「下载全部」复用；fetch 失败（CORS 等）由调用方退化为逐张单下。

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export interface ZipEntry {
  name: string;
  data: Uint8Array;
}

/** 把若干文件打成一个 store-mode ZIP Blob。 */
export function buildZip(entries: ZipEntry[]): Blob {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const e of entries) {
    const nameBytes = enc.encode(e.name);
    const crc = crc32(e.data);
    const size = e.data.length;

    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); // local file header sig
    lh.setUint16(4, 20, true); // version needed
    lh.setUint16(6, 0, true); // flags
    lh.setUint16(8, 0, true); // method = store
    lh.setUint16(10, 0, true); // mod time
    lh.setUint16(12, 0x21, true); // mod date (1980-01-01)
    lh.setUint32(14, crc, true);
    lh.setUint32(18, size, true); // compressed size
    lh.setUint32(22, size, true); // uncompressed size
    lh.setUint16(26, nameBytes.length, true);
    lh.setUint16(28, 0, true); // extra len
    const lhBytes = new Uint8Array(lh.buffer);
    parts.push(lhBytes, nameBytes, e.data);

    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true); // central dir sig
    cd.setUint16(4, 20, true); // version made by
    cd.setUint16(6, 20, true); // version needed
    cd.setUint16(8, 0, true);
    cd.setUint16(10, 0, true); // method store
    cd.setUint16(12, 0, true);
    cd.setUint16(14, 0x21, true);
    cd.setUint32(16, crc, true);
    cd.setUint32(20, size, true);
    cd.setUint32(24, size, true);
    cd.setUint16(28, nameBytes.length, true);
    cd.setUint16(30, 0, true);
    cd.setUint16(32, 0, true);
    cd.setUint16(34, 0, true);
    cd.setUint16(36, 0, true);
    cd.setUint32(38, 0, true);
    cd.setUint32(42, offset, true); // local header offset
    const cdBytes = new Uint8Array(cd.buffer);
    const centralEntry = new Uint8Array(cdBytes.length + nameBytes.length);
    centralEntry.set(cdBytes, 0);
    centralEntry.set(nameBytes, cdBytes.length);
    central.push(centralEntry);

    offset += lhBytes.length + nameBytes.length + size;
  }

  const centralSize = central.reduce((n, c) => n + c.length, 0);
  const centralOffset = offset;
  const eo = new DataView(new ArrayBuffer(22));
  eo.setUint32(0, 0x06054b50, true); // end of central dir sig
  eo.setUint16(4, 0, true);
  eo.setUint16(6, 0, true);
  eo.setUint16(8, entries.length, true);
  eo.setUint16(10, entries.length, true);
  eo.setUint32(12, centralSize, true);
  eo.setUint32(16, centralOffset, true);
  eo.setUint16(20, 0, true);

  const blobParts = [...parts, ...central, new Uint8Array(eo.buffer)] as unknown as BlobPart[];
  return new Blob(blobParts, { type: "application/zip" });
}

/** 导出 zip 文件名（08 §9.6：图像工坊_导出_YYYYMMDD_HHmmss.zip）。 */
export function exportZipName(now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  const stamp = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}_${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
  return `图像工坊_导出_${stamp}.zip`;
}

/** 拉取若干图片字节打 zip 下载。任一 fetch 失败即抛（调用方退化为逐张单下）。 */
export async function downloadImagesAsZip(
  images: { url: string; name: string }[],
  zipName: string,
): Promise<void> {
  const entries: ZipEntry[] = [];
  for (const img of images) {
    const res = await fetch(img.url);
    if (!res.ok) throw new Error(`zip fetch ${res.status}`);
    entries.push({ name: img.name, data: new Uint8Array(await res.arrayBuffer()) });
  }
  const blob = buildZip(entries);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = zipName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
