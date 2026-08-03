import { randomUUID } from "node:crypto";
import type {
  ConversationSnapshot,
  MessageRole,
  MessageSnapshot,
  OrderedAssetInput
} from "@lyra/contracts";
import type { LyraDatabase } from "./database.js";

interface ConversationRow {
  id: string;
  project_id: string;
  title: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

interface MessageRow {
  id: string;
  conversation_id: string;
  role: MessageRole;
  text: string;
  reply_to_id: string | null;
  created_at: string;
}

interface AttachmentRow {
  message_id: string;
  asset_id: string;
  position: number;
  label: string;
}

export interface CreateMessageInput {
  conversationId: string;
  role: MessageRole;
  text: string;
  replyToId?: string | null;
  attachments?: OrderedAssetInput[];
}

export class ConversationNotFoundError extends Error {
  constructor(conversationId: string) {
    super(`Conversation not found: ${conversationId}`);
    this.name = "ConversationNotFoundError";
  }
}

export class ConversationRepository {
  readonly #database: LyraDatabase;

  constructor(database: LyraDatabase) {
    this.#database = database;
  }

  create(projectId: string, title = ""): ConversationSnapshot {
    const id = randomUUID();
    const now = new Date().toISOString();
    const snapshot: ConversationSnapshot = {
      id,
      projectId: requireText(projectId, "Project ID"),
      title: normalizeTitle(title),
      createdAt: now,
      updatedAt: now,
      deletedAt: null
    };
    this.#database.connection
      .prepare(`
        INSERT INTO conversations (id, project_id, title, created_at, updated_at, deleted_at)
        VALUES (?, ?, ?, ?, ?, NULL)
      `)
      .run(id, snapshot.projectId, snapshot.title, now, now);
    return structuredClone(snapshot);
  }

  findById(conversationId: string, includeDeleted = false): ConversationSnapshot | null {
    const row = this.#database.connection
      .prepare(`
        SELECT id, project_id, title, created_at, updated_at, deleted_at
        FROM conversations
        WHERE id = ? AND (? = 1 OR deleted_at IS NULL)
      `)
      .get(conversationId, includeDeleted ? 1 : 0) as ConversationRow | undefined;
    return row ? mapConversation(row) : null;
  }

  requireById(conversationId: string): ConversationSnapshot {
    const conversation = this.findById(conversationId);
    if (!conversation) throw new ConversationNotFoundError(conversationId);
    return conversation;
  }

  list(projectId: string): ConversationSnapshot[] {
    const rows = this.#database.connection
      .prepare(`
        SELECT id, project_id, title, created_at, updated_at, deleted_at
        FROM conversations
        WHERE project_id = ? AND deleted_at IS NULL
        ORDER BY updated_at DESC, id DESC
      `)
      .all(projectId) as unknown as ConversationRow[];
    return rows.map(mapConversation);
  }

  updateTitle(conversationId: string, title: string): ConversationSnapshot {
    const existing = this.requireById(conversationId);
    const updatedAt = new Date().toISOString();
    const normalizedTitle = normalizeTitle(title);
    this.#database.connection
      .prepare("UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?")
      .run(normalizedTitle, updatedAt, conversationId);
    return { ...existing, title: normalizedTitle, updatedAt };
  }

  softDelete(conversationId: string): ConversationSnapshot {
    const existing = this.requireById(conversationId);
    const now = new Date().toISOString();
    this.#database.connection
      .prepare("UPDATE conversations SET deleted_at = ?, updated_at = ? WHERE id = ?")
      .run(now, now, conversationId);
    return { ...existing, deletedAt: now, updatedAt: now };
  }

  createMessage(input: CreateMessageInput): MessageSnapshot {
    const conversation = this.requireById(input.conversationId);
    const attachments = structuredClone(input.attachments ?? []);
    validateAttachments(attachments);
    const message: MessageSnapshot = {
      id: randomUUID(),
      conversationId: conversation.id,
      role: input.role,
      text: input.text,
      replyToId: input.replyToId ?? null,
      attachments,
      createdAt: new Date().toISOString()
    };
    this.#database.transaction(() => {
      this.#database.connection
        .prepare(`
          INSERT INTO messages (id, conversation_id, role, text, reply_to_id, created_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `)
        .run(
          message.id,
          message.conversationId,
          message.role,
          message.text,
          message.replyToId,
          message.createdAt
        );
      const insertAttachment = this.#database.connection.prepare(`
        INSERT INTO message_attachments (
          id, message_id, asset_id, position, label, created_at
        ) VALUES (?, ?, ?, ?, ?, ?)
      `);
      for (const attachment of attachments) {
        insertAttachment.run(
          randomUUID(),
          message.id,
          attachment.assetId,
          attachment.position,
          attachment.label,
          message.createdAt
        );
      }
      this.#database.connection
        .prepare("UPDATE conversations SET updated_at = ? WHERE id = ?")
        .run(message.createdAt, conversation.id);
    });
    return structuredClone(message);
  }

  findMessageById(messageId: string): MessageSnapshot | null {
    const row = this.#database.connection
      .prepare(`
        SELECT id, conversation_id, role, text, reply_to_id, created_at
        FROM messages WHERE id = ?
      `)
      .get(messageId) as MessageRow | undefined;
    return row ? this.#mapMessage(row) : null;
  }

  listMessages(conversationId: string): MessageSnapshot[] {
    this.requireById(conversationId);
    const rows = this.#database.connection
      .prepare(`
        SELECT id, conversation_id, role, text, reply_to_id, created_at
        FROM messages WHERE conversation_id = ? ORDER BY created_at, id
      `)
      .all(conversationId) as unknown as MessageRow[];
    return rows.map((row) => this.#mapMessage(row));
  }

  #mapMessage(row: MessageRow): MessageSnapshot {
    const attachments = this.#database.connection
      .prepare(`
        SELECT message_id, asset_id, position, label
        FROM message_attachments WHERE message_id = ? ORDER BY position
      `)
      .all(row.id) as unknown as AttachmentRow[];
    return {
      id: row.id,
      conversationId: row.conversation_id,
      role: row.role,
      text: row.text,
      replyToId: row.reply_to_id,
      attachments: attachments.map((attachment) => ({
        assetId: attachment.asset_id,
        position: attachment.position,
        label: attachment.label
      })),
      createdAt: row.created_at
    };
  }
}

function mapConversation(row: ConversationRow): ConversationSnapshot {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at
  };
}

function validateAttachments(attachments: readonly OrderedAssetInput[]): void {
  attachments.forEach((attachment, index) => {
    if (attachment.position !== index + 1) {
      throw new Error("Message attachments must be ordered continuously from 1.");
    }
    requireText(attachment.assetId, "Attachment asset ID");
    requireText(attachment.label, "Attachment label");
  });
}

function normalizeTitle(value: string): string {
  const title = value.trim();
  if (title.length > 200) throw new Error("Conversation title cannot exceed 200 characters.");
  return title;
}

function requireText(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} is required.`);
  return normalized;
}
