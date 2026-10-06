import type Redis from "ioredis";

/**
 * Key-value store with expiry for data that may be lost (cache entries,
 * idempotency records). Values are JSON-serialized.
 */
export interface Cache {
  get<T>(key: string): Promise<T | null>;
  set(key: string, value: unknown, ttlSeconds: number): Promise<void>;
  /** Stores the value only if the key is absent. Returns true when stored. */
  setIfAbsent(
    key: string,
    value: unknown,
    ttlSeconds: number,
  ): Promise<boolean>;
  delete(key: string): Promise<void>;
}

/**
 * Redis-backed cache, shared by every app instance.
 */
export class RedisCache implements Cache {
  constructor(
    private readonly redis: Redis,
    private readonly prefix = "cache:",
  ) {}

  async get<T>(key: string): Promise<T | null> {
    const value = await this.redis.get(this.prefix + key);
    return value === null ? null : (JSON.parse(value) as T);
  }

  async set(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    await this.redis.set(
      this.prefix + key,
      JSON.stringify(value),
      "EX",
      ttlSeconds,
    );
  }

  async setIfAbsent(
    key: string,
    value: unknown,
    ttlSeconds: number,
  ): Promise<boolean> {
    const result = await this.redis.set(
      this.prefix + key,
      JSON.stringify(value),
      "EX",
      ttlSeconds,
      "NX",
    );
    return result === "OK";
  }

  async delete(key: string): Promise<void> {
    await this.redis.del(this.prefix + key);
  }
}

const MAX_MEMORY_ENTRIES = 10_000;

/**
 * In-process cache for a single instance (development, tests). Values are
 * stored serialized, so callers get copies just like with Redis.
 */
export class MemoryCache implements Cache {
  private readonly entries = new Map<
    string,
    { value: string; expiresAt: number }
  >();

  async get<T>(key: string): Promise<T | null> {
    const entry = this.entries.get(key);

    if (!entry) return null;

    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(key);
      return null;
    }

    return JSON.parse(entry.value) as T;
  }

  async set(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    if (this.entries.size >= MAX_MEMORY_ENTRIES) this.evictExpired();

    this.entries.set(key, {
      value: JSON.stringify(value),
      expiresAt: Date.now() + ttlSeconds * 1000,
    });
  }

  async setIfAbsent(
    key: string,
    value: unknown,
    ttlSeconds: number,
  ): Promise<boolean> {
    if ((await this.get(key)) !== null) return false;

    await this.set(key, value, ttlSeconds);
    return true;
  }

  async delete(key: string): Promise<void> {
    this.entries.delete(key);
  }

  private evictExpired() {
    const now = Date.now();

    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(key);
    }

    // Still full of live entries: drop the oldest (Map keeps insert order).
    for (const key of this.entries.keys()) {
      if (this.entries.size < MAX_MEMORY_ENTRIES) break;
      this.entries.delete(key);
    }
  }
}
