export type ProviderConnectionErrorCode =
  | "MISSING_API_KEY"
  | "INVALID_CONFIGURATION"
  | "DISCOVERY_UNSUPPORTED"
  | "AUTHENTICATION_FAILED"
  | "PERMISSION_DENIED"
  | "RATE_LIMITED"
  | "BAD_REQUEST"
  | "NOT_FOUND"
  | "SERVER_ERROR"
  | "HTTP_ERROR"
  | "INVALID_RESPONSE"
  | "RESPONSE_TOO_LARGE"
  | "TIMEOUT"
  | "UNREACHABLE";

export class ProviderConnectionError extends Error {
  readonly code: ProviderConnectionErrorCode;
  readonly statusCode: number | null;
  readonly requestId: string | null;

  constructor(
    code: ProviderConnectionErrorCode,
    message: string,
    statusCode: number | null = null,
    requestId: string | null = null
  ) {
    super(message);
    this.name = "ProviderConnectionError";
    this.code = code;
    this.statusCode = statusCode;
    this.requestId = requestId;
  }
}

const SENSITIVE_FIELD_PATTERN = /^(authorization|proxy-authorization|x-goog-api-key|api[-_]?key|access[-_]?token|secret)$/iu;

export function redactSensitiveData(value: unknown, secrets: readonly string[] = []): unknown {
  return redactValue(value, secrets.filter(Boolean), new WeakSet<object>());
}

export function sanitizeError(
  error: unknown,
  secrets: readonly string[] = []
): { name: string; message: string; code: string | null } {
  if (!(error instanceof Error)) {
    return { name: "Error", message: redactString(String(error), secrets), code: null };
  }
  const code = "code" in error && typeof error.code === "string" ? error.code : null;
  return {
    name: error.name,
    message: redactString(error.message, secrets),
    code
  };
}

function redactValue(
  value: unknown,
  secrets: readonly string[],
  visited: WeakSet<object>
): unknown {
  if (typeof value === "string") return redactString(value, secrets);
  if (typeof value !== "object" || value === null) return value;
  if (visited.has(value)) return "[CIRCULAR]";
  visited.add(value);
  if (value instanceof Error) return sanitizeError(value, secrets);
  if (Array.isArray(value)) return value.map((item) => redactValue(item, secrets, visited));

  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    output[key] = SENSITIVE_FIELD_PATTERN.test(key)
      ? "[REDACTED]"
      : redactValue(item, secrets, visited);
  }
  return output;
}

function redactString(value: string, secrets: readonly string[]): string {
  let redacted = value
    .replace(/\bBearer\s+[^\s,;]+/giu, "Bearer [REDACTED]")
    .replace(/([?&](?:key|api_key|access_token)=)[^&#\s]+/giu, "$1[REDACTED]");
  for (const secret of secrets) redacted = redacted.split(secret).join("[REDACTED]");
  return redacted;
}
