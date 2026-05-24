/* eslint-disable prettier/prettier */
import type { routes } from './index.ts'

export interface ApiDefinition {
  products: {
    index: typeof routes['products.index']
    show: typeof routes['products.show']
  }
  checkout: {
    store: typeof routes['checkout.store']
  }
  orders: {
    show: typeof routes['orders.show']
  }
}
