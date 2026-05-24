import { Exception } from '@adonisjs/core/exceptions'

export default class OrderNotFoundException extends Exception {
  static status = 404
  static code = 'E_ORDER_NOT_FOUND'
  static message = 'Order not found'
}
