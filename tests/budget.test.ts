import { describe, expect, it } from "vitest";

import { budgeted, capMuse, spendModelCall } from "@/server/agents/budget";
import type { ChatModel } from "@/server/agents/llm";
import { openDb } from "@/server/db";

const fake = (provider: ChatModel["provider"]): ChatModel & { calls: number } => ({
  provider, model: "m", calls: 0,
  async chat() {
    this.calls++;
    return { message: { role: "assistant", content: "hi" }, usage: { prompt_tokens: 1, completion_tokens: 1 } };
  },
});

describe("daily model budget", () => {
  it("counts calls per day in the database and refuses past the cap", async () => {
    const db = await openDb();
    const day = new Date("2026-11-03T10:00:00Z");
    await spendModelCall(db, "muse", 2, day);
    await spendModelCall(db, "muse", 2, day);
    await expect(spendModelCall(db, "muse", 2, day)).rejects.toThrow("used up");
    await spendModelCall(db, "muse", 2, new Date("2026-11-04T00:00:01Z")); // a new day starts over
    await spendModelCall(db, "groq", 2, day); // providers are counted separately
  });

  it("fails before calling the model, so the agent moves to its next one", async () => {
    const m = fake("muse");
    const capped = budgeted(m, async () => { throw new Error("muse: used up"); });
    await expect(capped.chat([], [])).rejects.toThrow("used up");
    expect(m.calls).toBe(0);
  });

  it("caps Muse Spark only, and only when a limit is set", async () => {
    const db = await openDb();
    const muse = fake("muse"), groq = fake("groq");
    expect(capMuse(db, undefined)(muse)).toBe(muse);
    expect(capMuse(db, 1)(groq)).toBe(groq);
    const capped = capMuse(db, 1)(muse);
    await capped.chat([], []);
    await expect(capped.chat([], [])).rejects.toThrow("used up");
    expect(muse.calls).toBe(1);
  });
});
