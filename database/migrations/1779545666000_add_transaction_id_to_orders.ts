import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Adds `transaction_id` to orders — stores the payment gateway's authorisation
 * reference (e.g. txn-01JVXY...) once the payment is confirmed.
 *
 * Why store it?
 *   1. Financial reconciliation — match orders ↔ gateway charges.
 *   2. Refunds — real gateways require the transaction ID to process a refund.
 *   3. Support queries — "what's the charge ID for order X?" answered immediately.
 *   4. Extra idempotency signal in the saga worker (see start/worker.ts).
 *
 * Nullable because the column is only populated after the gateway authorises
 * the charge (status PAID). Orders that fail before reaching PAID have NULL.
 */
export default class extends BaseSchema {
  protected tableName = 'orders'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.string('transaction_id').nullable().after('erp_job_id')
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('transaction_id')
    })
  }
}
