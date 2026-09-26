import "server-only";

/**
 * AI provider abstraction (not active in Phase 1).
 *
 * Rules for every AI feature (AI assistant, pricing assistant, email intake):
 * - AI is a helper, never an autonomous decision-maker.
 * - Answers must come from real database records passed in as context; cite them.
 * - Never invent financial figures. If there is no data, say so.
 * - Never send prices, emails or invoices to customers without human approval.
 */
export type AIMessage = { role: "user" | "assistant"; content: string };

export interface AIProvider {
  readonly name: string;
  complete(opts: { system: string; messages: AIMessage[]; maxTokens?: number }): Promise<string>;
  /** For semantic search of past jobs later (pgvector). */
  embed?(texts: string[]): Promise<number[][]>;
}

export function aiProvider(): AIProvider | null {
  const p = process.env.AI_PROVIDER ?? "none";
  if (p === "none") return null;
  // Future: AnthropicProvider using ANTHROPIC_API_KEY — keep the model id in config, not code.
  return null;
}
