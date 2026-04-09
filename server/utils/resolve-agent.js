/**
 * Resolve target agent from request context.
 * Priority: query.agentId > params.agentId > engine.currentAgentId
 */

/** 读操作用：显式 ID 找不到时抛错；无 ID 时用焦点 agent */
export function resolveAgent(engine, c) {
  const explicit = c.req.query("agentId") || c.req.param("agentId");
  if (explicit) {
    const found = engine.getAgent(explicit);
    if (!found) throw new AgentNotFoundError(explicit);
    return found;
  }
  // 无显式 ID 时用焦点 agent（UI-layer default）
  return engine.getAgent(engine.currentAgentId) || engine.agent;
}

/** 写操作用：找不到时抛错，不做 fallback */
export function resolveAgentStrict(engine, c) {
  const explicit = c.req.query("agentId") || c.req.param("agentId");
  if (explicit) {
    const found = engine.getAgent(explicit);
    if (!found) throw new AgentNotFoundError(explicit);
    return found;
  }
  // 无显式 agentId 时用 currentAgentId，但也不做 fallback
  const agent = engine.getAgent(engine.currentAgentId);
  if (!agent) throw new AgentNotFoundError(engine.currentAgentId);
  return agent;
}

export class AgentNotFoundError extends Error {
  constructor(id) {
    super(`agent "${id}" not found`);
    this.name = "AgentNotFoundError";
    this.status = 404;
    this.agentId = id;
  }
}
