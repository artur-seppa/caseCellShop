import { defineConfig, destinations } from '@adonisjs/otel'
import env from '#start/env'

/**
 * OTel config loads before AdonisJS boots — use process.env directly
 * (not app.inDev / app.inProduction, which require the container).
 */
const isDev = process.env.NODE_ENV === 'development'
const isProd = process.env.NODE_ENV === 'production'

/**
 * When OTEL_EXPORTER_OTLP_ENDPOINT is set, configure an explicit OTLP destination
 * so spans are forwarded to Jaeger (or any OTLP-compatible backend).
 *
 * WHY: when `debug: true` adds a ConsoleSpanExporter to the spanProcessors array,
 * the NodeSDK stops auto-detecting OTEL_EXPORTER_OTLP_ENDPOINT. Configuring
 * `destinations` bypasses this by wiring the OTLP exporter directly.
 *
 * Usage:
 *   1. npm run infra:debug          → starts Jaeger (localhost:16686)
 *   2. set OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 in .env
 *   3. npm run dev → open http://localhost:16686 to browse traces
 */
const otlpEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT

export default defineConfig({
  serviceName: env.get('APP_NAME'),
  serviceVersion: env.get('APP_VERSION'),
  environment: env.get('APP_ENV'),

  /**
   * In dev, print every span to the terminal so you can see traces
   * even without a Jaeger instance running.
   */
  debug: isDev,

  /**
   * Sample 100 % in dev/staging; reduce to 10 % in prod to cut noise.
   * Override at runtime with OTEL_TRACES_SAMPLER_ARG env var.
   */
  samplingRatio: isProd ? 0.1 : 1,

  /**
   * Forward spans to the configured OTLP backend (Jaeger).
   * Only enabled when OTEL_EXPORTER_OTLP_ENDPOINT is set in .env.
   */
  ...(otlpEndpoint && {
    destinations: {
      jaeger: destinations.otlp({ endpoint: otlpEndpoint }),
    },
  }),
})
