/** Fixed-window rate limit per key. In memory, so per instance: enough to stop a burst, not a quota. */
const windows = new Map<string, { start: number; n: number }>();

export function rateLimited(key: string, limit: number, windowMs = 60_000, now = Date.now()): boolean {
  const w = windows.get(key);
  if (!w || now - w.start > windowMs) {
    if (windows.size > 10_000) windows.clear();
    windows.set(key, { start: now, n: 1 });
    return false;
  }
  return ++w.n > limit;
}

export function clientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0].trim() || req.headers.get("x-real-ip") || "local";
}
