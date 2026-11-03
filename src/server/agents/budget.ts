import { sql } from "drizzle-orm";

import type { Db } from "../db";
import { schema } from "../db";
import type { ChatModel } from "./llm";

/**
 * A daily cap on paid model calls (MODEL_CALLS_PER_DAY), counted in the database so every serverless
 * instance shares it. Past the cap a call fails before anything is sent, so the agent moves on to its
 * next model (Groq) or the scripted engine, as it does for any failed turn.
 */
export async function spendModelCall(db: Db, provider: string, limit: number, now = new Date()): Promise<void> {
  const day = now.toISOString().slice(0, 10);
  const [row] = await db.insert(schema.modelUsage).values({ day, provider, calls: 1 })
    .onConflictDoUpdate({ target: [schema.modelUsage.day, schema.modelUsage.provider],
      set: { calls: sql`${schema.modelUsage.calls} + 1` } })
    .returning({ calls: schema.modelUsage.calls });
  if (row.calls > limit) throw new Error(`${provider}: today's ${limit} model calls are used up`);
}

/** The model, with each call counted against the day's cap first. */
export function budgeted(model: ChatModel, spend: () => Promise<void>): ChatModel {
  return {
    provider: model.provider,
    model: model.model,
    async chat(messages, tools) {
      await spend();
      return model.chat(messages, tools);
    },
  };
}

/** Caps the Muse Spark models when MODEL_CALLS_PER_DAY is set; Groq's free tier is left alone. */
export function capMuse(db: Db, limit: number | undefined) {
  return (m: ChatModel): ChatModel =>
    limit && m.provider === "muse" ? budgeted(m, () => spendModelCall(db, m.provider, limit)) : m;
}
