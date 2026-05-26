import db from '@adonisjs/lucid/services/db'
import { DateTime } from 'luxon'
import { ulid } from 'ulid'
import IdempotencyService from '#services/idempotency_service'
import StockUnavailableException from '#exceptions/stock_unavailable_exception'
import IdempotencyConflictException from '#exceptions/idempotency_conflict_exception'
import ProductNotFoundException from '#exceptions/product_not_found_exception'
import Product from '#models/product'
import type { Queue } from 'bullmq'

export interface CheckoutInput {
  customerId: string
  productId: string
  quantity: number
  idempotencyKey: string
}

export type OrderStatus =
  | 'PENDING'
  | 'PAYMENT_PROCESSING'
  | 'PAID'               // payment authorised — waiting for ERP billing
  | 'BILLING'
  | 'CONFIRMED'
  | 'PAYMENT_FAILED'
  | 'FAILED'
  | 'EXPIRED'

export interface CheckoutOutput {
  orderId: string
  status: OrderStatus
  message: string
  links: { status: string }
}

/** How long the stock reservation is held while payment is being processed. */
const RESERVATION_EXPIRY_MINUTES = Number(process.env.RESERVATION_EXPIRY_MINUTES ?? 15)

export default class CheckoutService {
  constructor(
    private idempotency: IdempotencyService,
    private queue: Queue
  ) {}

  async execute(input: CheckoutInput): Promise<CheckoutOutput> {
    // ── 1. Idempotency check ────────────────────────────────────────────────
    // Redis holds the snapshot from order creation (always PENDING). On replay
    // we enrich it with the real current status from the DB so the client
    // isn't misled — a single indexed lookup on orders.id is fast enough.
    const cached = await this.idempotency.get<CheckoutOutput>(input.idempotencyKey)
    if (cached) {
      const current = await db
        .from('orders')
        .where('id', cached.orderId)
        .select('status')
        .first()

      const currentStatus = (current?.status ?? 'PENDING') as OrderStatus
      const freshResponse: CheckoutOutput = {
        orderId: cached.orderId,
        status: currentStatus,
        message:
          currentStatus === 'PENDING'
            ? 'Order received. Payment is being processed.'
            : `Order already exists (current state: ${currentStatus}). Check the status link for live updates.`,
        links: { status: `/api/v1/orders/${cached.orderId}` },
      }

      // Lazy cache update: if the order progressed beyond PENDING, write the
      // fresh status back to Redis so the next replay skips the DB lookup.
      if (currentStatus !== cached.status) {
        await this.idempotency.set(input.idempotencyKey, freshResponse)
      }

      const conflict = new IdempotencyConflictException(
        'Duplicate request — returning cached response'
      )
      conflict.cachedResponse = freshResponse
      throw conflict
    }

    // ── 2. In-flight lock (double-click race) ───────────────────────────────
    const locked = await this.idempotency.acquireLock(input.idempotencyKey)
    if (!locked) throw new IdempotencyConflictException('Request already in progress')

    try {
      // ── 3. Product lookup ─────────────────────────────────────────────────
      const product = await Product.find(input.productId)
      if (!product) throw new ProductNotFoundException(`Product '${input.productId}' not found`)

      const totalAmount = product.price * input.quantity
      const orderId = ulid()
      const reservationId = ulid()
      const now = DateTime.now().toSQL({ includeOffset: false })
      const expiresAt = DateTime.now()
        .plus({ minutes: RESERVATION_EXPIRY_MINUTES })
        .toSQL({ includeOffset: false })

      // ── 4. Saga Step 1: Create order + reserve stock atomically ─────────────
      //
      // The reservation uses INSERT…SELECT so the availability check (available
      // >= requested) and the INSERT happen in one SQL statement. This is
      // atomic: no TOCTOU window for concurrent checkouts.
      //
      // The order is inserted first because stock_reservations has FK → orders.
      // If the INSERT…SELECT finds no qualifying stock row (0 rows inserted),
      // we rollback and throw StockUnavailableException.
      //
      // Available = physical stock − active (non-released, non-expired) reservations.
      //
      // SQLite note: WAL mode (config/database.ts pool.afterCreate) lets readers
      // and writers run concurrently. The single-statement INSERT…SELECT is still
      // serialised by SQLite's write lock, giving correct oversell prevention.
      //
      // Production note: on PostgreSQL use SELECT … FOR UPDATE on stocks or
      // SERIALIZABLE isolation instead of the INSERT…SELECT trick.
      //
      // Redis-loss fallback: if the Redis idempotency cache was cleared/restarted,
      // the fast-path check above (step 1) returns nothing, and we fall through to
      // the INSERT. The UNIQUE constraint on orders.idempotency_key is the DB-level
      // safety net — we catch that error, fetch the existing order, re-populate the
      // cache, and return the original 202 instead of propagating a 500.
      try {
        await db.transaction(async (trx) => {
          // 4a. Insert order first (reservation FK requires it)
          await trx.table('orders').insert({
            id: orderId,
            customer_id: input.customerId,
            product_id: input.productId,
            product_name: product.name,
            quantity: input.quantity,
            unit_price: product.price,
            total_amount: totalAmount,
            status: 'PENDING',
            idempotency_key: input.idempotencyKey,
            erp_job_id: null,
            failure_reason: null,
            created_at: now,
            updated_at: now,
          })

          // 4b. Atomic reservation — INSERT…SELECT with inline availability check.
          //     If the WHERE condition is false (not enough stock), 0 rows inserted.
          await trx.rawQuery(
            `INSERT INTO stock_reservations
               (id, order_id, product_id, quantity, expires_at, released_at, created_at, updated_at)
             SELECT ?, ?, ?, ?, ?, NULL, ?, ?
             FROM stocks s
             WHERE s.product_id = ?
               AND (
                 s.quantity - COALESCE(
                   (SELECT SUM(r.quantity)
                    FROM stock_reservations r
                    WHERE r.product_id = s.product_id
                      AND r.released_at IS NULL
                      AND r.expires_at > ?),
                   0
                 )
               ) >= ?`,
            [
              reservationId, orderId, input.productId, input.quantity,
              expiresAt, now, now,
              // WHERE bindings:
              input.productId,
              now,
              input.quantity,
            ]
          )

          // 4c. Verify the reservation was created (better-sqlite3 doesn't expose
          //     rowsAffected reliably through Knex raw; a count is unambiguous).
          const check = await trx
            .from('stock_reservations')
            .where('id', reservationId)
            .count('* as cnt')
            .first()

          if (!Number(check?.cnt)) {
            throw new StockUnavailableException(`Insufficient stock for product '${input.productId}'`)
          }
        })
      } catch (err: any) {
        // ── Redis-loss fallback ───────────────────────────────────────────────
        // The idempotency fast-path (step 1) relies on Redis cache. If Redis was
        // restarted or flushed, the cache is empty and we fall through to the
        // INSERT. The UNIQUE constraint on orders.idempotency_key is the DB-level
        // safety net that prevents the double-insert.
        //
        // When that constraint fires, we recover gracefully:
        //   1. Fetch the existing order from the DB (source of truth)
        //   2. Re-populate Redis so the next retry hits the fast-path
        //   3. Return 202 as if nothing happened — client gets the same response
        //
        // All other errors (StockUnavailableException, ProductNotFoundException,
        // generic DB errors) are re-thrown and handled by the outer try/finally.
        // ─────────────────────────────────────────────────────────────────────
        const isIdempotencyConstraint =
          err.code === 'SQLITE_CONSTRAINT_UNIQUE' &&
          err.message?.includes('orders.idempotency_key')

        if (isIdempotencyConstraint) {
          const existing = await db
            .from('orders')
            .where('idempotency_key', input.idempotencyKey)
            .select('id', 'status')
            .first()

          if (existing) {
            // The order may have already progressed beyond PENDING while Redis
            // was down. We return the real current status from the DB so the
            // client isn't misled — the links.status URL is always authoritative.
            const currentStatus = existing.status as OrderStatus
            const recovered: CheckoutOutput = {
              orderId: existing.id,
              status: currentStatus,
              message:
                currentStatus === 'PENDING'
                  ? 'Order received. Payment is being processed.'
                  : `Order already exists (current state: ${currentStatus}). Check the status link for live updates.`,
              links: { status: `/api/v1/orders/${existing.id}` },
            }
            // Re-hydrate Redis so subsequent retries use the fast-path
            await this.idempotency.set(input.idempotencyKey, recovered)
            return recovered
          }
        }

        throw err
      }

      const response: CheckoutOutput = {
        orderId,
        status: 'PENDING',
        message: 'Order received. Payment is being processed.',
        links: { status: `/api/v1/orders/${orderId}` },
      }

      // ── 5. Cache idempotency response ─────────────────────────────────────
      await this.idempotency.set(input.idempotencyKey, response)

      // ── 6. Saga Step 2: Enqueue payment job ───────────────────────────────
      await this.queue.add(
        'process-payment',
        {
          orderId,
          reservationId,
          productId: input.productId,
          productName: product.name,
          quantity: input.quantity,
          unitPrice: product.price,
          totalAmount,
          customerId: input.customerId,
        },
        {
          jobId: `payment-${orderId}`,
          attempts: 3,
          backoff: { type: 'exponential', delay: 1000 },
        }
      )

      return response
    } finally {
      await this.idempotency.releaseLock(input.idempotencyKey)
    }
  }
}
