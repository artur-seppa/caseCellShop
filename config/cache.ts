/**
 * Cache configuration — @adonisjs/cache (powered by Bentocache)
 *
 * Multi-tier architecture:
 *   L1 — in-memory (nanoseconds, per-process, LRU eviction)
 *   L2 — Redis      (milliseconds, shared across all instances)
 *
 * On L1 hit: returns immediately, zero network I/O.
 * On L1 miss / L2 hit: L2 responds, L1 is warm-filled for subsequent requests.
 * On L2 miss: factory is executed, result written to both layers.
 *
 * Stampede protection is built-in — Bentocache uses a distributed lock so only
 * ONE request rebuilds a given cache entry, even under high concurrency.
 */

import { defineConfig, store, drivers } from '@adonisjs/cache'

const cacheConfig = defineConfig({
  default: 'redis',

  stores: {
    /**
     * Two-tier store: memory (L1) + Redis (L2).
     * NOTE: do NOT call .entry() here — defineConfig accepts Store instances directly.
     */
    redis: store()
      .useL1Layer(drivers.memory({ maxSize: 5_000 }))
      .useL2Layer(drivers.redis({ connectionName: 'main' })),
  },
})

export default cacheConfig

declare module '@adonisjs/cache/types' {
  interface CacheStores extends Record<'redis', any> {}
}
