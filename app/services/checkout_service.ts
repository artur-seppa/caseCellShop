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

export interface CheckoutOutput {
  orderId: string
  status: 'PENDING'
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
    const cached = await this.idempotency.get<CheckoutOutput>(input.idempotencyKey)
    if (cached) {
      const conflict = new IdempotencyConflictException(
        'Duplicate request — returning cached response'
      )
      conflict.cachedResponse = cached
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

      const response: CheckoutOutput = {
        orderId,
        status: 'PENDING',
        message: 'Order received. Payment is being processed.',
        links: { status: `/orders/${orderId}` },
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
