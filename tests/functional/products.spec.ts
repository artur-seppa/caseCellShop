import { test } from '@japa/runner'
import { ulid } from 'ulid'
import { ProductFactory } from '#factories/product_factory'
import { truncateTables } from '#tests/helpers/db_helper'

test.group('GET /api/v1/products', (group) => {
  group.each.setup(async () => {
    await truncateTables()
  })

  test('returns empty list when no products', async ({ client, assert }) => {
    const response = await client.get('/api/v1/products')
    response.assertStatus(200)

    const body = response.body() as any
    assert.equal(body.total, 0)
    assert.deepEqual(body.data, [])
  })

  test('returns seeded products with pagination meta', async ({ client, assert }) => {
    await ProductFactory.createMany(3)

    const response = await client.get('/api/v1/products')
    response.assertStatus(200)

    const body = response.body() as any
    assert.equal(body.total, 3)
    assert.equal(body.data.length, 3)
    assert.property(body.meta, 'fromCache')
    assert.equal(body.meta.page, 1)
    assert.equal(body.meta.perPage, 50)
  })

  test('paginates with page and limit — page 1', async ({ client, assert }) => {
    await ProductFactory.createMany(5)

    const response = await client.get('/api/v1/products?page=1&limit=2')
    response.assertStatus(200)

    const body = response.body() as any
    assert.equal(body.data.length, 2)
    assert.equal(body.meta.page, 1)
    assert.equal(body.meta.perPage, 2)
  })

  test('paginates with page and limit — page 2', async ({ client, assert }) => {
    await ProductFactory.createMany(5)

    const page1 = await client.get('/api/v1/products?page=1&limit=2')
    const page2 = await client.get('/api/v1/products?page=2&limit=2')

    const ids1 = (page1.body() as any).data.map((p: any) => p.id)
    const ids2 = (page2.body() as any).data.map((p: any) => p.id)

    // Pages must not overlap
    assert.equal(ids1.length, 2)
    assert.equal(ids2.length, 2)
    ids1.forEach((id: string) => assert.notInclude(ids2, id))
  })

  test('returns empty page when offset exceeds total', async ({ client, assert }) => {
    await ProductFactory.createMany(3)

    const response = await client.get('/api/v1/products?page=99&limit=10')
    response.assertStatus(200)

    const body = response.body() as any
    // Page is empty because the offset exceeds the data, but total reflects
    // the real count of products in the database (not the page size).
    assert.deepEqual(body.data, [])
    assert.equal(body.total, 3)
  })

  test('second request returns fromCache: true', async ({ client, assert }) => {
    await ProductFactory.create()

    await client.get('/api/v1/products') // populates L1+L2 cache

    const second = await client.get('/api/v1/products')
    second.assertStatus(200)

    const body = second.body() as any
    assert.isTrue(body.meta.fromCache)
  })

  test('rejects invalid page (< 1)', async ({ client }) => {
    const response = await client.get('/api/v1/products?page=0')
    response.assertStatus(422)
  })

  test('rejects limit above 100', async ({ client }) => {
    const response = await client.get('/api/v1/products?limit=101')
    response.assertStatus(422)
  })
})

test.group('GET /api/v1/products/:id', (group) => {
  group.each.setup(async () => {
    await truncateTables()
  })

  test('returns product by id', async ({ client, assert }) => {
    const product = await ProductFactory.merge({ name: 'Specific Case', price: 4990 }).create()

    const response = await client.get(`/api/v1/products/${product.id}`)
    response.assertStatus(200)

    const body = response.body() as any
    assert.equal(body.id, product.id)
    assert.equal(body.name, 'Specific Case')
    assert.equal(body.price, 4990)
  })

  test('returns 404 for nonexistent product', async ({ client }) => {
    // Fresh ULID — valid format but guaranteed not to exist in DB
    const response = await client.get(`/api/v1/products/${ulid()}`)
    response.assertStatus(404)
  })
})
