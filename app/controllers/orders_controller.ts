import type { HttpContext } from '@adonisjs/core/http'
import Order from '#models/order'
import OrderNotFoundException from '#exceptions/order_not_found_exception'
import { orderParamsValidator } from '#validators/product_validator'

export default class OrdersController {
  /**
   * @show
   * @summary Get order status
   * @description Poll this endpoint after POST /checkout to get the final order status. Status transitions: PENDING → PAYMENT_PROCESSING → BILLING → CONFIRMED | PAYMENT_FAILED | FAILED | EXPIRED
   * @responseBody 200 - <Order>
   * @responseBody 404 - {"message": "string"}
   */
  async show({ params, response }: HttpContext) {
    const { id } = await orderParamsValidator.validate(params)
    const order = await Order.find(id)
    if (!order) throw new OrderNotFoundException(`Order '${id}' not found`)
    return response.ok(order.serialize())
  }
}
