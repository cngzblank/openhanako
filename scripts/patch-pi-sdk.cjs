/**
 * patch-pi-sdk.cjs — postinstall 补丁
 *
 * 修复 Pi SDK createAgentSession() 没有把 options.tools 作为
 * baseToolsOverride 传给 AgentSession 的问题。
 *
 * AgentSession 本身支持 baseToolsOverride，但 createAgentSession()
 * 只取了 tool name 列表，丢弃了实际的 tool 对象，导致 session
 * 回退到 SDK 内置默认工具。Windows 上内置 bash 工具找不到 shell，
 * 所有命令返回 exit code 1 + 空输出。
 *
 * See: https://github.com/anthropics/openhanako/issues/221
 */

const fs = require("fs");
const path = require("path");

const target = path.join(
  __dirname, "..",
  "node_modules", "@mariozechner", "pi-coding-agent",
  "dist", "core", "sdk.js"
);

if (!fs.existsSync(target)) {
  console.log("[patch-pi-sdk] sdk.js not found, skipping");
  process.exit(0);
}

let code = fs.readFileSync(target, "utf8");

if (code.includes("baseToolsOverride")) {
  console.log("[patch-pi-sdk] sdk.js already patched, skipping patch 1");
} else {

const needle = "        initialActiveToolNames,\n        extensionRunnerRef,";
const replacement =
  "        initialActiveToolNames,\n" +
  "        baseToolsOverride: options.tools\n" +
  "            ? Object.fromEntries(options.tools.map(t => [t.name, t]))\n" +
  "            : undefined,\n" +
  "        extensionRunnerRef,";

if (!code.includes(needle)) {
  console.warn(
    "[patch-pi-sdk] sdk.js structure changed, cannot apply patch 1 " +
    "— custom bash tools may not work on Windows"
  );
} else {

  code = code.replace(needle, replacement);
  fs.writeFileSync(target, code, "utf8");
  console.log("[patch-pi-sdk] patched createAgentSession → baseToolsOverride wired through");
}}

// ── Patch 2: pi-ai openai-completions.js ──
// dashscope/volcengine 等 API 不接受 tools: []（空数组返回 400）。
// Pi SDK 在对话历史有 tool_calls 但当前 turn 无工具时发 tools: []，
// 这是为了兼容 Anthropic proxy，但对其他 API 有害。
// 补丁：发请求前删除空 tools 数组。
const completionsTarget = path.join(
  __dirname, "..",
  "node_modules", "@mariozechner", "pi-ai",
  "dist", "providers", "openai-completions.js"
);

if (fs.existsSync(completionsTarget)) {
  let completionsCode = fs.readFileSync(completionsTarget, "utf8");

  if (completionsCode.includes("/* patched: strip empty tools */")) {
    console.log("[patch-pi-sdk] openai-completions.js already patched, skipping");
  } else {
    // 在 tools: [] 赋值之后，tool_choice 赋值之前，插入清理逻辑
    const toolsNeedle = '        params.tools = [];\n    }\n    if (options?.toolChoice) {';
    const toolsReplacement =
      '        params.tools = [];\n    }\n' +
      '    /* patched: strip empty tools */\n' +
      '    if (Array.isArray(params.tools) && params.tools.length === 0) {\n' +
      '        delete params.tools;\n' +
      '    }\n' +
      '    if (options?.toolChoice) {';

    if (completionsCode.includes(toolsNeedle)) {
      completionsCode = completionsCode.replace(toolsNeedle, toolsReplacement);
      fs.writeFileSync(completionsTarget, completionsCode, "utf8");
      console.log("[patch-pi-sdk] patched openai-completions.js → strip empty tools array");
    } else {
      console.warn("[patch-pi-sdk] openai-completions.js structure changed, cannot apply empty-tools patch");
    }
  }
} else {
  console.log("[patch-pi-sdk] openai-completions.js not found, skipping");
}
