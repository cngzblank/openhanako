/**
 * SubagentTaskRegistry — 子代理任务注册表
 *
 * 集中管理所有活跃子代理的 AbortController，
 * 供 REST API、工具、UI 统一调用 abort。
 */

export class SubagentTaskRegistry {
  constructor() {
    /** @type {Map<string, { controller: AbortController, parentSessionPath: string, aborted: boolean }>} */
    this._tasks = new Map();
  }

  /**
   * 注册一个子代理任务
   * @param {string} taskId
   * @param {{ controller: AbortController, parentSessionPath: string }} info
   */
  register(taskId, { controller, parentSessionPath }) {
    this._tasks.set(taskId, { controller, parentSessionPath, aborted: false });
  }

  /**
   * 终止子代理
   * @param {string} taskId
   * @returns {'aborted' | 'already_aborted' | 'not_found'}
   */
  abort(taskId) {
    const task = this._tasks.get(taskId);
    if (!task) return "not_found";
    if (task.aborted) return "already_aborted";
    task.aborted = true;
    task.controller.abort();
    return "aborted";
  }

  /**
   * 任务完成/失败后移除
   * @param {string} taskId
   */
  remove(taskId) {
    this._tasks.delete(taskId);
  }

  /**
   * 查询任务信息
   * @param {string} taskId
   * @returns {{ controller: AbortController, parentSessionPath: string, aborted: boolean } | null}
   */
  query(taskId) {
    return this._tasks.get(taskId) || null;
  }
}
