import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Stock Reservations — Saga step 1 of 2.
 *
 * When a checkout is initiated, we create a reservation instead of
 * immediately decrementing stock. The reservation is committed (real
 * stock decrement) only after both payment AND ERP billing succeed.
 *
 * Compensations:
 *   - Payment declined  → keep reservation (user can retry within expires_at)
 *   - Payment exhausted → released_at = NOW(), order → PAYMENT_FAILED
 *   - ERP billing fail  → released_at = NOW(), order → FAILED
 *   - Reservation expires with no retry → recovery worker releases it, order → EXPIRED
 */
export default class extends BaseSchema {
  protected tableName = 'stock_reservations'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.string('id', 26).primary()
      table.string('order_id', 26).notNullable().references('id').inTable('orders').onDelete('CASCADE')
      table.string('product_id', 26).notNullable()
      table.integer('quantity').notNullable()
      table.timestamp('expires_at').notNullable()
      table.timestamp('released_at').nullable()
      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').notNullable()
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
