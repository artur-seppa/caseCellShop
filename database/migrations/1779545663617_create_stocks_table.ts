import { BaseSchema } from '@adonisjs/lucid/schema'

/** Stock quantities — one row per product. Controlled by the app (not the ERP). */
export default class extends BaseSchema {
  protected tableName = 'stocks'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.string('id', 26).primary()
      table.string('product_id', 26).notNullable().unique().references('id').inTable('products')
      table.integer('quantity').notNullable().defaultTo(0)
      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').notNullable()
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}