import { z } from "zod";
import { BACKGROUNDS, QUALITIES, SIZES } from "../../contracts/generate";
import { STUDIO_MODEL, STUDIO_MODELS } from "../../contracts/studio";

export const PREFERENCES_STORAGE_KEY = "image-studio-preferences-v1";
const Preferences = z.object({
  model: z.enum(STUDIO_MODELS).catch(STUDIO_MODEL),
  size: z.enum(SIZES).catch("auto"),
  quality: z.enum(QUALITIES).catch("auto"),
  background: z.enum(BACKGROUNDS).catch("auto"),
  outputFormat: z.enum(["png", "gif"]).catch("png"),
});
export const DEFAULT_STUDIO_PREFERENCES = Preferences.parse({});

export function loadPreferences(storage: Pick<Storage, "getItem">) {
  const saved = storage.getItem(PREFERENCES_STORAGE_KEY);
  try { return Preferences.parse(JSON.parse(saved ?? "{}")); }
  catch { return { ...DEFAULT_STUDIO_PREFERENCES }; }
}

export function savePreferences(params: unknown, storage: Pick<Storage, "setItem">): void {
  // The schema strips prompts, credentials, references, and any future task fields.
  storage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify(Preferences.parse(params)));
}
