import { hasOne } from '@adonisjs/lucid/orm'
import type { HasOne } from '@adonisjs/lucid/types/relations'
import { ProductSchema } from '#database/schema'
import Stock from '#models/stock'

export default class Product extends ProductSchema {
  static table = 'products'

  /**
   * Tell Lucid that we assign the primary key ourselves (ULID).
   * Without this, Lucid overwrites `id` with the SQLite lastInsertRowid (integer) after insert.
   */
  static selfAssignPrimaryKey = true

  @hasOne(() => Stock)
  declare stock: HasOne<typeof Stock>
}
