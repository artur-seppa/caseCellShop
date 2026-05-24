/*
|--------------------------------------------------------------------------
| Routes file
|--------------------------------------------------------------------------
|
| The routes file is used for defining the HTTP routes.
|
*/

import router from '@adonisjs/core/services/router'
import { controllers } from '#generated/controllers'
import AutoSwagger from 'adonis-autoswagger'
import swagger from '#config/swagger'

// ─── Documentation ────────────────────────────────────────────────────────────
router.get('/swagger', async () => AutoSwagger.default.docs(router.toJSON(), swagger))
router.get('/docs', async () => AutoSwagger.default.ui('/swagger', swagger))

// ─── Health & Metrics ─────────────────────────────────────────────────────────
router.get('/health', () => ({ status: 'ok', timestamp: new Date().toISOString() }))

router.get('/metrics', async ({ response }) => {
  const { register } = await import('prom-client')
  response.header('Content-Type', register.contentType)
  return response.ok(await register.metrics())
})

// ─── API v1 ───────────────────────────────────────────────────────────────────
router
  .group(() => {
    // Products
    router.get('/products', [controllers.Products, 'index']).as('products.index')
    router.get('/products/:id', [controllers.Products, 'show']).as('products.show')

    // Checkout
    router.post('/checkout', [controllers.Checkout, 'store']).as('checkout.store')

    // Orders
    router.get('/orders/:id', [controllers.Orders, 'show']).as('orders.show')
  })
  .prefix('/api/v1')
