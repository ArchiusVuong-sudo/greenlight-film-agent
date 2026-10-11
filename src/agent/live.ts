import { createSdkMcpServer, query, tool, type SDKMessage, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { childEnv } from "./detect";
import { AuthError, RetryableError, ZERO_USAGE, type AgentProvider, type AgentRunParams, type TurnRecord, type Usage } from "./provider";
import { isAuthError, isRetryable } from "./retry";

export const SERVER_NAME = "studio";
const PREFIX = `mcp__${SERVER_NAME}__`;

/**
 * The Claude Agent SDK on the local Claude Code login (or ANTHROPIC_API_KEY).
 * Locked down: no built-in tools, only the studio tools, no settings files, no other MCP
 * servers, no saved session, a fresh temp cwd, bounded turns and an allowlisted env.
 */
export class LiveProvider implements AgentProvider {
  readonly name = "live" as const;

  async run(p: AgentRunParams): Promise<void> {
    let mark = Date.now();
    let current: { id: string; turn: TurnRecord; started: number } | null = null;
    const flush = () => {
      if (!current) return;
      current.turn.durationMs = Date.now() - mark;
      p.hooks.onTurn(current.turn);
      mark = Date.now();
      current = null;
    };
    const server = createSdkMcpServer({
      name: SERVER_NAME,
      version: "0.1.0",
      alwaysLoad: true,
      tools: p.tools.map((t) =>
        tool(t.name, t.description, t.shape, async (args) => {
          flush(); // log the model turn before the tool call it made
          const r = await t.call(args);
          mark = Date.now(); // the next turn's time starts when the tool result goes back
          return { content: [{ type: "text" as const, text: r.text }], isError: r.isError };
        }),
      ),
    });

    async function* prompts(): AsyncIterable<SDKUserMessage> {
      for await (const text of p.inputs) {
        mark = Date.now();
        yield { type: "user", message: { role: "user", content: text }, parent_tool_use_id: null };
      }
    }

    const cwd = mkdtempSync(join(tmpdir(), "greenlight-run-"));
    const q = query({
      prompt: prompts(),
      options: {
        systemPrompt: p.system,
        tools: [],
        allowedTools: p.tools.map((t) => `${PREFIX}${t.name}`),
        mcpServers: { [SERVER_NAME]: server },
        strictMcpConfig: true,
        settingSources: [],
        persistSession: false,
        permissionMode: "dontAsk",
        cwd,
        maxTurns: p.maxTurns,
        env: childEnv(),
        ...(p.model ? { model: p.model } : {}),
      },
    });


    try {
      for await (const m of q as AsyncIterable<SDKMessage>) {
        if (m.type === "system" && m.subtype === "init") {
          p.hooks.onSession({ sessionId: m.session_id, model: m.model });
        } else if (m.type === "assistant" && m.parent_tool_use_id === null) {
          if (m.error) {
            const msg = `Model error: ${m.error}`;
            if (m.error === "authentication_failed" || m.error === "oauth_org_not_allowed") throw new AuthError(msg);
            if (m.error === "rate_limit" || m.error === "overloaded" || m.error === "server_error") throw new RetryableError(msg);
          }
          const id = m.message.id;
          if (current && current.id !== id) flush();
          if (!current) current = { id, started: Date.now(), turn: { text: "", toolCalls: [], usage: { ...ZERO_USAGE }, durationMs: 0 } };
          for (const block of m.message.content) {
            if (block.type === "text") current.turn.text += (current.turn.text ? "\n" : "") + block.text;
            else if (block.type === "tool_use") current.turn.toolCalls.push({ name: block.name.replace(PREFIX, ""), input: block.input });
          }
          const u = m.message.usage;
          if (u) current.turn.usage = { input: u.input_tokens ?? 0, output: u.output_tokens ?? 0, cacheRead: u.cache_read_input_tokens ?? 0, cacheWrite: u.cache_creation_input_tokens ?? 0 };
        } else if (m.type === "user") {
          flush();
        } else if (m.type === "result") {
          flush();
          const total: Usage = { ...ZERO_USAGE };
          for (const mu of Object.values(m.modelUsage ?? {})) {
            total.input += mu.inputTokens;
            total.output += mu.outputTokens;
            total.cacheRead += mu.cacheReadInputTokens;
            total.cacheWrite += mu.cacheCreationInputTokens;
          }
          const errors = m.subtype === "success" ? [] : m.errors;
          if (m.subtype !== "success") {
            const text = errors.join("; ") || m.subtype;
            if (isAuthError(text)) throw new AuthError(text);
            if (isRetryable(text)) throw new RetryableError(text);
          }
          p.hooks.onResult({ durationMs: m.duration_ms, totalUsage: total, costUsd: m.total_cost_usd ?? null, turns: m.num_turns, isError: m.is_error, errors });
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (e instanceof AuthError || e instanceof RetryableError) throw e;
      if (isAuthError(msg)) throw new AuthError(msg);
      if (isRetryable(msg)) throw new RetryableError(msg);
      throw e;
    } finally {
      q.close();
      rmSync(cwd, { recursive: true, force: true });
    }
  }
}
