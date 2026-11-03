import { describe, expect, it } from "vitest";

import { engineLabel } from "@/lib/engine";

describe("engineLabel", () => {
  it("names Muse Spark, the Groq fallback and the built-in rules", () => {
    expect(engineLabel("muse:muse-spark-1.3")).toBe("Muse Spark (Meta) · muse-spark-1.3");
    expect(engineLabel("groq:openai/gpt-oss-120b")).toBe("Groq fallback · openai/gpt-oss-120b");
    expect(engineLabel("scripted")).toBe("built-in rules");
    expect(engineLabel(null)).toBe("");
  });
});
