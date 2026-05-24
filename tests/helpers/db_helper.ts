/**
 * Test helpers — truncate tables + flush cache between tests.
 *
 * Use Lucid Model Factories (database/factories/) to create test data
 * instead of direct db.table().insert() calls.
 */
import db from '@adonisjs/lucid/services/db'
import cache from '@adonisjs/cache/services/main'
import { DateTime } from 'luxon'

/**
 * Delete all rows from test tables AND clear the Bentocache (L1 + L2).
 *
 * Must be called in group.each.setup() to prevent cache keys from leaking
 * between tests (the products list cache would return stale data otherwise).
 */
export async function truncateTables(): Promise<void> {
  await db.from('orders').delete()
  await db.from('stock_reservations').delete()
  await db.from('stocks').delete()
  await db.from('products').delete()

  // Clear ALL cache entries (both L1 in-memory and L2 Redis)
  await cache.clear()
}

/**
 * Physical stock quantity — the number stored in the stocks table.
 * This does NOT decrease until ERP billing commits the reservation.
 * Use getAvailableQuantity() to check what's actually purchasable.
 */
export async function getStockQuantity(productId: string): Promise<number> {
  const row = await db.from('stocks').where('product_id', productId).first()
  return row?.quantity ?? 0
}

/**
 * Available quantity = physical stock − active (non-released, non-expired) reservations.
 * This is what the checkout service uses to decide if a purchase can proceed.
 */
export async function getAvailableQuantity(productId: string): Promise<number> {
  const now = DateTime.now().toSQL({ includeOffset: false })

  const stockRow = await db.from('stocks').where('product_id', productId).first()
  if (!stockRow) return 0

  const reservedRow = await db
    .from('stock_reservations')
    .where('product_id', productId)
    .whereNull('released_at')
    .where('expires_at', '>', now)
    .sum('quantity as reserved')
    .first()

  return (stockRow.quantity ?? 0) - Number(reservedRow?.reserved ?? 0)
}

/**
 * Count active (non-released, non-expired) reservations for a product.
 */
export async function getActiveReservationCount(productId: string): Promise<number> {
  const now = DateTime.now().toSQL({ includeOffset: false })
  const row = await db
    .from('stock_reservations')
    .where('product_id', productId)
    .whereNull('released_at')
    .where('expires_at', '>', now)
    .count('* as count')
    .first()
  return Number(row?.count ?? 0)
}
