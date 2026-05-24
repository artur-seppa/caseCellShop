import { belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import { StockSchema } from '#database/schema'
import Product from '#models/product'

export default class Stock extends StockSchema {
  static table = 'stocks'

  /**
   * Tell Lucid that we assign the primary key ourselves (ULID).
   * Without this, Lucid overwrites `id` with the SQLite lastInsertRowid after insert.
   */
  static selfAssignPrimaryKey = true

  @belongsTo(() => Product)
  declare product: BelongsTo<typeof Product>
}
