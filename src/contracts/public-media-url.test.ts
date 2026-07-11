import { describe, expect, it } from "vitest";
import { InspirationCoverUploadResponse } from "./admin";
import { ConversationGeneration } from "./conversation";
import { GenerateStatusResponse } from "./generate";
import { ImageItem } from "./image";
import { PublicMediaUrlSchema } from "./public-media-url";

const MEDIA_URL = "/media/users/a%20file.png";
const GENERATION_ID = "00000000-0000-4000-8000-000000000001";
const IMAGE_ID = "00000000-0000-4000-8000-000000000002";
const DEADLINE_AT = "2026-07-12T12:05:00.000Z";

describe("public media URL contract", () => {
  it("accepts absolute provider URLs and encoded nested local media paths", () => {
    expect(PublicMediaUrlSchema.parse("https://storage.example/images/a.png?version=1")).toBe(
      "https://storage.example/images/a.png?version=1",
    );
    expect(PublicMediaUrlSchema.parse(MEDIA_URL)).toBe(MEDIA_URL);
  });

  it.each([
    "media/a.png",
    "/other/a.png",
    "//evil.example/a.png",
    "/media/",
    "/media/a.png?download=1",
    "/media/a.png#preview",
    "/media/../a.png",
    "/media/./a.png",
    "/media/%2e%2e/a.png",
    "/media/%2E/a.png",
    "/media/%E0%A4%A.png",
    "/media/users//a.png",
    "/media/users%2Fa.png",
  ])("rejects an invalid local media path: %s", (value) => {
    expect(PublicMediaUrlSchema.safeParse(value).success).toBe(false);
  });
});

describe("self-hosted media response integration", () => {
  it("parses a succeeded generation status", () => {
    const response = {
      generationId: GENERATION_ID,
      credentialMode: "system",
      deadlineAt: DEADLINE_AT,
      status: "succeeded",
      image: { publicUrl: MEDIA_URL, width: 1, height: 1 },
      creditsChargedMp: 1000,
      durationMs: 500,
    } as const;

    expect(GenerateStatusResponse.parse(response)).toEqual(response);
  });

  it("parses a conversation generation", () => {
    const response = {
      id: GENERATION_ID,
      prompt: "a rainy city",
      size: "1024x1024",
      quality: "auto",
      background: "auto",
      credentialMode: "system",
      deadlineAt: DEADLINE_AT,
      status: "succeeded",
      errorCode: null,
      error: null,
      httpStatus: null,
      creditsChargedMp: 1000,
      durationMs: 500,
      createdAt: DEADLINE_AT,
      image: {
        id: IMAGE_ID,
        publicUrl: MEDIA_URL,
        width: 1,
        height: 1,
        savedToLibrary: false,
      },
    } as const;

    expect(ConversationGeneration.parse(response)).toEqual(response);
  });

  it("parses an image library item", () => {
    const response = {
      id: IMAGE_ID,
      generationId: GENERATION_ID,
      prompt: "a rainy city",
      publicUrl: MEDIA_URL,
      width: 1,
      height: 1,
      createdAt: DEADLINE_AT,
      expiresAt: null,
      savedToLibrary: true,
    } as const;

    expect(ImageItem.parse(response)).toEqual(response);
  });

  it("parses an admin inspiration cover upload response", () => {
    const response = { coverUrl: MEDIA_URL } as const;

    expect(InspirationCoverUploadResponse.parse(response)).toEqual(response);
  });
});
