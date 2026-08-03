export type ApiErrorCode =
  | "VALIDATION_ERROR"
  | "NOT_FOUND"
  | "CONFLICT"
  | "MIGRATION_REQUIRED"
  | "INTERNAL_ERROR";

export interface ApiErrorResponse {
  error: {
    code: ApiErrorCode | string;
    message: string;
    details: unknown;
  };
  requestId: string;
}

export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
}

export interface HealthResponse {
  ok: boolean;
  database: "ready" | "not_ready";
  web: "ready" | "not_ready";
  worker: "ready" | "not_ready";
}
