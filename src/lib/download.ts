// 统一图片下载 / 复制到剪贴板。
// 关键坑：成品图是跨域 Supabase 公链，`<a download>` 的 download 属性对跨域 URL 会被浏览器忽略
// → 只会在新标签打开图片、不会真下载（验收 #17）。因此必须先 fetch 成 blob、再用 objectURL 触发。

export function imageExt(url: string): string {
  if (url.startsWith("data:image/svg") || url.includes(".svg")) return "svg";
  if (url.includes(".png")) return "png";
  if (url.includes(".jpeg") || url.includes(".jpg")) return "jpg";
  if (url.includes(".webp")) return "webp";
  return "png";
}

export function imageFilename(url: string, id: string): string {
  return `图像工坊_${id}.${imageExt(url)}`;
}

function triggerAnchorDownload(href: string, name: string): void {
  const a = document.createElement("a");
  a.href = href;
  a.download = name;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/**
 * 真下载：先把图 fetch 成 blob，再用 objectURL 触发下载（跨域直链的 download 属性会被忽略，只会打开新标签）。
 * fetch 失败（极少数 CORS 拦截）则回退直链：同源/浏览器允许时仍可下载，最差也是打开图片，不会静默无反应。
 */
export async function downloadImage(src: string, name: string): Promise<void> {
  try {
    const res = await fetch(src, { mode: "cors" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    triggerAnchorDownload(url, name);
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  } catch {
    triggerAnchorDownload(src, name);
  }
}

/** 把任意图片 blob 经 canvas 转成 PNG（浏览器写剪贴板基本只认 image/png；jpeg 等需转码）。 */
async function blobToPngBlob(blob: Blob): Promise<Blob> {
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("image decode failed"));
      el.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no 2d context");
    ctx.drawImage(img, 0, 0);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), "image/png"),
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * 复制图片到剪贴板（验收 #19，复制的是图片 blob 不是 URL 文本）。
 * 用 `ClipboardItem(Promise<Blob>)` 形式：write() 在用户点击的同一同步栈内调用，保住 Safari 的用户手势激活，
 * 真正的 fetch / 转码在 promise 里异步完成。非 png 先经 canvas 转 png。
 */
export async function copyImageToClipboard(src: string): Promise<void> {
  if (
    typeof navigator === "undefined" ||
    !navigator.clipboard ||
    typeof ClipboardItem === "undefined"
  ) {
    throw new Error("clipboard unsupported");
  }
  const pngBlob = fetch(src, { mode: "cors" })
    .then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.blob();
    })
    .then((b) => (b.type === "image/png" ? b : blobToPngBlob(b)));
  await navigator.clipboard.write([new ClipboardItem({ "image/png": pngBlob })]);
}
