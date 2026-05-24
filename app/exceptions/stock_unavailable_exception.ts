import { Exception } from '@adonisjs/core/exceptions'

export default class StockUnavailableException extends Exception {
  static status = 409
  static code = 'E_STOCK_UNAVAILABLE'
  static message = 'Insufficient stock for product'
}
