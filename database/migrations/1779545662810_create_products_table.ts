import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * ERP product catalogue — read model owned by this service.
 * Populated by the seed script; read-only at runtime.
 * Primary key is a ULID (26-char string).
 */
export default class extends BaseSchema {
  protected tableName = 'products'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.string('id', 26).primary()
      table.string('name').notNullable()
      table.text('description').nullable()
      table.integer('price').notNullable().comment('Price in cents — e.g. 4990 = R$49,90')
      table.string('image_url').nullable()
      table.string('category').notNullable()
      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').notNullable()
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}