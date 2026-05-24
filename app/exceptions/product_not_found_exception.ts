import { Exception } from '@adonisjs/core/exceptions'

export default class ProductNotFoundException extends Exception {
  static status = 404
  static code = 'E_PRODUCT_NOT_FOUND'
  static message = 'Product not found'
}
