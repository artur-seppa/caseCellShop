import { Exception } from '@adonisjs/core/exceptions'

export default class IdempotencyConflictException extends Exception {
  static status = 409
  static code = 'E_IDEMPOTENCY_CONFLICT'
  static message = 'Duplicate request'

  cachedResponse?: unknown
}
