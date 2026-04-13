/**
 * Integration test for createSession tool snapshot behavior (Task 5).
 *
 * Covers the three branches:
 *   A. restore=true + meta has toolNames  → replay snapshot
 *   B. restore=true + meta missing        → legacy, keep all tools
 *   C. restore=false                       → fresh compute from config
 * Plus tampering protection: core tools survive even if listed in disabled.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import os from "os";

const { createAgentSessionMock, sessionManagerCreateMock, sessionManagerOpenMock } = vi.hoisted(() => ({
  createAgentSessionMock: vi.fn(),
  sessionManagerCreateMock: vi.fn(),
  sessionManagerOpenMock: vi.fn(),
}));

vi.mock("../lib/pi-sdk/index.js", () => ({
  createAgentSession: createAgentSessionMock,
  SessionManager: {
    create: sessionManagerCreateMock,
    open: sessionManagerOpenMock,
  },
  SettingsManager: { inMemory: vi.fn(() => ({})) },
  estimateTokens: vi.fn(() => 0),
  findCutPoint: vi.fn(),
  generateSummary: vi.fn(),
  emitSessionShutdown: vi.fn(),
}));

vi.mock("../lib/debug-log.js", () => ({
  createModuleLogger: () => ({ log: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

import { SessionCoordinator } from "../core/session-coordinator.js";

// Fake tool objects — only needs `.name` to satisfy `.map(t => t.name)` paths
function makeTool(name) {
  return { name, execute: vi.fn() };
}

const ALL_TOOL_OBJS = [
  "read", "bash", "edit", "write", "grep", "find", "ls",
  "search_memory", "pin_memory", "unpin_memory", "web_search",
  "web_fetch", "todo_write", "create_artifact", "notify",
  "stage_files", "subagent", "channel", "record_experience",
  "recall_experience", "check_pending_tasks", "wait", "stop_task",
  "browser", "cron", "dm", "install_skill", "update_settings",
].map(makeTool);

function allNames() {
  return ALL_TOOL_OBJS.map((t) => t.name);
}

describe("session-coordinator tool snapshot (createSession)", () => {
  let tmpDir, agentDir, sessionDir, coord, fakeSessionPath, activeToolsSpy, currentAgentConfig;

  beforeEach(() => {
    vi.clearAllMocks();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tool-snapshot-"));
    agentDir = path.join(tmpDir, "agents", "test");
    sessionDir = path.join(agentDir, "sessions");
    fs.mkdirSync(sessionDir, { recursive: true });
    fakeSessionPath = path.join(sessionDir, "test-session.jsonl");

    currentAgentConfig = {}; // tests mutate this before calling createSession

    activeToolsSpy = vi.fn();

    sessionManagerCreateMock.mockReturnValue({ getCwd: () => tmpDir });
    sessionManagerOpenMock.mockReturnValue({ getCwd: () => tmpDir });
    createAgentSessionMock.mockResolvedValue({
      session: {
        sessionManager: { getSessionFile: () => fakeSessionPath },
        subscribe: vi.fn(() => vi.fn()),
        model: { id: "test-model", name: "test-model" },
        setActiveToolsByName: activeToolsSpy,
      },
    });

    const agent = {
      id: "test",
      agentDir,
      sessionDir,
      tools: ALL_TOOL_OBJS,
      get config() { return currentAgentConfig; },
      setMemoryEnabled: vi.fn(),
      buildSystemPrompt: () => "mock-prompt",
      memoryEnabled: true,
    };

    coord = new SessionCoordinator({
      agentsDir: path.join(tmpDir, "agents"),
      getAgent: () => agent,
      getActiveAgentId: () => "test",
      getModels: () => ({
        currentModel: { id: "test-model", name: "test-model" },
        authStorage: {},
        modelRegistry: {},
        resolveThinkingLevel: () => "medium",
      }),
      getResourceLoader: () => ({
        getSystemPrompt: () => "mock-prompt",
        getAppendSystemPrompt: () => [],
      }),
      getSkills: () => null,
      buildTools: () => ({ tools: [], customTools: ALL_TOOL_OBJS }),
      emitEvent: vi.fn(),
      getHomeCwd: () => tmpDir,
      agentIdFromSessionPath: () => "test",
      switchAgentOnly: async () => {},
      getConfig: () => ({}),
      getPrefs: () => ({ getThinkingLevel: () => "medium" }),
      getAgents: () => new Map(),
      getActivityStore: () => null,
      getAgentById: () => null,
      listAgents: () => [],
      getDeferredResultStore: () => null,
    });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── Case C tests ─────────────────────────────────────────────

  it("Case C: new session with empty disabled includes all tools in snapshot", async () => {
    currentAgentConfig = { tools: { disabled: [] } };
    const { sessionPath } = await coord.createSession(null, tmpDir, true);

    // setActiveToolsByName should have been called with the full list
    expect(activeToolsSpy).toHaveBeenCalledTimes(1);
    const appliedList = activeToolsSpy.mock.calls[0][0];
    expect(appliedList).toEqual(allNames());

    // sessionEntry.toolNames should match
    const entry = coord._sessions.get(sessionPath);
    expect(entry.toolNames).toEqual(allNames());

    // Persisted to meta
    const meta = JSON.parse(await fsp.readFile(path.join(sessionDir, "session-meta.json"), "utf-8"));
    expect(meta[path.basename(fakeSessionPath)].toolNames).toEqual(allNames());
  });

  it("Case C: browser disabled is excluded from snapshot", async () => {
    currentAgentConfig = { tools: { disabled: ["browser"] } };
    await coord.createSession(null, tmpDir, true);

    const appliedList = activeToolsSpy.mock.calls[0][0];
    expect(appliedList).not.toContain("browser");
    expect(appliedList).toContain("cron");
    expect(appliedList).toContain("read");
  });

  it("Case C: tampering with core tool name still keeps it (subset tamper protection)", async () => {
    currentAgentConfig = { tools: { disabled: ["browser", "read"] } };
    await coord.createSession(null, tmpDir, true);

    const appliedList = activeToolsSpy.mock.calls[0][0];
    expect(appliedList).toContain("read");  // core tool preserved
    expect(appliedList).not.toContain("browser");  // optional tool excluded
  });

  it("Case C: persists toolNames to session-meta.json", async () => {
    currentAgentConfig = { tools: { disabled: ["browser", "cron"] } };
    await coord.createSession(null, tmpDir, true);

    const meta = JSON.parse(await fsp.readFile(path.join(sessionDir, "session-meta.json"), "utf-8"));
    const persisted = meta[path.basename(fakeSessionPath)].toolNames;
    expect(persisted).not.toContain("browser");
    expect(persisted).not.toContain("cron");
    expect(persisted).toContain("dm");
    expect(persisted).toContain("install_skill");
  });

  // ── Case A tests ─────────────────────────────────────────────

  it("Case A: restore with meta containing toolNames replays that exact snapshot", async () => {
    // Pre-write meta with a specific short snapshot
    const replayList = ["read", "bash", "edit", "todo_write"];
    const metaPath = path.join(sessionDir, "session-meta.json");
    await fsp.writeFile(
      metaPath,
      JSON.stringify({ [path.basename(fakeSessionPath)]: { toolNames: replayList } }, null, 2),
    );

    await coord.createSession(null, tmpDir, true, null, { restore: true });

    expect(activeToolsSpy).toHaveBeenCalledTimes(1);
    expect(activeToolsSpy.mock.calls[0][0]).toEqual(replayList);
  });

  // ── Case B tests ─────────────────────────────────────────────

  it("Case B: restore with meta missing toolNames does NOT call setActiveToolsByName", async () => {
    // Pre-write meta WITHOUT toolNames
    const metaPath = path.join(sessionDir, "session-meta.json");
    await fsp.writeFile(
      metaPath,
      JSON.stringify({ [path.basename(fakeSessionPath)]: { memoryEnabled: true } }, null, 2),
    );

    const { sessionPath } = await coord.createSession(null, tmpDir, true, null, { restore: true });

    expect(activeToolsSpy).not.toHaveBeenCalled();

    // sessionEntry.toolNames is null (not undefined, not [])
    const entry = coord._sessions.get(sessionPath);
    expect(entry.toolNames).toBeNull();
  });

  it("Case B: restore when session-meta.json doesn't exist also keeps all tools", async () => {
    // No meta file on disk
    const { sessionPath } = await coord.createSession(null, tmpDir, true, null, { restore: true });

    expect(activeToolsSpy).not.toHaveBeenCalled();
    const entry = coord._sessions.get(sessionPath);
    expect(entry.toolNames).toBeNull();
  });
});
