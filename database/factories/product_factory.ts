import Factory from '@adonisjs/lucid/factories'
import type { FactoryContextContract } from '@adonisjs/lucid/types/factory'
import { ulid } from 'ulid'
import Product from '#models/product'
import { StockFactory } from './stock_factory.js'

const CATEGORIES = ['silicone', 'leather', 'clear', 'rugged'] as const
const BRANDS = [
  'iPhone 15',
  'Samsung Galaxy S24',
  'Xiaomi 13T',
  'Motorola Edge 40',
  'Google Pixel 8',
]
const STYLES = ['Silicone', 'Couro', 'Crystal Clear', 'Rugged']

export const ProductFactory = Factory.define(Product, ({ faker }: FactoryContextContract) => {
  const brand = faker.helpers.arrayElement(BRANDS)
  const style = faker.helpers.arrayElement(STYLES)

  return {
    id: ulid(),  // ULID primary key — must be set explicitly, SQLite won't auto-generate a string PK
    name: `Capinha ${style} ${brand}`,
    description: faker.lorem.sentence(),
    category: faker.helpers.arrayElement(CATEGORIES),
    price: faker.number.int({ min: 990, max: 19990 }),
    imageUrl: null,
  }
})
  /**
   * Creates the product + a related stock row in one call:
   *
   * @example
   * // Default quantity (5–100)
   * const product = await ProductFactory.with('stock').create()
   *
   * // Specific quantity
   * const product = await ProductFactory
   *   .with('stock', 1, (s: SF) => s.merge({ quantity: 10 }))
   *   .create()
   *
   * // Out-of-stock state
   * const product = await ProductFactory
   *   .with('stock', 1, (s: SF) => s.apply('lastUnit'))
   *   .create()
   */
  .relation('stock', () => StockFactory)

  .build()
