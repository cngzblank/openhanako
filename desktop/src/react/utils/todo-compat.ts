/**
 * todo-compat.ts — 前端镜像
 *
 * 后端真实来源：project-hana/lib/tools/todo-compat.js
 * 这两个文件必须保持同步。任何改动都要改两处。
 */

import { TODO_TOOL_NAMES } from "./todo-constants";
import type { TodoItem, TodoStatus } from "../types";

type LegacyTodoItem = { id?: number; text: string; done: boolean };
type UnknownDetails = { todos?: unknown[] } & Record<string, unknown>;

const VALID_STATUSES: ReadonlySet<TodoStatus> = new Set<TodoStatus>([
  "pending",
  "in_progress",
  "completed",
]);

function isLegacyTodoItem(item: unknown): item is LegacyTodoItem {
  return (
    typeof item === "object" &&
    item !== null &&
    typeof (item as { done?: unknown }).done === "boolean"
  );
}

function isNewTodoItem(item: unknown): item is TodoItem {
  if (typeof item !== "object" || item === null) return false;
  const it = item as Record<string, unknown>;
  return (
    typeof it.content === "string" &&
    typeof it.activeForm === "string" &&
    typeof it.status === "string" &&
    VALID_STATUSES.has(it.status as TodoStatus)
  );
}

function migrateLegacyItem(old: LegacyTodoItem): TodoItem {
  return {
    content: old.text ?? "",
    activeForm: old.text ?? "",
    status: old.done ? "completed" : "pending",
  };
}

function sanitizeUnknownItem(item: unknown): TodoItem {
  const anyItem = (item || {}) as Record<string, unknown>;
  const content = typeof anyItem.content === "string" ? anyItem.content
    : typeof anyItem.text === "string" ? (anyItem.text as string)
    : "";
  const activeForm = typeof anyItem.activeForm === "string" ? anyItem.activeForm : content;
  const statusRaw = anyItem.status;
  const status: TodoStatus = (typeof statusRaw === "string" && VALID_STATUSES.has(statusRaw as TodoStatus))
    ? (statusRaw as TodoStatus)
    : "pending";
  return { content, activeForm, status };
}

export function migrateLegacyTodos(details: UnknownDetails | null | undefined): TodoItem[] {
  if (!details || typeof details !== "object") return [];
  const todos = (details as { todos?: unknown }).todos;
  if (!Array.isArray(todos)) return [];
  return todos.map((item) => {
    if (isLegacyTodoItem(item)) return migrateLegacyItem(item);
    if (isNewTodoItem(item)) return item;
    console.error("[todo-compat] corrupt todo item detected, sanitizing to pending:", item);
    return sanitizeUnknownItem(item);
  });
}

type MessageLike = { role?: string; toolName?: string; details?: unknown };

export function extractLatestTodos(sourceMessages: MessageLike[] | null | undefined): TodoItem[] | null {
  if (!Array.isArray(sourceMessages)) return null;
  for (let i = sourceMessages.length - 1; i >= 0; i--) {
    const m = sourceMessages[i];
    if (!m || m.role !== "toolResult") continue;
    if (!m.toolName || !TODO_TOOL_NAMES.includes(m.toolName as typeof TODO_TOOL_NAMES[number])) continue;
    return migrateLegacyTodos(m.details as UnknownDetails);
  }
  return null;
}
