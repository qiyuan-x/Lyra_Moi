import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Agent, ProxyAgent, type Dispatcher } from "undici";
import type { FetchLike } from "./provider-types.js";

export interface SystemProxySettings {
  enabled: boolean;
  server: string;
  bypass: string;
  pacUrl?: string;
}

const exec = promisify(execFile);
const direct: SystemProxySettings = { enabled: false, server: "", bypass: "" };
let reading: Promise<SystemProxySettings> | null = null;

export function parseWindowsProxy(output: string): SystemProxySettings {
  const values = new Map<string, string>();
  for (const line of output.split(/\r?\n/u)) {
    const match = /^\s*(\w+)\s+REG_\w+\s+(.*?)\s*$/u.exec(line);
    if (match) values.set(match[1]!, match[2]!);
  }
  return {
    enabled: Number(values.get("ProxyEnable") ?? 0) === 1,
    server: values.get("ProxyServer") ?? "",
    bypass: values.get("ProxyOverride") ?? "",
    pacUrl: values.get("AutoConfigURL") ?? ""
  };
}

async function readWindowsProxy(): Promise<SystemProxySettings> {
  if (process.platform !== "win32") return direct;
  // Coalesce simultaneous requests only. Do not cache a proxy after the user
  // switches it off, or guess a proxy from an open Clash port.
  reading ??= exec("reg.exe", ["query", "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings"], {
    windowsHide: true, timeout: 3000, maxBuffer: 128 * 1024
  }).then(({ stdout }) => parseWindowsProxy(stdout)).finally(() => { reading = null; });
  return reading;
}

export function resolveSystemProxy(target: string, settings: SystemProxySettings): string | null {
  const url = new URL(target);
  const host = url.hostname.toLowerCase();
  // Local application traffic and OAuth callbacks never leave the machine.
  if (host === "localhost" || host === "[::1]" || /^127\./u.test(host)) return null;
  for (const entry of settings.bypass.split(";")) {
    const pattern = entry.trim().toLowerCase();
    if (!pattern) continue;
    if (pattern === "<local>" && !host.includes(".") && !host.includes(":")) return null;
    const expression = pattern.replace(/[.+?^${}()|[\]\\]/gu, "\\$&").replace(/\*/gu, ".*");
    if (new RegExp(`^${expression}$`, "u").test(host)) return null;
  }
  if (settings.pacUrl) throw new Error("当前使用 PAC 自动代理脚本，应用尚不支持解析；请使用 Clash 的系统代理模式（关闭 PAC）。");
  if (!settings.enabled) return null;
  let server = settings.server.trim();
  if (server.includes("=")) {
    const entries = new Map(server.split(";").map((entry) => {
      const index = entry.indexOf("=");
      return [entry.slice(0, index).trim().toLowerCase(), entry.slice(index + 1).trim()];
    }));
    server = entries.get(url.protocol.slice(0, -1)) ?? "";
    if (!server) return null;
  }
  if (!server) throw new Error("Windows 系统代理已开启，但代理地址为空。");
  const proxy = new URL(server.includes("://") ? server : `http://${server}`);
  if (!["http:", "https:"].includes(proxy.protocol)) throw new Error("系统代理协议不受支持，请使用 HTTP 系统代理。");
  return proxy.toString();
}

export function createSystemProxyFetch(
  fetchImplementation: FetchLike = globalThis.fetch.bind(globalThis),
  readSettings: () => Promise<SystemProxySettings> = readWindowsProxy
): { fetch: FetchLike; close: () => Promise<void> } {
  const agents = new Map<string, Dispatcher>();
  const directAgent = new Agent();
  return {
    fetch: async (input, init) => {
      const target = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const proxy = resolveSystemProxy(target, await readSettings());
      init?.signal?.throwIfAborted();
      let dispatcher = directAgent as Dispatcher;
      if (proxy) {
        if (!agents.has(proxy)) {
          agents.set(proxy, new ProxyAgent({ uri: proxy, headersTimeout: 0, bodyTimeout: 0 }));
          if (agents.size > 8) {
            const first = agents.keys().next().value!;
            void agents.get(first)!.close();
            agents.delete(first);
          }
        }
        dispatcher = agents.get(proxy)!;
      } else {
        // Preserve special no-timeout dispatchers used for image generation.
        dispatcher = (init as RequestInit & { dispatcher?: Dispatcher } | undefined)?.dispatcher ?? directAgent;
      }
      return fetchImplementation(input, { ...init, dispatcher } as RequestInit);
    },
    close: async () => { await Promise.all([directAgent.close(), ...[...agents.values()].map((agent) => agent.close())]); }
  };
}

export const systemProxyFetch = createSystemProxyFetch().fetch;
