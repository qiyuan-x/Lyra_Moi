import { readFile, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";

const [baseUrl, environmentName, model, imagePath, prompt] = process.argv.slice(2);
if (!baseUrl || !environmentName || !model || !imagePath || !prompt) {
  throw new Error(
    "Usage: node tests/diagnostics/run-live-image-edit.mjs <baseUrl> <envName> <model> <imagePath> <prompt>"
  );
}

const apiKey = readEnvironmentValue(
  await readFile(resolve("data", "config", ".env"), "utf8"),
  environmentName
);
if (!apiKey) throw new Error(`API key is not configured for ${environmentName}.`);

const image = await readFile(resolve(imagePath));
const form = new FormData();
form.append("model", model);
form.append("prompt", prompt);
form.append("n", "1");
form.append("image[]", new Blob([image], { type: "image/png" }), basename(imagePath));

const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 5 * 60_000);
const startedAt = Date.now();

try {
  const response = await fetch(`${baseUrl.replace(/\/+$/u, "")}/images/edits`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: form,
    signal: controller.signal
  });
  const raw = Buffer.from(await response.arrayBuffer());
  const elapsedMs = Date.now() - startedAt;
  let body;
  try {
    body = JSON.parse(raw.toString("utf8"));
  } catch {
    throw new Error(`Provider returned non-JSON response: HTTP ${response.status}, ${raw.length} bytes.`);
  }
  if (!response.ok) {
    const message = body?.error?.message ?? body?.message ?? `HTTP ${response.status}`;
    throw new Error(`Provider rejected image edit after ${elapsedMs} ms: ${message}`);
  }
  const item = body?.data?.[0] ?? body?.images?.[0];
  const encoded = typeof item === "string"
    ? item
    : item?.b64_json ?? item?.base64 ?? item?.data;
  const url = typeof item === "object" && item ? item.url : null;
  if (!encoded && !url) throw new Error("Provider response does not contain an image.");
  const output = resolve("data", "temp", `live-edit-${Date.now()}.png`);
  if (encoded) {
    const normalized = encoded.replace(/^data:[^;,]+;base64,/u, "");
    await writeFile(output, Buffer.from(normalized, "base64"));
  } else {
    const download = await fetch(url);
    if (!download.ok) throw new Error(`Generated image download failed: HTTP ${download.status}.`);
    await writeFile(output, Buffer.from(await download.arrayBuffer()));
  }
  console.log(JSON.stringify({
    ok: true,
    status: response.status,
    elapsedMs,
    requestId: response.headers.get("x-request-id"),
    output
  }));
} finally {
  clearTimeout(timeout);
}

function readEnvironmentValue(source, name) {
  for (const rawLine of source.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1 || line.slice(0, separator).trim() !== name) continue;
    const value = line.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      return value.slice(1, -1);
    }
    return value;
  }
  return null;
}
