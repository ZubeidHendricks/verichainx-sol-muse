/** How a run's engine reads to people: "muse:muse-spark-1.3" is Muse Spark, Meta's model; Groq is the fallback. */
export function engineLabel(engine: string | null | undefined): string {
  if (!engine) return "";
  if (engine === "scripted") return "built-in rules";
  const [provider, model] = engine.split(":");
  if (provider === "muse") return `Muse Spark (Meta) · ${model}`;
  if (provider === "groq") return `Groq fallback · ${model}`;
  return engine;
}
