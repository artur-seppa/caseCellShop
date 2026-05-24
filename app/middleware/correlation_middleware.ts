import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'
import { ulid } from 'ulid'

/**
 * Adds X-Request-Id correlation ID to every request/response and
 * binds it to the per-request logger so every log line in this request
 * automatically includes `requestId` — no need to pass it explicitly.
 *
 * Reads the ID from an upstream load balancer / gateway (X-Request-Id header)
 * or generates a fresh ULID when none is provided.
 *
 * Runs before ContainerBindingsMiddleware so the child logger with the
 * requestId field is what gets registered in the DI container.
 */
export default class CorrelationMiddleware {
  async handle(ctx: HttpContext, next: NextFn) {
    const requestId = (ctx.request.header('x-request-id') ?? ulid()).toString()

    // Propagate to the client / downstream services
    ctx.response.header('X-Request-Id', requestId)

    // Bind requestId to this request's logger — all subsequent logger.info/warn/error
    // calls (in controllers, services, and worker) inherit this field automatically.
    ctx.logger = ctx.logger.child({ requestId })

    await next()
  }
}
