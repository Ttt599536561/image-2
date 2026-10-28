import { MAX_STUDIO_REFERENCE_IMAGES } from "../../contracts/studio";
import { validateReferenceImage } from "./api";

/** A rejected batch leaves every existing reference intact. */
export function appendReferences(current: File[], incoming: File[]): { files: File[]; error?: string } {
  if (current.length + incoming.length > MAX_STUDIO_REFERENCE_IMAGES) {
    return { files: current, error: `参考图片最多 4 张，当前已有 ${current.length} 张；请减少本次选择的图片。` };
  }
  for (const file of incoming) {
    const invalid = validateReferenceImage(file);
    if (invalid) return { files: current, error: `${file.name}：${invalid}` };
  }
  return { files: [...current, ...incoming] };
}
