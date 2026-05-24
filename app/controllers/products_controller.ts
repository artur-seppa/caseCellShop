import type { HttpContext } from '@adonisjs/core/http'
import { inject } from '@adonisjs/core'
import ProductService from '#services/product_service'
import ProductNotFoundException from '#exceptions/product_not_found_exception'
import { productParamsValidator, productQueryValidator } from '#validators/product_validator'

@inject()
export default class ProductsController {
  constructor(private productService: ProductService) {}

  /**
   * @index
   * @summary List all products
   * @description Returns the product catalogue with page-based pagination. Results are cached per (page, limit) combination for 5 minutes (L1 in-memory + L2 Redis).
   * @paramQuery page - Page number (1-based), default 1 - @type(number)
   * @paramQuery limit - Items per page, default 50, max 100 - @type(number)
   * @responseBody 200 - {"data": "<Product[]>", "total": 3, "meta": {"fromCache": false, "page": 1, "perPage": 50}}
   * @responseBody 422 - {"errors": [{"message": "string", "field": "string", "rule": "string"}]}
   */
  async index({ request, response }: HttpContext) {
    const filters = await request.validateUsing(productQueryValidator)
    const result = await this.productService.listProducts(filters)
    return response.ok({
      data: result.data,
      total: result.data.length,
      meta: {
        fromCache: result.fromCache,
        page: filters.page ?? 1,
        perPage: filters.limit ?? 50,
      },
    })
  }

  /**
   * @show
   * @summary Get product by ID
   * @description Returns a single product by its ULID.
   * @responseBody 200 - <Product>
   * @responseBody 404 - {"message": "string"}
   */
  async show({ params, response }: HttpContext) {
    // route params sit under request._requestData().params — not at root.
    // Same pattern as checkoutHeaderValidator.validate(request.headers()).
    const { id } = await productParamsValidator.validate(params)
    const product = await this.productService.findById(id)
    if (!product) throw new ProductNotFoundException(`Product '${id}' not found`)
    return response.ok(product)
  }
}
