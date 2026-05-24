import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Orders — owns the checkout state machine.
 * Status FSM: PENDING → PROCESSING → CONFIRMED | FAILED
 */
export default class extends BaseSchema {
  protected tableName = 'orders'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.string('id', 26).primary()
      table.string('customer_id', 26).notNullable()
      table.string('product_id', 26).notNullable()
      table.string('product_name').notNullable()
      table.integer('quantity').notNullable()
      table.integer('unit_price').notNullable().comment('Unit price in cents')
      table.integer('total_amount').notNullable().comment('Total in cents')
      table.string('status').notNullable().defaultTo('PENDING')
      table.string('idempotency_key', 26).notNullable().unique()
      table.string('erp_job_id').nullable()
      table.text('failure_reason').nullable()
      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').notNullable()
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}