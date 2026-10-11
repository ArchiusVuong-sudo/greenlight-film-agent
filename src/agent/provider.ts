import type { BoundTool } from "./tools";

export interface Usage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export const ZERO_USAGE: Usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

export interface RecordedToolCall {
  name: string;
  input: unknown;
}

/** One model response: its text, the tool calls it made and what it cost. */
export interface TurnRecord {
  text: string;
  toolCalls: RecordedToolCall[];
  usage: Usage;
  durationMs: number;
}

/** End of one segment (the model ended its turn and waits for the next message). */
export interface SegmentResult {
  durationMs: number;
  /** Running totals for the session so far. */
  totalUsage: Usage;
  costUsd: number | null;
  turns: number;
  isError: boolean;
  errors: string[];
}

export interface AgentHooks {
  onSession: (info: { sessionId: string; model: string }) => void;
  onTurn: (turn: TurnRecord) => void;
  onResult: (result: SegmentResult) => void;
}

export interface AgentRunParams {
  system: string;
  /** User messages: the brief first, then director answers. Ends when the run is over. */
  inputs: AsyncIterable<string>;
  tools: BoundTool[];
  model?: string;
  maxTurns: number;
  hooks: AgentHooks;
}

export interface AgentProvider {
  readonly name: "live" | "replay";
  run(params: AgentRunParams): Promise<void>;
}

/** A recorded live run, replayed turn by turn through the same tools. */
export interface Fixture {
  briefId: string;
  recordedAt: string;
  model: string;
  segments: { input: string; turns: TurnRecord[]; result: SegmentResult }[];
}

export class RetryableError extends Error {}
export class AuthError extends Error {}
