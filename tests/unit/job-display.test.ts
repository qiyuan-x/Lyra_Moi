import { describe, expect, it } from "vitest";
import type { AssetSnapshot, JobSnapshot } from "@lyra/contracts";
import {
  formatDuration,
  formatImageAssetSummary,
  jobElapsedMs
} from "../../apps/web/src/features/jobs/job-display.js";

describe("job display helpers", () => {
  it("formats short and long durations", () => {
    expect(formatDuration(8_900)).toBe("0:08");
    expect(formatDuration(62_000)).toBe("1:02");
    expect(formatDuration(3_723_000)).toBe("1:02:03");
  });

  it("uses the final task timestamp after completion", () => {
    const job = {
      status: "succeeded",
      createdAt: "2026-08-05T08:00:00.000Z",
      updatedAt: "2026-08-05T08:00:30.000Z",
      finishedAt: "2026-08-05T08:00:12.500Z"
    } satisfies Pick<JobSnapshot, "status" | "createdAt" | "updatedAt" | "finishedAt">;
    expect(jobElapsedMs(job, Date.parse("2026-08-05T09:00:00.000Z"))).toBe(12_500);
  });

  it("formats generated image metadata", () => {
    const asset = {
      width: 1024,
      height: 1536,
      mimeType: "image/png",
      byteSize: 2_621_440
    } as AssetSnapshot;
    expect(formatImageAssetSummary(asset)).toBe("1024 × 1536 · PNG · 2.5 MB");
  });
});
