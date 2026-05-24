import { collectDefaultMetrics, Counter, Histogram, Gauge } from 'prom-client'

// ─── Default Node.js process metrics ────────────────────────────────────────
collectDefaultMetrics({ prefix: 'casecellshop_' })

// ─── Checkout ────────────────────────────────────────────────────────────────

/**
 * Counts every POST /checkout outcome.
 *
 * Labels:
 *   status = accepted          — new order created, 202 returned
 *   status = idempotent_replay — same Idempotency-Key seen again, cached 202 returned
 *   status = stock_unavailable — 409, not enough stock
 *   status = product_not_found — 404
 *   status = validation_error  — 422
 */
export const checkoutTotal = new Counter({
  name: 'casecellshop_checkout_total',
  help: 'Total checkout requests by outcome',
  labelNames: ['status'],
})

/**
 * End-to-end latency of POST /checkout (from validation to 202/error).
 * Helps detect slow atomic reservations or Redis round-trips.
 */
export const checkoutDuration = new Histogram({
  name: 'casecellshop_checkout_duration_seconds',
  help: 'Checkout request duration in seconds',
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
})

// ─── Cache ───────────────────────────────────────────────────────────────────

/**
 * Cache hit / miss / error per key type.
 *
 * Labels:
 *   result   = hit | miss
 *   key_type = products_list | products_item
 *
 * Monitor hit_rate = hit / (hit + miss).  A drop signals TTL too short,
 * cache invalidation bug, or cold-start after a deploy.
 */
export const cacheOperations = new Counter({
  name: 'casecellshop_cache_operations_total',
  help: 'Cache hit/miss operations by key type',
  labelNames: ['result', 'key_type'],
})

// ─── Queue / Worker ──────────────────────────────────────────────────────────

/**
 * Current depth of the BullMQ checkout queue (waiting + delayed jobs).
 * A sustained high value indicates the worker is falling behind.
 */
export const queueDepth = new Gauge({
  name: 'casecellshop_queue_depth',
  help: 'Current BullMQ queue depth (waiting + delayed)',
  labelNames: ['queue'],
})

/**
 * Counts BullMQ job completions by job name and result.
 *
 * Labels:
 *   queue    = checkout
 *   job_name = process-payment | process-billing
 *   result   = completed | failed | payment_failed | card_declined | erp_declined
 */
export const jobsProcessed = new Counter({
  name: 'casecellshop_jobs_processed_total',
  help: 'BullMQ jobs processed by queue, job name, and result',
  labelNames: ['queue', 'job_name', 'result'],
})
