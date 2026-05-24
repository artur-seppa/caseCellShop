import type { HttpContext } from '@adonisjs/core/http'
import { inject } from '@adonisjs/core'
import CheckoutService, { type CheckoutOutput } from '#services/checkout_service'
import IdempotencyConflictException from '#exceptions/idempotency_conflict_exception'
import StockUnavailableException from '#exceptions/stock_unavailable_exception'
import ProductNotFoundException from '#exceptions/product_not_found_exception'
import { checkoutValidator, checkoutHeaderValidator } from '#validators/checkout_validator'
import { checkoutTotal, checkoutDuration } from '#start/metrics'

@inject()
export default class CheckoutController {
  constructor(private checkoutService: CheckoutService) {}

  /**
   * @store
   * @summary Place an order
   * @description Atomically decrements stock, creates a PENDING order, and enqueues async ERP billing. Returns 202 Accepted immediately. Poll GET /orders/:id for final status. The Idempotency-Key header (Stripe pattern) ensures retries never create duplicate orders.
   * @paramHeader Idempotency-Key - Unique key per purchase attempt. Same key returns the same 202 without re-processing (24h TTL). Generate a new UUID/ULID per purchase attempt. - @type(string) @example(test-order-001) @required
   * @requestBody {"customerId": "01JVMN00000000000000TEST01", "productId": "01JVPRD000000000000PRDC001", "quantity": 1}
   * @responseBody 202 - {"orderId": "string", "status": "PENDING", "message": "string", "links": {"status": "string"}}
   * @responseBody 409 - {"message": "string"} - Insufficient stock or request already in progress
   * @responseBody 404 - {"message": "string"} - Product not found
   * @responseBody 422 - {"message": "string", "errors": []} - Validation error (body or missing Idempotency-Key header)
   */
  async store({ request, response, logger }: HttpContext) {
    // request.validateUsing merges body+params+query — it does NOT include headers.
    // Headers must be validated by calling .validate() directly on the compiled schema.
    const headers = await checkoutHeaderValidator.validate(request.headers())
    const body    = await request.validateUsing(checkoutValidator)

    // ctx.logger already carries requestId from CorrelationMiddleware — all log
    // lines below automatically include it with no extra passing required.
    const end = checkoutDuration.startTimer()

    try {
      const result = await this.checkoutService.execute({
        customerId: body.customerId,
        productId: body.productId,
        quantity: body.quantity,
        idempotencyKey: headers['idempotency-key'],
      })

      checkoutTotal.inc({ status: 'accepted' })
      end()

      logger.info(
        { orderId: result.orderId, productId: body.productId, quantity: body.quantity },
        'checkout.accepted'
      )

      return response.accepted(result)
    } catch (error) {
      end()

      if (error instanceof IdempotencyConflictException && error.cachedResponse) {
        // Idempotent replay: return original 202 without touching DB or queue.
        checkoutTotal.inc({ status: 'idempotent_replay' })
        logger.info({ orderId: (error.cachedResponse as CheckoutOutput).orderId }, 'checkout.idempotent_replay')
        return response.accepted(error.cachedResponse)
      }

      if (error instanceof StockUnavailableException) {
        checkoutTotal.inc({ status: 'stock_unavailable' })
        logger.warn({ productId: body.productId, quantity: body.quantity }, 'checkout.stock_unavailable')
      } else if (error instanceof ProductNotFoundException) {
        checkoutTotal.inc({ status: 'product_not_found' })
        logger.warn({ productId: body.productId }, 'checkout.product_not_found')
      } else {
        checkoutTotal.inc({ status: 'error' })
        logger.error({ err: error }, 'checkout.error')
      }

      throw error
    }
  }
}
