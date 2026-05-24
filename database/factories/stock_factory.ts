import Factory from '@adonisjs/lucid/factories'
import type { FactoryContextContract } from '@adonisjs/lucid/types/factory'
import { ulid } from 'ulid'
import Stock from '#models/stock'

export const StockFactory = Factory.define(Stock, ({ faker }: FactoryContextContract) => {
  return {
    id: ulid(),  // ULID primary key — must be set explicitly
    quantity: faker.number.int({ min: 5, max: 100 }),
    // productId is set automatically by Lucid when used as a .relation('stock', ...)
  }
})
  /**
   * Use when testing 409 insufficient stock scenarios.
   * Creates a stock row with quantity = 1 (just enough for one order).
   */
  .state('lastUnit', (stock: Stock) => {
    stock.quantity = 1
  })

  /**
   * Use when testing oversell prevention.
   * quantity = 0 — any order attempt should return 409.
   */
  .state('outOfStock', (stock: Stock) => {
    stock.quantity = 0
  })

  .build()
