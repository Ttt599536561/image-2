import { MAX_STUDIO_REFERENCE_IMAGES } from "../../contracts/studio";

/** Keep old rows readable while rejecting ambiguous sources and validating every owner. */
export function resolveInputImageKeys(input: {
  inputImageKey?: string | null;
  inputImageKeys?: string[] | null;
  sourceImageId?: string | null;
}, ownerId: string): string[] {
  const sources = [input.inputImageKey, input.inputImageKeys, input.sourceImageId].filter((value) => value != null);
  if (sources.length > 1) throw new Error("来源图片参数冲突");
  const keys = input.inputImageKeys ?? (input.inputImageKey ? [input.inputImageKey] : []);
  if (!Array.isArray(keys) || keys.length > MAX_STUDIO_REFERENCE_IMAGES || (input.inputImageKeys && keys.length === 0)) throw new Error("参考图数量无效");
  for (const key of keys) {
    if (typeof key !== "string" || key.length > 300 || !key.startsWith(`uploads/${ownerId}/`) ||
      /[\\\u0000-\u001f]/.test(key) || key.split("/").some((part) => !part || part === "." || part === "..")) throw new Error("参考图无效");
  }
  return keys;
}
