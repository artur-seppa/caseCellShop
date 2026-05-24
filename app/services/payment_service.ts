import { ulid } from 'ulid'

export interface PaymentResult {
  success: true
  transactionId: string
}

export interface PaymentFailure {
  success: false
  failureReason: string
  /**
   * true  → gateway/network error (BullMQ will retry)
   * false → card declined / insufficient funds (no retry, keep reservation for user to switch method)
   */
  retryable: boolean
}

export type PaymentOutcome = PaymentResult | PaymentFailure

/**
 * Mock payment gateway service.
 *
 * Failure modes are controlled by environment variables:
 *   PAYMENT_FAILURE_RATE   — 0-100, % chance of any failure (default: 0)
 *   PAYMENT_RETRYABLE_RATE — 0-100, % of failures that are retryable (default: 50)
 *
 * Non-retryable failures simulate: card declined, insufficient funds.
 * Retryable failures simulate: gateway timeout, 5xx from processor.
 */
export default class PaymentService {
  async processPayment(_orderId: string, _amountCents: number): Promise<PaymentOutcome> {
    const failureRate = Number(process.env.PAYMENT_FAILURE_RATE ?? 0) / 100
    const retryableRate = Number(process.env.PAYMENT_RETRYABLE_RATE ?? 50) / 100

    const shouldFail = Math.random() < failureRate

    if (!shouldFail) {
      return { success: true, transactionId: `txn-${ulid()}` }
    }

    const retryable = Math.random() < retryableRate
    return {
      success: false,
      failureReason: retryable ? 'Payment gateway unavailable' : 'Card declined',
      retryable,
    }
  }
}
