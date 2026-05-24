import vine from '@vinejs/vine'

/**
 * Shared ULID rule — 26-char Crockford Base32.
 * Used to validate :id path params before they reach the database.
 */
const ulid = vine.string().fixedLength(26).regex(/^[0-9A-HJKMNP-TV-Z]{26}$/)

export const productParamsValidator = vine.create(
  vine.object({ id: ulid })
)

export const orderParamsValidator = vine.create(
  vine.object({ id: ulid })
)

export const productQueryValidator = vine.create(
  vine.object({
    page: vine.number().min(1).withoutDecimals().optional(),
    limit: vine.number().min(1).max(100).withoutDecimals().optional(),
  })
)
