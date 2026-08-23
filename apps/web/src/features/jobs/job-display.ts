import type { AssetSnapshot, JobSnapshot } from "@lyra/contracts";

type JobTiming = Pick<
  JobSnapshot,
  "status" | "createdAt" | "updatedAt" | "finishedAt"
>;

export function isActiveJob(job: JobTiming): boolean {
  return job.status === "queued" || job.status === "running";
}

export function jobElapsedMs(job: JobTiming, now = Date.now()): number {
  const startedAt = Date.parse(job.createdAt);
  const fallbackEnd = isActiveJob(job) ? now : Date.parse(job.updatedAt);
  const finishedAt = job.finishedAt ? Date.parse(job.finishedAt) : fallbackEnd;
  if (!Number.isFinite(startedAt) || !Number.isFinite(finishedAt)) return 0;
  return Math.max(0, finishedAt - startedAt);
}

export function formatDuration(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1_000));
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);
  return hours > 0
    ? `${hours}:${padTime(minutes)}:${padTime(seconds)}`
    : `${minutes}:${padTime(seconds)}`;
}

export function formatImageAssetSummary(asset: AssetSnapshot | undefined): string {
  if (!asset) return "图片信息不可用";
  const parts: string[] = [];
  if (asset.width && asset.height) parts.push(`${asset.width} × ${asset.height}`);
  parts.push(formatImageType(asset.mimeType));
  parts.push(formatByteSize(asset.byteSize));
  return parts.join(" · ");
}

function padTime(value: number): string {
  return String(value).padStart(2, "0");
}

function formatImageType(mimeType: string): string {
  const subtype = mimeType.split("/", 2)[1]?.split("+", 1)[0];
  if (!subtype) return "IMAGE";
  if (subtype === "jpeg") return "JPG";
  if (subtype === "svg+xml") return "SVG";
  return subtype.toUpperCase();
}

function formatByteSize(byteSize: number): string {
  if (!Number.isFinite(byteSize) || byteSize < 0) return "大小未知";
  if (byteSize < 1_024) return `${byteSize} B`;
  const kilobytes = byteSize / 1_024;
  if (kilobytes < 1_024) return `${formatSizeNumber(kilobytes)} KB`;
  return `${formatSizeNumber(kilobytes / 1_024)} MB`;
}

function formatSizeNumber(value: number): string {
  return value >= 100 ? value.toFixed(0) : value.toFixed(1);
}
