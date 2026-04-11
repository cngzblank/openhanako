import { describe, it, expect } from "vitest";
import { SubagentTaskRegistry } from "../lib/subagent-task-registry.js";

describe("SubagentTaskRegistry", () => {
  it("register + query returns task info", () => {
    const reg = new SubagentTaskRegistry();
    const controller = new AbortController();
    reg.register("t1", { controller, parentSessionPath: "/p1" });
    const task = reg.query("t1");
    expect(task).toBeTruthy();
    expect(task.parentSessionPath).toBe("/p1");
    expect(task.controller).toBe(controller);
  });

  it("abort signals the controller and returns 'aborted'", () => {
    const reg = new SubagentTaskRegistry();
    const controller = new AbortController();
    reg.register("t1", { controller, parentSessionPath: "/p1" });
    const result = reg.abort("t1");
    expect(result).toBe("aborted");
    expect(controller.signal.aborted).toBe(true);
  });

  it("abort on already-removed task returns 'not_found'", () => {
    const reg = new SubagentTaskRegistry();
    const controller = new AbortController();
    reg.register("t1", { controller, parentSessionPath: "/p1" });
    reg.remove("t1");
    const result = reg.abort("t1");
    expect(result).toBe("not_found");
  });

  it("abort on unknown taskId returns 'not_found'", () => {
    const reg = new SubagentTaskRegistry();
    expect(reg.abort("nope")).toBe("not_found");
  });

  it("double abort returns 'already_aborted'", () => {
    const reg = new SubagentTaskRegistry();
    const controller = new AbortController();
    reg.register("t1", { controller, parentSessionPath: "/p1" });
    reg.abort("t1");
    expect(reg.abort("t1")).toBe("already_aborted");
  });

  it("remove cleans up the task", () => {
    const reg = new SubagentTaskRegistry();
    const controller = new AbortController();
    reg.register("t1", { controller, parentSessionPath: "/p1" });
    reg.remove("t1");
    expect(reg.query("t1")).toBeNull();
  });
});
