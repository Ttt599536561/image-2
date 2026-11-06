import { ResultImageMime } from "../../contracts/generate";
import type { StudioHistoryEntry } from "./history";

const formats = {
  "image/png": { label: "PNG", extension: "png" },
  "image/jpeg": { label: "JPEG", extension: "jpg" },
  "image/webp": { label: "WebP", extension: "webp" },
  "image/gif": { label: "GIF", extension: "gif" },
} as const;

export function resultFormat(entry?: StudioHistoryEntry) {
  // Older history entries only recorded the original Blob MIME. GIF requests
  // from that version could succeed only when an animated GIF was returned.
  const actualMime = ResultImageMime.safeParse(entry?.image?.contentType).data
    ?? ResultImageMime.safeParse(entry?.blob?.type).data;
  const requestedGif = entry?.params.outputFormat === "gif";
  const format = formats[actualMime ?? (requestedGif ? "image/gif" : "image/png")];
  const gifFallback = entry?.status === "succeeded" && requestedGif && format.extension !== "gif";
  return { ...format, gifFallback };
}
