import Factory from '@adonisjs/lucid/factories'
import type { FactoryContextContract } from '@adonisjs/lucid/types/factory'
import { ulid } from 'ulid'
import Order from '#models/order'

// Stable test customer ID (valid ULID — Crockford Base32, no I/L/O/U)
const TEST_CUSTOMER_ID = '01JVMN000000000000000TEST01'

export const OrderFactory = Factory.define(Order, ({ faker }: FactoryContextContract) => {
  const quantity = faker.number.int({ min: 1, max: 5 })
  const unitPrice = faker.number.int({ min: 990, max: 19990 })

  return {
    id: ulid(),  // ULID primary key — must be set explicitly
    customerId: TEST_CUSTOMER_ID,
    productId: ulid(),
    productName: `Capinha ${faker.commerce.productName()}`,
    quantity,
    unitPrice,
    totalAmount: quantity * unitPrice,
    status: 'PENDING',
    idempotencyKey: ulid(),
    erpJobId: null,
    failureReason: null,
  }
})
  /**
   * ERP billing confirmed.
   *   const order = await OrderFactory.apply('confirmed').create()
   */
  .state('confirmed', (order: Order) => {
    order.status = 'CONFIRMED'
  })

  /**
   * Order failed with a reason.
   *   const order = await OrderFactory.apply('failed').create()
   */
  .state('failed', (order: Order) => {
    order.status = 'FAILED'
    order.failureReason = 'Payment declined by ERP'
  })

  /**
   * Order is in payment processing (Saga Step 1 in flight).
   *   const order = await OrderFactory.apply('paymentProcessing').create()
   */
  .state('paymentProcessing', (order: Order) => {
    order.status = 'PAYMENT_PROCESSING'
    order.erpJobId = `payment-${order.id}`
  })

  /**
   * Payment declined — reservation kept for retry window.
   *   const order = await OrderFactory.apply('paymentFailed').create()
   */
  .state('paymentFailed', (order: Order) => {
    order.status = 'PAYMENT_FAILED'
    order.failureReason = 'Card declined'
  })

  /**
   * Order is in ERP billing step (Saga Step 2 in flight).
   *   const order = await OrderFactory.apply('billing').create()
   */
  .state('billing', (order: Order) => {
    order.status = 'BILLING'
    order.erpJobId = `billing-${order.id}`
  })

  /**
   * Stock reservation expired before payment was completed.
   *   const order = await OrderFactory.apply('expired').create()
   */
  .state('expired', (order: Order) => {
    order.status = 'EXPIRED'
    order.failureReason = 'Stock reservation expired before payment was completed'
  })

  .build()
