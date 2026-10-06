import { randomUUID } from "node:crypto";
import Redis from "ioredis";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

import { MemoryCache, RedisCache, type Cache } from "./cache";

/**
 * Both implementations must behave the same. The Redis suite runs only when
 * TEST_REDIS_URL is set (e.g. redis://127.0.0.1:6379/15).
 */
const behavesLikeACache = (create: () => Cache) => {
  it("stores JSON values", async () => {
    const cache = create();

    await cache.set("k", { a: 1, at: "2024-01-01" }, 10);

    expect(await cache.get("k")).toEqual({ a: 1, at: "2024-01-01" });
    expect(await cache.get("missing")).toBeNull();
  });

  it("setIfAbsent stores only once", async () => {
    const cache = create();

    expect(await cache.setIfAbsent("once", 1, 10)).toBe(true);
    expect(await cache.setIfAbsent("once", 2, 10)).toBe(false);
    expect(await cache.get("once")).toBe(1);
  });

  it("deletes", async () => {
    const cache = create();

    await cache.set("gone", true, 10);
    await cache.delete("gone");

    expect(await cache.get("gone")).toBeNull();
  });
};

describe("MemoryCache", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  behavesLikeACache(() => new MemoryCache());

  it("expires entries after their TTL", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const cache = new MemoryCache();

    await cache.set("k", 1, 10);
    vi.setSystemTime(Date.now() + 11_000);

    expect(await cache.get("k")).toBeNull();
    expect(await cache.setIfAbsent("k", 2, 10)).toBe(true);
  });
});

const redisUrl = process.env.TEST_REDIS_URL;

describe.skipIf(!redisUrl)("RedisCache", () => {
  const redis = redisUrl ? new Redis(redisUrl) : undefined;

  afterAll(async () => {
    await redis?.quit();
  });

  // A fresh prefix per test keeps runs independent without flushing Redis.
  behavesLikeACache(() => new RedisCache(redis!, `test:${randomUUID()}:`));
});
