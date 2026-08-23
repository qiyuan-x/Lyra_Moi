import type { EntityId, UtcDateTime } from "./common.js";

export interface PromptTemplateSnapshot {
  id: EntityId;
  name: string;
  category: string;
  note: string | null;
  content: string;
  variables: string[];
  favorite: boolean;
  previewMimeType: string | null;
  createdAt: UtcDateTime;
  updatedAt: UtcDateTime;
  deletedAt: UtcDateTime | null;
}

export interface PromptTemplateListQuery {
  search?: string;
  category?: string;
  favorite?: boolean;
}

export interface CreatePromptTemplateRequestBody {
  name: string;
  category?: string;
  note?: string | null;
  content: string;
  variables?: string[];
  favorite?: boolean;
}

export interface UpdatePromptTemplateRequestBody {
  name?: string;
  category?: string;
  note?: string | null;
  content?: string;
  variables?: string[];
  favorite?: boolean;
}
