import { test } from '@japa/runner'
import { ulid } from 'ulid'
import { ProductFactory } from '#factories/product_factory'
import { StockFactory } from '#factories/stock_factory'
import { OrderFactory } from '#factories/order_factory'
import { truncateTables } from '#tests/helpers/db_helper'

// A stable, valid ULID for the test customer (Crockford Base32 — no I, L, O, U)
const CUSTOMER_ID = '01JVMN000000000000000TEST01'

/** Short alias for the StockFactory builder type used in .with() callbacks */
type SF = typeof StockFactory

test.group('GET /api/v1/orders/:id', (group) => {
  group.each.setup(async () => {
    await truncateTables()
  })

  test('returns order details for existing PENDING order', async ({ client, assert }) => {
    const order = await OrderFactory.create()

    const response = await client.get(`/api/v1/orders/${order.id}`)
    response.assertStatus(200)

    const body = response.body() as any
    assert.equal(body.id, order.id)
    assert.equal(body.status, 'PENDING')
    assert.equal(body.customerId, CUSTOMER_ID)
    assert.exists(body.createdAt)
    assert.exists(body.updatedAt)
  })

  test('returns order with CONFIRMED status and transactionId', async ({ client, assert }) => {
    const order = await OrderFactory.apply('confirmed').create()

    const response = await client.get(`/api/v1/orders/${order.id}`)
    response.assertStatus(200)

    const body = response.body() as any
    assert.equal(body.status, 'CONFIRMED')
    // CONFIRMED means payment was authorised — transactionId must be present
    assert.isString(body.transactionId)
    assert.match(body.transactionId, /^txn-/)
  })

  test('returns order with PAID status and transactionId', async ({ client, assert }) => {
    const order = await OrderFactory.apply('paid').create()

    const response = await client.get(`/api/v1/orders/${order.id}`)
    response.assertStatus(200)

    const body = response.body() as any
    assert.equal(body.status, 'PAID')
    assert.isString(body.transactionId)
    assert.match(body.transactionId, /^txn-/)
  })

  test('returns order with FAILED status, failureReason and transactionId', async ({ client, assert }) => {
    // ERP failure: payment succeeded (transactionId exists) but ERP rejected
    const order = await OrderFactory.apply('failed').create()

    const response = await client.get(`/api/v1/orders/${order.id}`)
    response.assertStatus(200)

    const body = response.body() as any
    assert.equal(body.status, 'FAILED')
    assert.equal(body.failureReason, 'Payment declined by ERP')
    // Payment was authorised before ERP failed — transactionId must be present
    assert.isString(body.transactionId)
    assert.match(body.transactionId, /^txn-/)
  })

  test('returns order with PAYMENT_FAILED status and no transactionId', async ({ client, assert }) => {
    // Card declined: gateway never authorised — transactionId must be null
    const order = await OrderFactory.apply('paymentFailed').create()

    const response = await client.get(`/api/v1/orders/${order.id}`)
    response.assertStatus(200)

    const body = response.body() as any
    assert.equal(body.status, 'PAYMENT_FAILED')
    assert.equal(body.failureReason, 'Card declined')
    assert.isNull(body.transactionId)
  })

  test('PENDING order has no transactionId (payment not yet authorised)', async ({ client, assert }) => {
    const order = await OrderFactory.create()

    const response = await client.get(`/api/v1/orders/${order.id}`)
    response.assertStatus(200)

    const body = response.body() as any
    assert.equal(body.status, 'PENDING')
    assert.isNull(body.transactionId)
  })

  test('returns order with EXPIRED status', async ({ client, assert }) => {
    const order = await OrderFactory.apply('expired').create()

    const response = await client.get(`/api/v1/orders/${order.id}`)
    response.assertStatus(200)

    const body = response.body() as any
    assert.equal(body.status, 'EXPIRED')
    assert.exists(body.failureReason)
  })

  test('returns 404 for nonexistent order', async ({ client }) => {
    // Fresh ULID — valid format but guaranteed not to exist in DB
    const response = await client.get(`/api/v1/orders/${ulid()}`)
    response.assertStatus(404)
  })

  test('full flow: checkout creates an order retrievable by GET /orders/:id', async ({
    client,
    assert,
  }) => {
    const product = await ProductFactory.with('stock', 1, (s: SF) => s.merge({ quantity: 5 })).create()

    // Place order
    const checkoutResponse = await client
      .post('/api/v1/checkout')
      .header('Idempotency-Key', ulid())
      .json({ customerId: CUSTOMER_ID, productId: product.id, quantity: 1 })

    checkoutResponse.assertStatus(202)
    const { orderId } = checkoutResponse.body() as any

    // Poll order status
    const orderResponse = await client.get(`/api/v1/orders/${orderId}`)
    orderResponse.assertStatus(200)

    const order = orderResponse.body() as any
    assert.equal(order.id, orderId)
    assert.equal(order.productId, product.id)
    assert.equal(order.quantity, 1)
    assert.equal(order.unitPrice, product.price)
    assert.equal(order.totalAmount, product.price)
    // Saga statuses: PENDING → PAYMENT_PROCESSING → BILLING → CONFIRMED
    // (worker only runs in 'web' env, so in tests the order may stay PENDING)
    assert.include(
      ['PENDING', 'PAYMENT_PROCESSING', 'BILLING', 'PROCESSING', 'CONFIRMED'],
      order.status
    )
    assert.exists(order.createdAt)
  })
})
