/**
 * Chat models for the buyer agent (§8.1). Both providers speak OpenAI-style chat completions with tool
 * calling: Muse Spark on the Meta Model API (the same model GlobalChain Muse runs on) and Groq. Plain
 * fetch, so tests can stub it and no SDK pins the request shape.
 */

export type ToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };
export type ContentPart = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };
export type ChatMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string | ContentPart[] }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };
export type ToolSpec = {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
};
export type Usage = { prompt_tokens: number; completion_tokens: number };

export interface ChatModel {
  readonly provider: "muse" | "groq";
  readonly model: string;
  chat(messages: ChatMessage[], tools: ToolSpec[]): Promise<{ message: Extract<ChatMessage, { role: "assistant" }>; usage: Usage }>;
}

type Options = {
  provider: ChatModel["provider"];
  baseUrl: string;
  apiKey: string;
  model: string;
  /** The Meta Model API takes instructions as the "developer" role; Groq uses "system". */
  instructionRole: "system" | "developer";
  extra?: Record<string, unknown>;
  timeoutMs?: number;
  fetch?: typeof fetch;
};

/** Failures before the request reached the server: safe to retry, nothing was sent or billed. */
const CONNECT_ERRORS = new Set(["UND_ERR_CONNECT_TIMEOUT", "ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "ENETUNREACH"]);

async function withConnectRetry(provider: string, send: () => Promise<Response>, tries = 3): Promise<Response> {
  for (let i = 1; ; i++) {
    try {
      return await send();
    } catch (e) {
      const err = e as Error & { cause?: { code?: string; message?: string } };
      if (i < tries && CONNECT_ERRORS.has(err.cause?.code ?? "")) continue;
      // undici reports network failures as "fetch failed"; the cause says why.
      throw new Error(`${provider}: ${err.message}${err.cause ? ` (${err.cause.code ?? err.cause.message})` : ""}`);
    }
  }
}

export function openAiCompatible(o: Options): ChatModel {
  const call = o.fetch ?? fetch;
  return {
    provider: o.provider,
    model: o.model,
    async chat(messages, tools) {
      const r = await withConnectRetry(o.provider, () => call(`${o.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${o.apiKey}` },
        body: JSON.stringify({
          model: o.model,
          messages: messages.map((m) => (m.role === "system" ? { ...m, role: o.instructionRole } : m)),
          tools,
          tool_choice: "auto",
          ...o.extra,
        }),
        signal: AbortSignal.timeout(o.timeoutMs ?? 60_000),
      }));
      if (!r.ok) throw new Error(`${o.provider} HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
      const body = await r.json();
      const m = body.choices?.[0]?.message;
      if (!m) throw new Error(`${o.provider}: no message in reply`);
      return {
        message: { role: "assistant", content: m.content ?? null, ...(m.tool_calls?.length ? { tool_calls: m.tool_calls } : {}) },
        usage: { prompt_tokens: body.usage?.prompt_tokens ?? 0, completion_tokens: body.usage?.completion_tokens ?? 0 },
      };
    },
  };
}

/**
 * The models the buyer agent tries, in order: Muse Spark when MODEL_API_KEY is set, then Groq when
 * GROQ_API_KEY is set. A failed turn moves to the next one; with none left the scripted engine runs.
 * AGENT_PROVIDER (muse, groq or scripted) pins a single choice.
 */
const museModel = (env: Record<string, string | undefined>, model = env.MUSE_MODEL ?? "muse-spark-1.3") => openAiCompatible({
  provider: "muse", baseUrl: env.META_API_BASE ?? "https://api.meta.ai/v1", apiKey: env.MODEL_API_KEY!,
  model, instructionRole: "developer",
  extra: { reasoning_effort: env.REASONING_EFFORT ?? "medium" },
  // Muse Spark reasons before it answers; a turn can take over a minute.
  timeoutMs: Number(env.MUSE_TIMEOUT_MS ?? 120_000),
});
const groqModel = (env: Record<string, string | undefined>, model = env.GROQ_MODEL ?? "openai/gpt-oss-120b") => openAiCompatible({
  provider: "groq", baseUrl: "https://api.groq.com/openai/v1", apiKey: env.GROQ_API_KEY!, model, instructionRole: "system",
});

export function modelsFromEnv(env: Record<string, string | undefined> = process.env): ChatModel[] {
  switch (env.AGENT_PROVIDER) {
    case "scripted": return [];
    case "muse":
      if (!env.MODEL_API_KEY) throw new Error("AGENT_PROVIDER=muse needs MODEL_API_KEY (Meta Model API)");
      return [museModel(env)];
    case "groq":
      if (!env.GROQ_API_KEY) throw new Error("AGENT_PROVIDER=groq needs GROQ_API_KEY");
      return [groqModel(env)];
    case undefined: case "":
      return [...(env.MODEL_API_KEY ? [museModel(env)] : []), ...(env.GROQ_API_KEY ? [groqModel(env)] : [])];
    default: throw new Error(`unknown AGENT_PROVIDER ${env.AGENT_PROVIDER}`);
  }
}

/**
 * The model that compares photos, only when PHOTO_MODEL asks for one: each comparison sends images, so it
 * costs more than a text turn. "muse" is Muse Spark; "groq" is a Qwen vision model on Groq's free tier.
 */
export function visionModelFromEnv(env: Record<string, string | undefined> = process.env): ChatModel | null {
  switch (env.PHOTO_MODEL) {
    case undefined: case "": case "off": return null;
    case "muse":
      if (!env.MODEL_API_KEY) throw new Error("PHOTO_MODEL=muse needs MODEL_API_KEY (Meta Model API)");
      return museModel(env, env.MUSE_VISION_MODEL ?? env.MUSE_MODEL ?? "muse-spark-1.3");
    case "groq":
      if (!env.GROQ_API_KEY) throw new Error("PHOTO_MODEL=groq needs GROQ_API_KEY");
      return groqModel(env, env.GROQ_VISION_MODEL ?? "qwen/qwen3.8-27b");
    default: throw new Error(`unknown PHOTO_MODEL ${env.PHOTO_MODEL}`);
  }
}
