/**
 * Dedicated IORedis connection for BullMQ.
 *
 * BullMQ uses blocking Redis commands (BRPOPLPUSH, BLPOP, etc.) which require
 * `maxRetriesPerRequest: null` — otherwise ioredis throws immediately on any
 * failed request instead of waiting for the reconnect.
 *
 * Do NOT share this connection with @adonisjs/redis (different semantics).
 */
import { Redis } from 'ioredis'
import env from '#start/env'

const rawPassword = env.get('REDIS_PASSWORD')

export const bullmqConnection = new Redis({
  host:     env.get('REDIS_HOST'),
  port:     env.get('REDIS_PORT'),
  // AdonisJS wraps secrets in Secret<T> — call .release() to get the raw string
  password: rawPassword ? rawPassword.release() : undefined,
  // DB 1 in tests — keeps BullMQ jobs off the dev-server queue so the running
  // `npm run dev` worker cannot process jobs enqueued during `npm test`.
  db:       process.env.NODE_ENV === 'test' ? 1 : 0,
  maxRetriesPerRequest: null,   // REQUIRED by BullMQ blocking commands
  enableReadyCheck:     false,  // Don't block startup waiting for Redis
  lazyConnect:          true,   // Connect only when first command is issued
})
