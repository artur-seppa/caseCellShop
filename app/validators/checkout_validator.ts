import vine from '@vinejs/vine'

/**
 * ULID: Universally Unique Lexicographically Sortable Identifier
 * 26 chars, Crockford Base32 alphabet (no I, L, O, U)
 */
const ULID = vine.string().fixedLength(26).regex(/^[0-9A-HJKMNP-TV-Z]{26}$/)

export const checkoutValidator = vine.create(
  vine.object({
    /**
     * Customer ID — accepted as any non-empty string so systems that
     * use UUIDs, JWTs, or other schemes all work without pre-registration.
     */
    customerId: vine.string().minLength(1).maxLength(255),

    /**
     * Product ID must be a valid ULID since it's a database lookup key.
     */
    productId: ULID,

    /**
     * Quantity 1–100 per order.
     */
    quantity: vine.number().range([1, 100]).withoutDecimals(),
  })
)

export const checkoutHeaderValidator = vine.create(
  vine
    .object({
      /**
       * Idempotency-Key: any non-empty string, max 255 chars.
       * Clients may use ULIDs, UUIDs, or any unique token they generate.
       */
      'idempotency-key': vine.string().minLength(1).maxLength(255),
    })
    .allowUnknownProperties()
)
