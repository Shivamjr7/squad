// Suggest Plan — tiny in-process LRU with per-entry TTL. Used as the 5-second
// micro-cache layer in front of Postgres-backed provider-cache, to absorb
// rapid duplicate calls within a single Vercel lambda invocation.
//
// Intentionally minimal — no concurrency primitives, no metrics, no priority.
// Reach for something heavier (e.g. lru-cache) if/when v2 actually needs it.

type Entry<V> = {
  value: V;
  expiresAt: number;
};

export class MemoryLRU<V> {
  private readonly max: number;
  private readonly map = new Map<string, Entry<V>>();

  constructor(opts: { max: number }) {
    if (opts.max < 1) throw new Error("MemoryLRU max must be ≥ 1.");
    this.max = opts.max;
  }

  get(key: string): V | undefined {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.map.delete(key);
      return undefined;
    }
    // Re-insert to refresh recency (Map preserves insertion order).
    this.map.delete(key);
    this.map.set(key, entry);
    return entry.value;
  }

  set(key: string, value: V, ttlMs: number): void {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, { value, expiresAt: Date.now() + ttlMs });
    while (this.map.size > this.max) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) break;
      this.map.delete(oldest);
    }
  }

  delete(key: string): void {
    this.map.delete(key);
  }

  size(): number {
    return this.map.size;
  }

  clear(): void {
    this.map.clear();
  }
}
