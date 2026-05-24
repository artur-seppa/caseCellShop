import app from '@adonisjs/core/services/app'
import logger from '@adonisjs/core/services/logger'
import db from '@adonisjs/lucid/services/db'
import { checkoutQueue } from '#start/queue'
import { DateTime } from 'luxon'

/**
 * Recovery Worker — runs on boot and every 5 minutes.
 *
 * Two responsibilities:
 *
 * 1. Release expired stock reservations
 *    Sets released_at = NOW() on reservations past their expires_at.
 *    Orders that are PENDING or PAYMENT_FAILED with an expired reservation
 *    are transitioned to EXPIRED (stock is effectively freed for new checkouts).
 *
 * 2. Re-enqueue orphaned PENDING orders
 *    An order is orphaned if status = PENDING, older than 5 min, and no active
 *    BullMQ job exists (worker crashed mid-flight). Re-enqueues process-payment
 *    so the saga can proceed — only if the reservation is still active.
 *
 * Only runs in the HTTP server environment (not in ace commands or tests).
 */
if (app.getEnvironment() === 'web') {
  const INTERVAL_MS = 5 * 60 * 1000 // 5 minutes
  const ORPHAN_THRESHOLD_MINUTES = 5

  const nowSql = () => DateTime.now().toSQL({ includeOffset: false })

  // ── 1. Release expired reservations ─────────────────────────────────────────

  async function releaseExpiredReservations() {
    const now = nowSql()

    const expired = await db
      .from('stock_reservations')
      .whereNull('released_at')
      .where('expires_at', '<', now)
      .select('id', 'order_id')

    if (!expired.length) return

    const reservationIds = expired.map((r: { id: string }) => r.id)
    const orderIds = expired.map((r: { order_id: string }) => r.order_id)

    await db
      .from('stock_reservations')
      .whereIn('id', reservationIds)
      .update({ released_at: now, updated_at: now })

    // Transition PENDING / PAYMENT_FAILED orders to EXPIRED
    await db
      .from('orders')
      .whereIn('id', orderIds)
      .whereIn('status', ['PENDING', 'PAYMENT_FAILED'])
      .update({
        status: 'EXPIRED',
        failure_reason: 'Stock reservation expired before payment was completed',
        updated_at: now,
      })

    logger.warn({ count: reservationIds.length }, 'Recovery: released expired stock reservations')
  }

  // ── 2. Re-enqueue orphaned PENDING orders ────────────────────────────────────

  async function recoverOrphanedOrders() {
    const cutoff = DateTime.now()
      .minus({ minutes: ORPHAN_THRESHOLD_MINUTES })
      .toSQL({ includeOffset: false })

    // Only re-enqueue if the reservation is still active (not expired/released)
    const orphans = await db
      .from('orders as o')
      .join('stock_reservations as r', (q) => {
        q.on('r.order_id', 'o.id').andOnNull('r.released_at')
      })
      .where('o.status', 'PENDING')
      .where('o.created_at', '<', cutoff)
      .where('r.expires_at', '>', nowSql())
      .select(
        'o.id',
        'o.customer_id',
        'o.product_id',
        'o.product_name',
        'o.quantity',
        'o.unit_price',
        'o.total_amount',
        'r.id as reservation_id'
      )

    if (!orphans.length) return

    logger.warn({ count: orphans.length }, 'Recovery: found orphaned PENDING orders')

    for (const order of orphans) {
      const jobId = `payment-${order.id}`

      const existingJob = await checkoutQueue.getJob(jobId)
      if (existingJob) {
        const state = await existingJob.getState()
        if (['completed', 'failed'].includes(state)) continue
        logger.debug({ orderId: order.id, jobState: state }, 'Recovery: job still active, skipping')
        continue
      }

      await checkoutQueue.add(
        'process-payment',
        {
          orderId: order.id,
          reservationId: order.reservation_id,
          productId: order.product_id,
          productName: order.product_name,
          quantity: order.quantity,
          unitPrice: order.unit_price,
          totalAmount: order.total_amount,
          customerId: order.customer_id,
        },
        {
          jobId,
          attempts: 3,
          backoff: { type: 'exponential', delay: 1000 },
        }
      )

      logger.warn({ orderId: order.id }, 'Recovery: re-enqueued orphaned order')
    }
  }

  async function runRecovery() {
    await releaseExpiredReservations()
    await recoverOrphanedOrders()
  }

  setImmediate(async () => {
    try {
      await runRecovery()
    } catch (err) {
      logger.error({ err }, 'Recovery: initial scan failed')
    }
  })

  setInterval(async () => {
    try {
      await runRecovery()
    } catch (err) {
      logger.error({ err }, 'Recovery: periodic scan failed')
    }
  }, INTERVAL_MS)

  logger.info('Recovery worker started (interval: 5min)')
}
