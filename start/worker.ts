import { Worker } from 'bullmq'
import { DateTime } from 'luxon'
import { bullmqConnection } from '#start/bullmq_connection'
import db from '@adonisjs/lucid/services/db'
import cache from '@adonisjs/cache/services/main'
import logger from '@adonisjs/core/services/logger'
import app from '@adonisjs/core/services/app'
import PaymentService from '#services/payment_service'
import { checkoutQueue } from '#start/queue'
import { jobsProcessed } from '#start/metrics'

/**
 * BullMQ Worker — Saga orchestrator for the checkout flow.
 *
 * Two job types handled by the same worker (same queue):
 *
 *   process-payment  (Saga Step 1)
 *     Mock payment gateway. On success, enqueues process-billing.
 *     Non-retryable failure (card declined) → PAYMENT_FAILED, reservation kept
 *       for RESERVATION_EXPIRY_MINUTES so the user can retry with another method.
 *     Retryable failure → BullMQ retries; on exhaustion → PAYMENT_FAILED +
 *       reservation released immediately.
 *
 *   process-billing  (Saga Step 2)
 *     Mock ERP billing. On success, commits stock (real decrement) and releases
 *     the reservation. On any failure → reservation released + FAILED.
 *
 * Compensation table:
 *   ┌─────────────────────────────┬──────────────────┬──────────────────────┐
 *   │ Failure                     │ Order status     │ Reservation          │
 *   ├─────────────────────────────┼──────────────────┼──────────────────────┤
 *   │ Card declined               │ PAYMENT_FAILED   │ Kept (retry window)  │
 *   │ Gateway 5xx, retries exhaust│ PAYMENT_FAILED   │ Released immediately │
 *   │ ERP billing declined        │ FAILED           │ Released immediately │
 *   │ ERP 5xx, retries exhausted  │ FAILED           │ Released immediately │
 *   └─────────────────────────────┴──────────────────┴──────────────────────┘
 */
if (app.getEnvironment() === 'web') {
  const payment = new PaymentService()
  const now = () => DateTime.now().toSQL({ includeOffset: false })

  // ─── helpers ──────────────────────────────────────────────────────────────

  async function releaseReservation(reservationId: string) {
    await db
      .from('stock_reservations')
      .where('id', reservationId)
      .whereNull('released_at')
      .update({ released_at: now(), updated_at: now() })
  }

  async function commitStock(
    productId: string,
    quantity: number,
    reservationId: string,
    orderId: string
  ) {
    // ── Why a transaction + idempotency guard? ───────────────────────────────
    //
    // BullMQ retries the ENTIRE job from scratch on failure — no checkpointing.
    // Without protection, a crash between "decrement stock" and "release
    // reservation" would cause a double-decrement on the next retry.
    //
    // Strategy: use the reservation as an idempotency guard inside a transaction.
    //
    //   First run:
    //     UPDATE stock_reservations SET released_at = NOW() WHERE released_at IS NULL
    //     → affects 1 row → proceed with stock decrement + CONFIRMED
    //
    //   Retry (reservation already committed):
    //     UPDATE ... WHERE released_at IS NULL → affects 0 rows → skip decrement
    //     → just re-set order to CONFIRMED (idempotent)
    //
    // The transaction ensures atomicity: if anything inside fails, the DB rolls
    // back entirely and the next retry sees released_at = NULL again → safe retry.
    // ─────────────────────────────────────────────────────────────────────────
    await db.transaction(async (trx) => {
      const released = await trx
        .from('stock_reservations')
        .where('id', reservationId)
        .whereNull('released_at')
        .update({ released_at: now(), updated_at: now() })

      if (!released) {
        // Reservation already released — BullMQ retry after a successful commit.
        // Stock was already decremented; just re-confirm the order and exit.
        logger.warn(
          { orderId, reservationId },
          'commitStock: reservation already released — idempotent retry, skipping decrement'
        )
        await trx.from('orders').where('id', orderId).update({ status: 'CONFIRMED', updated_at: now() })
        return
      }

      // First execution: decrement physical stock.
      // WHERE quantity >= quantity is a safety net against going negative.
      const affected = await trx
        .from('stocks')
        .where('product_id', productId)
        .where('quantity', '>=', quantity)
        .decrement('quantity', quantity)

      if (!affected) {
        logger.error(
          { productId, quantity, orderId },
          'commitStock: stock decrement affected 0 rows — out-of-band inconsistency'
        )
      }

      await trx.from('orders').where('id', orderId).update({ status: 'CONFIRMED', updated_at: now() })
    })

    // Cache invalidation is outside the transaction — cache is not transactional.
    // A stale list (products:list:*) for up to 5 min is acceptable; the single-
    // item view is busted immediately so GET /products/:id is always fresh.
    await cache.delete({ key: `products:item:${productId}` })
  }

  // ─── Step 1: payment ──────────────────────────────────────────────────────

  async function handlePayment(job: { id?: string; data: Record<string, any> }) {
    const { orderId, totalAmount } = job.data

    // ── PAID guard (idempotency checkpoint) ──────────────────────────────────
    // If a previous attempt already set the order to PAID (payment authorised)
    // but crashed before enqueuing the billing job, we skip the payment call
    // entirely and go straight to re-enqueuing billing. This prevents a duplicate
    // charge on retry.
    //
    // Two signals are checked — either alone is sufficient, but together they
    // cover edge cases where one might be inconsistent:
    //   • status = 'PAID'           → normal checkpoint (written with transaction_id atomically)
    //   • transaction_id IS NOT NULL → defence-in-depth: if status was somehow
    //                                  not updated but the gateway already charged,
    //                                  the stored transaction_id proves the charge occurred
    const currentOrder = await db.from('orders').where('id', orderId).select('status', 'transaction_id').first()
    if (currentOrder?.status === 'PAID' || currentOrder?.transaction_id) {
      logger.warn(
        { orderId, transactionId: currentOrder?.transaction_id },
        'handlePayment: payment already authorised — re-enqueuing billing (idempotent retry)'
      )
      await checkoutQueue.add(
        'process-billing',
        // Merge job.data (checkout base fields) with the persisted transactionId.
        // job.data does NOT carry transactionId (it's from the payment outcome, not
        // the original checkout payload), so we pull it from the DB — the source
        // of truth after a crash/retry.
        { ...job.data, transactionId: currentOrder?.transaction_id },
        { jobId: `billing-${orderId}`, attempts: 5, backoff: { type: 'exponential', delay: 1000 } }
      )
      return
    }

    await db.from('orders').where('id', orderId).update({
      status: 'PAYMENT_PROCESSING',
      erp_job_id: job.id,
      updated_at: now(),
    })

    const outcome = await payment.processPayment(orderId, totalAmount)

    if (!outcome.success) {
      if (outcome.retryable) {
        // Let BullMQ retry — throw so the job is marked failed
        logger.warn({ orderId }, 'Payment gateway error — will retry')
        throw new Error(outcome.failureReason)
      }

      // Non-retryable: card declined, keep reservation for retry window
      await db.from('orders').where('id', orderId).update({
        status: 'PAYMENT_FAILED',
        failure_reason: outcome.failureReason,
        updated_at: now(),
      })
      jobsProcessed.inc({ queue: 'checkout', job_name: 'process-payment', result: 'card_declined' })
      logger.warn({ orderId }, 'Payment declined — order PAYMENT_FAILED (reservation held for retry)')
      return // Do NOT throw — BullMQ must not retry a card decline
    }

    // ── Payment authorised ────────────────────────────────────────────────────
    // Persist PAID status + transaction_id BEFORE enqueuing billing.
    // This is the atomic checkpoint: if we crash after this UPDATE but before
    // checkoutQueue.add(), the next retry detects PAID / transaction_id above
    // and re-enqueues billing without re-charging the customer.
    // transaction_id is stored here so the order record carries the gateway
    // reference for reconciliation and eventual refunds.
    await db.from('orders').where('id', orderId).update({
      status: 'PAID',
      transaction_id: outcome.transactionId,
      updated_at: now(),
    })

    jobsProcessed.inc({ queue: 'checkout', job_name: 'process-payment', result: 'completed' })
    logger.info({ orderId, transactionId: outcome.transactionId }, 'Payment authorised — order PAID')

    await checkoutQueue.add(
      'process-billing',
      {
        // job.data carries all base fields from checkout (orderId, reservationId,
        // productId, productName, quantity, unitPrice, totalAmount, customerId).
        // transactionId is the only new field produced by the payment step —
        // placed last so it always wins over any future job.data addition.
        ...job.data,
        transactionId: outcome.transactionId,
      },
      {
        jobId: `billing-${orderId}`,
        attempts: 5,
        backoff: { type: 'exponential', delay: 1000 },
      }
    )
  }

  // ─── Step 2: ERP billing ──────────────────────────────────────────────────

  async function handleBilling(job: { id?: string; data: Record<string, any> }) {
    const { orderId, reservationId, productId, quantity } = job.data

    // ── Terminal state guard ─────────────────────────────────────────────────
    // BullMQ retries the entire job from scratch. If commitStock's transaction
    // already committed (order → CONFIRMED) but the process crashed before BullMQ
    // recorded the success, the retry would overwrite CONFIRMED with BILLING.
    // Checking the current status prevents that regression.
    const current = await db.from('orders').where('id', orderId).select('status').first()
    // Terminal states → already processed, skip entirely
    if (current?.status === 'CONFIRMED' || current?.status === 'FAILED') {
      logger.info(
        { orderId, status: current.status },
        'handleBilling: order already in terminal state — idempotent retry, skipping'
      )
      return
    }

    // Expected entry states: PAID (normal) or BILLING (retry mid-processing)
    // Any other state is unexpected — log a warning but proceed cautiously
    if (current?.status !== 'PAID' && current?.status !== 'BILLING') {
      logger.warn(
        { orderId, status: current?.status },
        'handleBilling: unexpected order status — expected PAID or BILLING'
      )
    }

    await db.from('orders').where('id', orderId).update({
      status: 'BILLING',
      erp_job_id: job.id,
      updated_at: now(),
    })

    // Mock ERP — failure rate controlled by ERP_FAILURE_RATE env (0-100)
    const failureRate = Number(process.env.ERP_FAILURE_RATE ?? 0) / 100
    const shouldFail = Math.random() < failureRate

    if (shouldFail) {
      const is4xx = Math.random() < 0.5
      if (is4xx) {
        // Business error: fail permanently
        await releaseReservation(reservationId)
        await db.from('orders').where('id', orderId).update({
          status: 'FAILED',
          failure_reason: 'ERP billing declined',
          updated_at: now(),
        })
        jobsProcessed.inc({ queue: 'checkout', job_name: 'process-billing', result: 'erp_declined' })
        logger.warn({ orderId }, 'ERP billing declined (4xx) — order FAILED, reservation released')
        return // Do NOT throw
      }
      throw new Error('ERP unavailable (simulated 5xx) — will retry')
    }

    // Success: commit stock + release reservation + mark CONFIRMED (atomic transaction inside commitStock)
    await commitStock(productId, quantity, reservationId, orderId)
    jobsProcessed.inc({ queue: 'checkout', job_name: 'process-billing', result: 'completed' })
    logger.info({ orderId }, 'ERP billing confirmed — order CONFIRMED, stock committed')
  }

  // ─── Worker ───────────────────────────────────────────────────────────────

  const worker = new Worker(
    'checkout',
    async (job) => {
      if (job.name === 'process-payment') {
        await handlePayment(job)
      } else if (job.name === 'process-billing') {
        await handleBilling(job)
      } else {
        logger.warn({ jobName: job.name }, 'Unknown job type — skipping')
      }
    },
    {
      connection: bullmqConnection,
      concurrency: 10,
    }
  )

  // ─── Retry exhaustion compensation ────────────────────────────────────────

  worker.on('failed', async (job, err) => {
    if (!job) return
    const isLastAttempt = job.attemptsMade >= (job.opts.attempts ?? 1)
    if (!isLastAttempt) return

    const { orderId, reservationId } = job.data

    if (job.name === 'process-payment') {
      // Gateway was down for all retries — release reservation
      await releaseReservation(reservationId)
      await db.from('orders').where('id', orderId).update({
        status: 'PAYMENT_FAILED',
        failure_reason: `Payment gateway unavailable after ${job.attemptsMade} attempts: ${err.message}`,
        updated_at: now(),
      })
      jobsProcessed.inc({ queue: 'checkout', job_name: 'process-payment', result: 'failed' })
      logger.error({ orderId, attempts: job.attemptsMade }, 'Payment retries exhausted — reservation released')
    } else if (job.name === 'process-billing') {
      // ERP was down for all retries — release reservation
      await releaseReservation(reservationId)
      await db.from('orders').where('id', orderId).update({
        status: 'FAILED',
        failure_reason: `ERP unavailable after ${job.attemptsMade} attempts: ${err.message}`,
        updated_at: now(),
      })
      jobsProcessed.inc({ queue: 'checkout', job_name: 'process-billing', result: 'failed' })
      // Sanity-net: ensure stock wasn't partially committed (it won't be, but log it)
      logger.error(
        { orderId, attempts: job.attemptsMade },
        'ERP billing retries exhausted — order FAILED, reservation released'
      )
    }
  })

  logger.info('BullMQ checkout worker started (Saga: payment → billing)')
}
