import redis from '@adonisjs/redis/services/main'

const KEY_PREFIX = 'idem:'
const LOCK_PREFIX = 'idem:lock:'
const TTL_SECONDS = 86400 // 24h
const LOCK_TTL_MS = 30000 // 30s

export default class IdempotencyService {
  async get<T>(key: string): Promise<T | null> {
    const raw = await redis.get(`${KEY_PREFIX}${key}`)
    return raw ? (JSON.parse(raw) as T) : null
  }

  async set(key: string, value: unknown): Promise<void> {
    await redis.set(`${KEY_PREFIX}${key}`, JSON.stringify(value), 'EX', TTL_SECONDS)
  }

  /** Returns true if lock acquired (first caller), false if already locked */
  async acquireLock(key: string): Promise<boolean> {
    const result = await redis.set(`${LOCK_PREFIX}${key}`, '1', 'PX', LOCK_TTL_MS, 'NX')
    return result === 'OK'
  }

  async releaseLock(key: string): Promise<void> {
    await redis.del(`${LOCK_PREFIX}${key}`)
  }
}
