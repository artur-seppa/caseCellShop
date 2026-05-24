import { DateTime } from 'luxon'
import { belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import { StockReservationSchema } from '#database/schema'
import Order from '#models/order'

export default class StockReservation extends StockReservationSchema {
  static table = 'stock_reservations'

  /**
   * ULID primary key — must not be overwritten by Lucid with SQLite lastInsertRowid.
   */
  static selfAssignPrimaryKey = true

  @belongsTo(() => Order)
  declare order: BelongsTo<typeof Order>

  /**
   * A reservation is active if it has not been explicitly released
   * and has not expired yet.
   */
  get isActive(): boolean {
    return this.releasedAt === null && this.expiresAt > DateTime.now()
  }
}
