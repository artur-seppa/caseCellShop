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

  async function commitStock(productId: string, quantity: number, reservationId: string) {
    // Real stock decrement — the reservation is now "consumed".
    // Use the same conditional-update pattern as a safety net.
    await db
      .from('stocks')
      .where('product_id', productId)
      .where('quantity', '>=', quantity)
      .decrement('quantity', quantity)

    await releaseReservation(reservationId)

    // Invalidate the product cache so GET /products reflects the new quantity.
    // The list cache (products:list:*) uses a per-filter key and would be
    // stale for up to LIST_TTL. We only bust the per-item key here; the list
    // cache will expire naturally (5 min TTL is acceptable staleness for a
    // catalogue listing, but a single-product view should always be fresh).
    await cache.delete({ key: `products:item:${productId}` })
  }

  // ─── Step 1: payment ──────────────────────────────────────────────────────

  async function handlePayment(job: { id?: string; data: Record<string, any> }) {
    const { orderId, reservationId, productId, quantity, totalAmount } = job.data

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
      logger.warn({ orderId }, `Payment declined — order PAYMENT_FAILED (reservation held for retry)`)
      return // Do NOT throw — BullMQ must not retry a card decline
    }

    // Payment authorised → enqueue ERP billing
    jobsProcessed.inc({ queue: 'checkout', job_name: 'process-payment', result: 'completed' })
    logger.info({ orderId, transactionId: outcome.transactionId }, 'Payment authorised')

    await checkoutQueue.add(
      'process-billing',
      {
        orderId,
        reservationId,
        productId,
        quantity,
        transactionId: outcome.transactionId,
        ...job.data,
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

    // Success: commit the stock and mark confirmed
    await commitStock(productId, quantity, reservationId)
    await db.from('orders').where('id', orderId).update({
      status: 'CONFIRMED',
      updated_at: now(),
    })
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
