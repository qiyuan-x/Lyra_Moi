import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import type {
  CreatePromptTemplateRequestBody,
  PromptTemplateSnapshot,
  UpdatePromptTemplateRequestBody
} from "@lyra/contracts";
import { ConfirmDialog } from "./AssetLibraryPage.js";
import { Icon } from "./Icon.js";

interface PromptLibraryPageProps {
  prompts: PromptTemplateSnapshot[];
  onCreate: (value: CreatePromptTemplateRequestBody) => Promise<void>;
  onUpdate: (promptId: string, value: UpdatePromptTemplateRequestBody) => Promise<void>;
  onDelete: (promptId: string) => Promise<void>;
}

type Feedback = { type: "error" | "success"; text: string } | null;

export function PromptLibraryPage(props: PromptLibraryPageProps) {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [editing, setEditing] = useState<PromptTemplateSnapshot | "new" | null>(null);
  const [deleting, setDeleting] = useState<PromptTemplateSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [favoriteBusyId, setFavoriteBusyId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [selectedExportIds, setSelectedExportIds] = useState<Set<string>>(new Set());
  const importInputRef = useRef<HTMLInputElement>(null);

  const categories = useMemo(
    () => [...new Set(props.prompts.map((prompt) => prompt.category).filter(Boolean))].sort(),
    [props.prompts]
  );
  const visible = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase("zh-CN");
    return props.prompts.filter((prompt) => {
      if (category && prompt.category !== category) return false;
      if (favoritesOnly && !prompt.favorite) return false;
      return (
        !needle ||
        `${prompt.name} ${prompt.category} ${prompt.note ?? ""} ${prompt.content}`
          .toLocaleLowerCase("zh-CN")
          .includes(needle)
      );
    });
  }, [category, favoritesOnly, props.prompts, search]);
  const visibleExportable = visible;
  const allVisibleSelected =
    visibleExportable.length > 0 &&
    visibleExportable.every((item) => selectedExportIds.has(item.id));

  useEffect(() => {
    const ids = new Set(props.prompts.map((item) => item.id));
    setSelectedExportIds((current) => new Set([...current].filter((id) => ids.has(id))));
  }, [props.prompts]);

  function toggleExportSelection(promptId: string) {
    setSelectedExportIds((current) => {
      const next = new Set(current);
      if (next.has(promptId)) next.delete(promptId);
      else next.add(promptId);
      return next;
    });
  }

  function toggleVisibleSelection() {
    const visibleIds = visibleExportable.map((item) => item.id);
    setSelectedExportIds((current) => {
      const next = new Set(current);
      if (allVisibleSelected) {
        visibleIds.forEach((id) => next.delete(id));
      } else {
        visibleIds.forEach((id) => next.add(id));
      }
      return next;
    });
  }

  function clearSelection() {
    setSelectedExportIds(new Set());
  }

  function exportPrompts() {
    const payload = props.prompts
      .filter((item) => selectedExportIds.has(item.id))
      .map(({ name, category, note, content, variables, favorite }) => ({
        name,
        category,
        note,
        content,
        variables,
        favorite
      }));
    if (!payload.length) return;
    const blob = new Blob(
      [JSON.stringify({ version: 1, prompts: payload }, null, 2)],
      { type: "application/json;charset=utf-8" }
    );
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "lyra-prompts.json";
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  async function importPrompts(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setFeedback(null);
    setBusy(true);
    try {
      const parsed: unknown = JSON.parse(await file.text());
      const records =
        Array.isArray(parsed)
          ? parsed
          : parsed &&
              typeof parsed === "object" &&
              Array.isArray((parsed as { prompts?: unknown }).prompts)
            ? (parsed as { prompts: unknown[] }).prompts
            : [];
      if (!records.length) throw new Error("导入文件中没有有效提示词。");

      let imported = 0;
      // The parent prepends new records. Reverse the input to preserve JSON order.
      for (const record of [...records].reverse()) {
        if (!record || typeof record !== "object") continue;
        const item = record as Record<string, unknown>;
        const name = typeof item.name === "string" ? item.name.trim() : "";
        const content = typeof item.content === "string" ? item.content.trim() : "";
        if (!name || !content) continue;
        const variables = Array.isArray(item.variables)
          ? item.variables.filter((value): value is string => typeof value === "string")
          : undefined;
        await props.onCreate({
          name,
          content,
          category: typeof item.category === "string" ? item.category.trim() : "",
          note:
            typeof item.note === "string" && item.note.trim()
              ? item.note.trim()
              : typeof item.shortcut === "string" && item.shortcut.trim()
                ? item.shortcut.trim()
              : null,
          favorite: item.favorite === true,
          ...(variables && variables.length > 0 ? { variables } : {})
        });
        imported += 1;
      }
      if (!imported) throw new Error("导入文件中没有可创建的提示词。");
      setFeedback({ type: "success", text: `已导入 ${imported} 条提示词。` });
    } catch (error) {
      setFeedback({
        type: "error",
        text: error instanceof Error ? error.message : "导入失败，请检查 JSON 文件。"
      });
    } finally {
      setBusy(false);
    }
  }

  async function toggleFavorite(prompt: PromptTemplateSnapshot) {
    if (favoriteBusyId) return;
    setFavoriteBusyId(prompt.id);
    try {
      await props.onUpdate(prompt.id, { favorite: !prompt.favorite });
    } catch {
      // The parent displays the API error.
    } finally {
      setFavoriteBusyId(null);
    }
  }

  return (
    <section className="library-page prompt-library-page">
      <header className="page-heading prompt-library-heading">
        <div className="prompt-library-heading-left">
          <div>
            <h1>提示词库</h1>
            <p>创建、导入、导出和管理提示词模板，生图时可以快速填充。</p>
          </div>
        </div>
        <div className="page-heading-actions">
          <button
            type="button"
            className="button button-primary"
            onClick={() => setEditing("new")}
          >
            <Icon name="plus" size={16} />
            新建模板
          </button>
          <input
            ref={importInputRef}
            hidden
            type="file"
            accept="application/json,.json"
            onChange={(event) => void importPrompts(event)}
          />
          <button
            type="button"
            className="button button-secondary"
            disabled={busy}
            onClick={() => importInputRef.current?.click()}
          >
            导入
          </button>
          <button
            type="button"
            className="button button-secondary"
            disabled={selectedExportIds.size === 0}
            onClick={exportPrompts}
          >
            <Icon name="download" size={15} />
            导出{selectedExportIds.size > 0 ? ` (${selectedExportIds.size})` : ""}
          </button>
        </div>
      </header>

      {feedback && (
        <p className={`prompt-feedback prompt-feedback-${feedback.type}`}>{feedback.text}</p>
      )}

      <div className="library-filters">
        <label className="search-field">
          <span>搜索</span>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="名称、适用模型/备注或内容"
          />
        </label>
        <label>
          <span>分类</span>
          <select value={category} onChange={(event) => setCategory(event.target.value)}>
            <option value="">全部分类</option>
            {categories.map((item) => (
              <option value={item} key={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
        <label className="checkbox-field">
          <input
            type="checkbox"
            checked={favoritesOnly}
            onChange={(event) => setFavoritesOnly(event.target.checked)}
          />
          只看收藏
        </label>
        <span className="filter-count">{visible.length} 项</span>
      </div>

      <div className="prompt-selection-bar">
        <div>
          <strong>提示词列表</strong>
          <span>选择需要导出的提示词</span>
        </div>
        <div className="prompt-selection-actions">
          <span>
            已选择 <b>{selectedExportIds.size}</b> 项
          </span>
          <button
            type="button"
            className="button button-quiet"
            disabled={visibleExportable.length === 0}
            onClick={toggleVisibleSelection}
          >
            {allVisibleSelected ? "取消全选" : "全选当前"}
          </button>
          <button
            type="button"
            className="button button-quiet"
            disabled={selectedExportIds.size === 0}
            onClick={clearSelection}
          >
            清空选择
          </button>
        </div>
      </div>

      <div className="prompt-list" role="list">
        {visible.map((item) => (
          <article className="prompt-list-row" key={item.id}>
            <label className="prompt-row-select" title="选择导出">
              <input
                type="checkbox"
                checked={selectedExportIds.has(item.id)}
                onChange={() => toggleExportSelection(item.id)}
                aria-label={`选择导出 ${item.name}`}
              />
            </label>
            <div className="prompt-row-main">
              <div className="prompt-row-title">
                <h2 title={item.name}>{item.name}</h2>
                <span className="prompt-tag">{item.category || "未分类"}</span>
              </div>
              <p>{item.content}</p>
              <div className="prompt-row-meta">
                {item.note && (
                  <span className="prompt-model-note" title={item.note}>
                    <b>适用模型/备注</b>
                    {item.note}
                  </span>
                )}
                <time dateTime={item.updatedAt}>
                  更新于 {new Date(item.updatedAt).toLocaleDateString("zh-CN")}
                </time>
              </div>
            </div>
            <div className="prompt-row-actions">
              <button
                type="button"
                className={`favorite-button${item.favorite ? " active" : ""}`}
                aria-label={item.favorite ? "取消收藏" : "收藏"}
                aria-pressed={item.favorite}
                title={item.favorite ? "取消收藏" : "收藏"}
                disabled={favoriteBusyId === item.id}
                onClick={() => void toggleFavorite(item)}
              >
                <Icon name="star" size={18} />
              </button>
              <button
                type="button"
                className="icon-button"
                aria-label={`编辑 ${item.name}`}
                title="编辑"
                onClick={() => setEditing(item)}
              >
                <Icon name="manual" size={16} />
              </button>
              <button
                type="button"
                className="icon-button danger-button"
                aria-label={`删除 ${item.name}`}
                title="删除"
                onClick={() => setDeleting(item)}
              >
                <Icon name="trash" size={16} />
              </button>
            </div>
          </article>
        ))}
      </div>

      {visible.length === 0 && (
        <div className="library-empty">
          <Icon name="prompt" size={28} />
          <strong>没有符合条件的模板</strong>
        </div>
      )}

      {editing && (
        <PromptDialog
          prompt={editing === "new" ? null : editing}
          busy={busy}
          onClose={() => setEditing(null)}
          onSave={async (value) => {
            setBusy(true);
            try {
              if (editing === "new") await props.onCreate(value);
              else await props.onUpdate(editing.id, value);
              setEditing(null);
            } catch {
              // The parent displays the API error.
            } finally {
              setBusy(false);
            }
          }}
        />
      )}

      {deleting && (
        <ConfirmDialog
          title="删除提示词模板"
          text={`确认删除“${deleting.name}”吗？`}
          busy={busy}
          onClose={() => setDeleting(null)}
          onConfirm={async () => {
            setBusy(true);
            try {
              await props.onDelete(deleting.id);
              setDeleting(null);
            } catch {
              // The parent displays the API error.
            } finally {
              setBusy(false);
            }
          }}
        />
      )}
    </section>
  );
}

function PromptDialog(props: {
  prompt: PromptTemplateSnapshot | null;
  busy: boolean;
  onClose: () => void;
  onSave: (value: CreatePromptTemplateRequestBody) => Promise<void>;
}) {
  const [name, setName] = useState(props.prompt?.name ?? "");
  const [category, setCategory] = useState(props.prompt?.category ?? "");
  const [note, setNote] = useState(props.prompt?.note ?? "");
  const [content, setContent] = useState(props.prompt?.content ?? "");
  const [favorite, setFavorite] = useState(props.prompt?.favorite ?? false);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim() || !content.trim()) return;
    void props.onSave({
      name: name.trim(),
      category: category.trim(),
      note: note.trim() || null,
      content: content.trim(),
      favorite
    });
  }

  return (
    <div className="modal-backdrop" onMouseDown={props.onClose}>
      <form
        className="form-modal prompt-form-modal"
        onSubmit={submit}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <strong>{props.prompt ? "编辑提示词" : "新建提示词"}</strong>
            <span>保存后可以在生图输入框中快速填充。</span>
          </div>
          <button type="button" className="icon-button" onClick={props.onClose}>
            <Icon name="close" size={18} />
          </button>
        </header>
        <div className="form-body form-grid">
          <label className="field">
            <span>名称</span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={120}
              autoFocus
            />
          </label>
          <label className="field">
            <span>分类</span>
            <input
              value={category}
              onChange={(event) => setCategory(event.target.value)}
              maxLength={80}
              placeholder="例如：角色设计"
            />
          </label>
          <label className="field form-wide">
            <span>适用模型/备注</span>
            <input
              value={note}
              onChange={(event) => setNote(event.target.value)}
              maxLength={200}
              placeholder="例如：Nano Banana 效果更好"
            />
          </label>
          <label className="field form-wide">
            <span>提示词内容</span>
            <textarea
              value={content}
              onChange={(event) => setContent(event.target.value)}
              maxLength={10000}
              rows={8}
            />
          </label>
          <label className="checkbox-field form-wide">
            <input
              type="checkbox"
              checked={favorite}
              onChange={(event) => setFavorite(event.target.checked)}
            />
            加入收藏
          </label>
        </div>
        <footer>
          <button type="button" className="button button-secondary" onClick={props.onClose}>
            取消
          </button>
          <button
            type="submit"
            className="button button-primary"
            disabled={props.busy || !name.trim() || !content.trim()}
          >
            {props.busy ? "保存中…" : "保存"}
          </button>
        </footer>
      </form>
    </div>
  );
}
