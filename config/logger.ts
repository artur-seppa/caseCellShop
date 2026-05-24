import env from '#start/env'
import app from '@adonisjs/core/services/app'
import { defineConfig, targets } from '@adonisjs/core/logger'
import { otelLoggingPreset } from '@adonisjs/otel/helpers'

const loggerConfig = defineConfig({
  /**
   * Default logger name used by ctx.logger and app logger calls.
   */
  default: 'app',

  loggers: {
    app: {
      /**
       * Toggle this logger on/off.
       */
      enabled: true,

      /**
       * Logger name shown in log records.
       */
      name: env.get('APP_NAME'),

      /**
       * Minimum level to output (trace, debug, info, warn, error, fatal).
       */
      level: env.get('LOG_LEVEL'),

      /**
       * In dev: pino-pretty renders coloured, human-readable output.
       * In prod: JSON to stdout — ready for Datadog/Loki/CloudWatch ingestion.
       *
       * pino-pretty options:
       *   translateTime  — local timestamp instead of epoch
       *   ignore         — drop pid/hostname (noise in containers)
       *   messageKey     — pino default is 'msg'
       *   errorLikeObjectKeys — pretty-print error objects
       */
      /**
       * otelLoggingPreset() hides internal OTel fields (trace_flags, span_id raw bytes)
       * while keeping trace_id and span_id visible, so every log line links to its
       * Jaeger trace automatically.
       */
      transport: {
        targets: app.inDev
          ? [targets.pretty(otelLoggingPreset())]
          : [targets.file({ destination: 1, ...otelLoggingPreset() })],
      },
    },
  },
})

export default loggerConfig

/**
 * Inferring types for the list of loggers you have configured
 * in your application.
 */
declare module '@adonisjs/core/types' {
  export interface LoggersList extends InferLoggers<typeof loggerConfig> {}
}
