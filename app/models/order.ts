import { OrderSchema } from '#database/schema'

export default class Order extends OrderSchema {
  static table = 'orders'

  /**
   * Tell Lucid that we assign the primary key ourselves (ULID).
   * Without this, Lucid overwrites `id` with the SQLite lastInsertRowid after insert.
   */
  static selfAssignPrimaryKey = true

  get isTerminal(): boolean {
    return this.status === 'CONFIRMED' || this.status === 'FAILED'
  }

  get isPending(): boolean {
    return this.status === 'PENDING'
  }
}
