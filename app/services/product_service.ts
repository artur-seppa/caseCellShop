import cache from '@adonisjs/cache/services/main'
import Product from '#models/product'
import { cacheOperations } from '#start/metrics'

/** Cache TTL for product data. 5 min provides enough freshness for a catalogue. */
const LIST_TTL = '5m'
const ITEM_TTL = '5m'

const listKey = (filters: object) => `products:list:${JSON.stringify(filters)}`
const itemKey = (id: string) => `products:item:${id}`

export default class ProductService {
  /**
   * Cache-aside with stampede protection.
   *
   * @adonisjs/cache (Bentocache) handles:
   *   - L1 in-memory  (per-process, nanoseconds, LRU eviction)
   *   - L2 Redis      (shared across instances, milliseconds)
   *   - Distributed lock to prevent cache stampede on concurrent misses
   *
   * fromCache flag: the factory closure is only called on a cache miss,
   * so if `factory` is never executed the result came from cache.
   */
  async listProducts(filters: {
    page?: number
    limit?: number
  }) {
    let fromCache = true

    const data = await cache.getOrSet({
      key: listKey(filters),
      ttl: LIST_TTL,
      factory: async () => {
        fromCache = false
        return this.#queryProducts(filters)
      },
    })

    // Track hit/miss so we can monitor cache effectiveness.
    // Datadog alert: if hit_rate drops below 70% for 5 min → stale TTL or bug.
    cacheOperations.inc({ result: fromCache ? 'hit' : 'miss', key_type: 'products_list' })

    return { data, fromCache }
  }

  async findById(id: string) {
    let fromCache = true

    const data = await cache.getOrSet({
      key: itemKey(id),
      ttl: ITEM_TTL,
      factory: async () => {
        fromCache = false
        const product = await Product.query().where('id', id).preload('stock').first()
        if (!product) return null
        return product.serialize()
      },
    })

    cacheOperations.inc({ result: fromCache ? 'hit' : 'miss', key_type: 'products_item' })

    return data
  }

  /** Invalidate cache for a single product (e.g. after price update). */
  async invalidateItemCache(id: string) {
    await cache.delete({ key: itemKey(id) })
  }

  async #queryProducts(filters: {
    page?: number
    limit?: number
  }) {
    const perPage = filters.limit ?? 50
    const page = filters.page ?? 1
    const offset = (page - 1) * perPage

    const [rows, countRow] = await Promise.all([
      Product.query().preload('stock').limit(perPage).offset(offset),
      Product.query().count('* as total').first(),
    ])

    return {
      rows: rows.map((r) => r.serialize()),
      total: Number(countRow?.$extras?.total ?? 0),
    }
  }
}
