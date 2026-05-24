import { test } from '@japa/runner'
import { ulid } from 'ulid'
import redis from '@adonisjs/redis/services/main'
import IdempotencyService from '#services/idempotency_service'

test.group('IdempotencyService', (group) => {
  let service: IdempotencyService

  group.each.setup(async () => {
    service = new IdempotencyService()
    // Clear relevant keys between tests
    const keys = await redis.keys('idem:*')
    if (keys.length) await redis.del(...keys)
  })

  test('returns null for unknown key', async ({ assert }) => {
    const result = await service.get(`unknown-${ulid()}`)
    assert.isNull(result)
  })

  test('stores and retrieves a value', async ({ assert }) => {
    const key = ulid()
    const value = { orderId: 'test-123', status: 'PENDING' }

    await service.set(key, value)
    const retrieved = await service.get<typeof value>(key)

    assert.deepEqual(retrieved, value)
  })

  test('acquireLock returns true for first caller', async ({ assert }) => {
    const key = ulid()
    const acquired = await service.acquireLock(key)
    assert.isTrue(acquired)
  })

  test('acquireLock returns false when already locked', async ({ assert }) => {
    const key = ulid()
    await service.acquireLock(key)

    const second = await service.acquireLock(key)
    assert.isFalse(second)
  })

  test('releaseLock allows re-acquisition', async ({ assert }) => {
    const key = ulid()
    await service.acquireLock(key)
    await service.releaseLock(key)

    const reacquired = await service.acquireLock(key)
    assert.isTrue(reacquired)
  })

  test('concurrent lock attempts: only one succeeds', async ({ assert }) => {
    const key = ulid()

    // Fire 5 concurrent lock attempts
    const results = await Promise.all(
      Array.from({ length: 5 }, () => service.acquireLock(key))
    )

    const successes = results.filter((r) => r === true)
    assert.equal(successes.length, 1, 'exactly one lock acquisition should succeed')
  })
})
