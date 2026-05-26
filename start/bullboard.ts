/**
 * Bull Board — BullMQ monitoring UI (official library).
 *
 * Bull Board requires a framework-specific adapter to serve its static assets
 * and JSON API. The Express adapter is the most stable option; it runs as a
 * standalone HTTP server on BULL_BOARD_PORT (default 3334), completely
 * independent of AdonisJS so CSRF/session middleware never interfere.
 *
 * Access: http://localhost:3334
 *
 * Only started in the 'web' environment — not in tests or CLI commands.
 */
import { createServer } from 'node:http'
import { createBullBoard } from '@bull-board/api'
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter'
import { ExpressAdapter } from '@bull-board/express'
import { checkoutQueue } from '#start/queue'
import app from '@adonisjs/core/services/app'
import logger from '@adonisjs/core/services/logger'

if (app.getEnvironment() === 'web') {
  const serverAdapter = new ExpressAdapter()
  serverAdapter.setBasePath('/')

  createBullBoard({
    queues: [new BullMQAdapter(checkoutQueue)],
    serverAdapter,
  })

  const PORT = Number(process.env.BULL_BOARD_PORT ?? 3334)
  const bullRouter = serverAdapter.getRouter()

  // The Express Router is a Connect-compatible (req, res, next) function — it
  // can be passed directly to Node's createServer without a full Express app.
  const server = createServer((req, res) => {
    bullRouter(req as any, res as any, (err?: unknown) => {
      if (err) {
        res.statusCode = 500
        res.end(String(err))
      } else {
        res.statusCode = 404
        res.end('Not found')
      }
    })
  })

  server.listen(PORT, () => {
    logger.info(`Bull Board: http://localhost:${PORT}`)
  })
}
