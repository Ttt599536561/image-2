// 统一图片下载命名 + 触发（扩展名由实际 URL 推断，阶段二真图为 png 时零改动）。

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

export function downloadImage(src: string, name: string): void {
  const a = document.createElement("a");
  a.href = src;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
}
