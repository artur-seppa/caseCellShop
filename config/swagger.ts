import type { options as SwaggerOptions } from 'adonis-autoswagger/dist/types.js'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))

export default {
  path: __dirname + '/../',
  title: 'CaseCellShop API',
  version: '1.0.0',
  description: 'Backend API for CaseCellShop — TOTVS Technical Challenge',
  tagIndex: 2,
  info: {
    title: 'CaseCellShop API',
    version: '1.0.0',
    description:
      'Product catalogue, async checkout, order status — featuring Redis cache, BullMQ, idempotency and atomic stock control.',
  },
  snakeCase: true,
  debug: false,
  ignore: ['/swagger', '/docs', '/health', '/metrics', '/', '/bullboard'],
  preferredPutPatch: 'PUT',
  common: {
    parameters: {},
    headers: {},
  },
  securitySchemes: {},
  authMiddlewares: ['auth'],
  defaultSecurityScheme: '',
  persistAuthorization: false,
} satisfies SwaggerOptions
