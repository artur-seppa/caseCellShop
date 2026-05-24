import app from '@adonisjs/core/services/app'
import { type HttpContext, ExceptionHandler } from '@adonisjs/core/http'
import { errors as vineErrors } from '@vinejs/vine'
import { errors as httpErrors } from '@adonisjs/core'
import { trace } from '@opentelemetry/api'
import { checkoutTotal } from '#start/metrics'

export default class HttpExceptionHandler extends ExceptionHandler {
  /**
   * In debug mode, the exception handler will display verbose errors
   * with pretty printed stack traces.
   */
  protected debug = !app.inProduction

  /**
   * The method is used for handling errors and returning
   * response to the client
   */
  async handle(error: unknown, ctx: HttpContext) {
    // 422 Validation error
    if (error instanceof vineErrors.E_VALIDATION_ERROR) {
      // Track validation errors on the checkout endpoint so the metric matches
      // what the JSDoc on checkoutTotal describes (status = validation_error).
      // VineJS throws before entering the controller try/catch, so this is the
      // only place where the increment can happen reliably.
      if (ctx.request.url().includes('/checkout')) {
        checkoutTotal.inc({ status: 'validation_error' })
      }

      // Annotate the active OTel span with the actual field-level errors so
      // Jaeger shows which fields failed instead of just "Validation failure".
      const span = trace.getActiveSpan()
      if (span) {
        const fields = (error.messages as any[]).map((m) => m.field).join(', ')
        span.addEvent('validation_error', {
          'validation.fields': fields,
          'validation.details': JSON.stringify(error.messages),
        })
      }

      return ctx.response.status(422).json({
        message: error.message,
        errors: error.messages,
      })
    }

    // 404 Route not found
    if (error instanceof httpErrors.E_ROUTE_NOT_FOUND) {
      return ctx.response.status(404).json({
        message: 'Route not found',
      })
    }

    return super.handle(error, ctx)
  }

  /**
   * The method is used to report error to the logging service or
   * the a third party error monitoring service.
   *
   * @note You should not attempt to send a response from this method.
   */
  async report(error: unknown, ctx: HttpContext) {
    ctx.logger.error({ err: error }, 'unhandled_exception')
  }
}
