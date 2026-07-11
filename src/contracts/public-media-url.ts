import { z } from "zod";

function isGeneratedLocalMediaPath(value: string): boolean {
  if (
    !value.startsWith("/media/") ||
    value.startsWith("//") ||
    value.includes("?") ||
    value.includes("#")
  ) {
    return false;
  }

  const encodedSegments = value.slice("/media/".length).split("/");
  if (encodedSegments.some((segment) => !segment)) return false;

  return encodedSegments.every((encodedSegment) => {
    try {
      const segment = decodeURIComponent(encodedSegment);
      return (
        segment !== "." &&
        segment !== ".." &&
        !segment.includes("/") &&
        !segment.includes("\\") &&
        !segment.includes("\0") &&
        encodeURIComponent(segment) === encodedSegment
      );
    } catch {
      return false;
    }
  });
}

const LocalMediaPathSchema = z
  .string()
  .refine(isGeneratedLocalMediaPath, "Invalid local media path");

export const PublicMediaUrlSchema = z.union([z.url(), LocalMediaPathSchema]);
export type PublicMediaUrl = z.infer<typeof PublicMediaUrlSchema>;
