import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
  NEXTCLAW_MCP_TOOL_READ_NOTE,
  NEXTCLAW_MCP_TOOL_SEMANTIC_SEARCH,
  NEXTCLAW_MCP_TOOL_FETCH_URL,
  NEXTCLAW_MCP_TOOL_AUDIT_CONTENT,
  NEXTCLAW_MCP_TOOL_WEB_SEARCH,
} from "@/lib/nextclaw-mcp-constants";

const MCP_TOOL_NAMES = [
  NEXTCLAW_MCP_TOOL_READ_NOTE,
  NEXTCLAW_MCP_TOOL_SEMANTIC_SEARCH,
  NEXTCLAW_MCP_TOOL_WEB_SEARCH,
  NEXTCLAW_MCP_TOOL_FETCH_URL,
  NEXTCLAW_MCP_TOOL_AUDIT_CONTENT,
] as const;

export type NextClawMcpToolName = (typeof MCP_TOOL_NAMES)[number];

let client: Client | null = null;
/** 串行化 JSON-RPC，避免同一 stdio 上并发；同时保证 client 懒加载无竞态 */
let rpcChain: Promise<unknown> = Promise.resolve();

function isMcpGloballyEnabled(): boolean {
  const v = process.env.NEXTCLAW_MCP_ENABLED?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

function getKnowledgeEntryScript(): string {
  const preferred = process.env.NEXTCLAW_MCP_KNOWLEDGE_ENTRY?.trim();
  if (preferred) return preferred;

  // 旧兼容：如果你只配置了其中一个 server 的 entry，也能工作
  const web = process.env.NEXTCLAW_MCP_WEB_READER_ENTRY?.trim();
  const audit = process.env.NEXTCLAW_MCP_AUDITOR_ENTRY?.trim();
  if (web || audit) {
    throw new Error(
      "当前 MCP Client 采用单进程多工具模式。请把 NEXTCLAW_MCP_KNOWLEDGE_ENTRY 设为 mcp-servers/nextclaw-bridge/run.ts（或保持默认）。"
    );
  }

  return "mcp-servers/nextclaw-bridge/run.ts";
}

function getNpxCommand(): string {
  return process.platform === "win32" ? "npx.cmd" : "npx";
}

async function createConnectedClient(): Promise<Client> {
  const cwd = process.cwd();
  const script = getKnowledgeEntryScript();
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined) env[k] = v;
  }
  const transport = new StdioClientTransport({
    command: getNpxCommand(),
    args: ["tsx", script],
    cwd,
    stderr: "inherit",
    env,
  });
  const c = new Client({ name: "ima-claw-nextclaw", version: "0.1.0" });
  await c.connect(transport);
  return c;
}

async function getOrCreateClient(): Promise<Client> {
  if (client) return client;
  client = await createConnectedClient();
  return client;
}

async function resetClient(): Promise<void> {
  if (client) {
    try {
      await client.close();
    } catch {
      /* ignore */
    }
    client = null;
  }
}

function enqueueRpc<T>(fn: () => Promise<T>): Promise<T> {
  const run = rpcChain.then(fn, fn);
  rpcChain = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

export function nextClawMcpKnowledgeEnabled(): boolean {
  return isMcpGloballyEnabled();
}

/**
 * 调用同仓 nextclaw-knowledge MCP 工具（stdio 子进程）。
 * 需在仓库根目录启动 Next，且已安装 tsx；环境变量 NEXTCLAW_MCP_ENABLED=true。
 */
export async function callNextClawKnowledgeTool(
  toolName: NextClawMcpToolName,
  args: Record<string, unknown>
): Promise<{ ok: boolean; text: string; json: unknown | null; isError: boolean }> {
  if (!isMcpGloballyEnabled()) {
    throw new Error("NEXTCLAW_MCP_ENABLED is not set");
  }

  return enqueueRpc(async () => {
    try {
      const c = await getOrCreateClient();
      const res = await c.callTool({
        name: toolName,
        arguments: args,
      });
      const blocks = Array.isArray(res.content) ? res.content : [];
      const text = blocks
        .map((block: { type?: string; text?: string }) =>
          block.type === "text" && block.text ? block.text : ""
        )
        .join("")
        .trim();
      let json: unknown = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = null;
      }
      const payload = json as { ok?: boolean } | null;
      const ok = !!(payload && payload.ok === true) && !res.isError;
      return {
        ok,
        text,
        json,
        isError: !!res.isError,
      };
    } catch (e) {
      await resetClient();
      throw e;
    }
  });
}
