import { test } from '@japa/runner'
import { ulid } from 'ulid'
import db from '@adonisjs/lucid/services/db'
import { ProductFactory } from '#factories/product_factory'
import { StockFactory } from '#factories/stock_factory'
import {
  getStockQuantity,
  getAvailableQuantity,
  getActiveReservationCount,
  truncateTables,
} from '#tests/helpers/db_helper'

/** Short alias — the with() callback receives a StockFactory builder instance */
type SF = typeof StockFactory

// A stable, valid ULID for the test customer (Crockford Base32 — no I, L, O, U)
const CUSTOMER_ID = '01JVMN000000000000000TEST01'

test.group('POST /api/v1/checkout', (group) => {
  group.each.setup(async () => {
    await truncateTables()
  })

  // ── Happy path ────────────────────────────────────────────────────────────

  test('returns 202 PENDING with orderId', async ({ client, assert }) => {
    const product = await ProductFactory.with('stock', 1, (s: SF) => s.merge({ quantity: 10 })).create()

    const response = await client
      .post('/api/v1/checkout')
      .header('Idempotency-Key', ulid())
      .json({ customerId: CUSTOMER_ID, productId: product.id, quantity: 1 })

    response.assertStatus(202)
    const body = response.body() as any
    assert.equal(body.status, 'PENDING')
    assert.exists(body.orderId)
    assert.exists(body.links?.status)
  })

  test('creates a stock reservation (physical stock unchanged until ERP confirms)', async ({
    client,
    assert,
  }) => {
    const product = await ProductFactory.with('stock', 1, (s: SF) => s.merge({ quantity: 10 })).create()

    await client
      .post('/api/v1/checkout')
      .header('Idempotency-Key', ulid())
      .json({ customerId: CUSTOMER_ID, productId: product.id, quantity: 3 })

    // Physical stock is NOT decremented yet — reservation pattern
    assert.equal(await getStockQuantity(product.id), 10, 'physical stock unchanged')

    // Available = physical − reserved
    assert.equal(await getAvailableQuantity(product.id), 7, 'available reduced by reserved quantity')

    // One active reservation exists
    assert.equal(await getActiveReservationCount(product.id), 1)
  })

  // ── Idempotency ───────────────────────────────────────────────────────────

  test('idempotent replay returns same orderId', async ({ client, assert }) => {
    const product = await ProductFactory.with('stock', 1, (s: SF) => s.merge({ quantity: 10 })).create()
    const key = ulid()

    const first = await client
      .post('/api/v1/checkout')
      .header('Idempotency-Key', key)
      .json({ customerId: CUSTOMER_ID, productId: product.id, quantity: 1 })

    const second = await client
      .post('/api/v1/checkout')
      .header('Idempotency-Key', key)
      .json({ customerId: CUSTOMER_ID, productId: product.id, quantity: 1 })

    first.assertStatus(202)
    second.assertStatus(202)
    assert.equal((first.body() as any).orderId, (second.body() as any).orderId)

    // Only one order and one reservation in DB
    const orders = await db.from('orders').count('* as count').first()
    assert.equal(Number(orders!.count), 1)

    assert.equal(await getActiveReservationCount(product.id), 1)
  })

  test('idempotent replay does not double-reserve stock', async ({ client, assert }) => {
    const product = await ProductFactory.with('stock', 1, (s: SF) => s.merge({ quantity: 10 })).create()
    const key = ulid()

    await client
      .post('/api/v1/checkout')
      .header('Idempotency-Key', key)
      .json({ customerId: CUSTOMER_ID, productId: product.id, quantity: 2 })

    await client
      .post('/api/v1/checkout')
      .header('Idempotency-Key', key)
      .json({ customerId: CUSTOMER_ID, productId: product.id, quantity: 2 })

    // Only 2 units should be reserved despite two requests
    assert.equal(await getAvailableQuantity(product.id), 8)
    assert.equal(await getActiveReservationCount(product.id), 1)
  })

  // ── Error cases ───────────────────────────────────────────────────────────

  test('returns 409 when stock is insufficient', async ({ client }) => {
    const product = await ProductFactory.with('stock', 1, (s: SF) => s.merge({ quantity: 2 })).create()

    const response = await client
      .post('/api/v1/checkout')
      .header('Idempotency-Key', ulid())
      .json({ customerId: CUSTOMER_ID, productId: product.id, quantity: 5 })

    response.assertStatus(409)
  })

  test('returns 409 when available stock is insufficient due to active reservations', async ({
    client,
  }) => {
    // Physical stock = 3, but we'll reserve 2 first, then try to reserve 2 more
    const product = await ProductFactory.with('stock', 1, (s: SF) => s.merge({ quantity: 3 })).create()

    // First reservation: takes 2 units → available = 1
    await client
      .post('/api/v1/checkout')
      .header('Idempotency-Key', ulid())
      .json({ customerId: CUSTOMER_ID, productId: product.id, quantity: 2 })

    // Second request wants 2 but only 1 available — should fail
    const response = await client
      .post('/api/v1/checkout')
      .header('Idempotency-Key', ulid())
      .json({ customerId: CUSTOMER_ID, productId: product.id, quantity: 2 })

    response.assertStatus(409)
  })

  test('returns 404 for unknown product', async ({ client }) => {
    const response = await client
      .post('/api/v1/checkout')
      .header('Idempotency-Key', ulid())
      .json({ customerId: CUSTOMER_ID, productId: ulid(), quantity: 1 })

    response.assertStatus(404)
  })

  test('returns 422 when idempotency header is missing', async ({ client }) => {
    const product = await ProductFactory.with('stock').create()

    const response = await client
      .post('/api/v1/checkout')
      .json({ customerId: CUSTOMER_ID, productId: product.id, quantity: 1 })

    response.assertStatus(422)
  })

  test('returns 422 for invalid body fields', async ({ client }) => {
    const response = await client
      .post('/api/v1/checkout')
      .header('Idempotency-Key', ulid())
      .json({ customerId: CUSTOMER_ID, productId: 'not-a-valid-id-format', quantity: 0 })

    response.assertStatus(422)
  })

  // ── Concurrency ───────────────────────────────────────────────────────────

  test('concurrent requests each create their own reservation', async ({ client, assert }) => {
    const product = await ProductFactory.with('stock', 1, (s: SF) => s.merge({ quantity: 10 })).create()

    const results = await Promise.all([
      client
        .post('/api/v1/checkout')
        .header('Idempotency-Key', ulid())
        .json({ customerId: CUSTOMER_ID, productId: product.id, quantity: 2 }),
      client
        .post('/api/v1/checkout')
        .header('Idempotency-Key', ulid())
        .json({ customerId: CUSTOMER_ID, productId: product.id, quantity: 2 }),
      client
        .post('/api/v1/checkout')
        .header('Idempotency-Key', ulid())
        .json({ customerId: CUSTOMER_ID, productId: product.id, quantity: 2 }),
    ])

    const accepted = results.filter((r) => r.status() === 202)
    assert.isTrue(accepted.length >= 1)

    // Available = physical − reserved. Reserved = accepted × 2
    const available = await getAvailableQuantity(product.id)
    assert.isAtLeast(available, 0)

    // Conservation: reserved + available === physical
    const reservations = await db
      .from('stock_reservations')
      .where('product_id', product.id)
      .whereNull('released_at')
      .sum('quantity as total')
      .first()
    const totalReserved = Number(reservations?.total ?? 0)

    assert.equal(totalReserved + available, 10, 'reserved + available must equal physical stock')
  })

  test('oversell prevention: exactly 1 reservation when stock is 1 and 5 concurrent requests', async ({
    client,
    assert,
  }) => {
    const product = await ProductFactory.with('stock', 1, (s: SF) => s.apply('lastUnit')).create()

    const requests = Array.from({ length: 5 }, () =>
      client
        .post('/api/v1/checkout')
        .header('Idempotency-Key', ulid())
        .json({ customerId: CUSTOMER_ID, productId: product.id, quantity: 1 })
    )

    const results = await Promise.all(requests)

    const accepted = results.filter((r) => r.status() === 202)
    const rejected = results.filter((r) => r.status() === 409)

    assert.equal(accepted.length, 1, 'exactly 1 request should succeed')
    assert.equal(rejected.length, 4, 'remaining 4 should fail with 409')

    // Physical stock still 1 (not committed yet — ERP hasn't confirmed)
    assert.equal(await getStockQuantity(product.id), 1, 'physical stock unchanged')

    // Available = 0 (all reserved)
    assert.equal(await getAvailableQuantity(product.id), 0, 'available stock fully reserved')

    // Exactly 1 active reservation
    assert.equal(await getActiveReservationCount(product.id), 1)
  })
})
