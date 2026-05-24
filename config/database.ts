import app from '@adonisjs/core/services/app'
import { defineConfig } from '@adonisjs/lucid'

const dbConfig = defineConfig({
  /**
   * Default connection used for all queries.
   */
  connection: 'sqlite',

  connections: {
    /**
     * SQLite connection (default).
     */
    sqlite: {
      client: 'better-sqlite3',

      connection: {
        // Separate file for tests so `npm test` never touches the dev database
        // and `npm run dev` never touches the test database.
        filename: process.env.NODE_ENV === 'test'
          ? app.tmpPath('test.db.sqlite3')
          : app.tmpPath('db.sqlite3'),
      },

      /**
       * Required by Knex for SQLite defaults.
       */
      useNullAsDefault: true,

      /**
       * WAL mode: readers never block writers, writers never block readers.
       * Eliminates SQLITE_BUSY errors when connection-pool connections access
       * the same file concurrently (e.g. concurrent checkout requests in tests).
       *
       * BEGIN IMMEDIATE (set per-transaction in checkout_service) ensures the
       * availability check and reservation INSERT are serialised at the write
       * level, preventing overselling even in WAL mode.
       *
       * busy_timeout: retry for up to 5 s on SQLITE_BUSY instead of failing
       * immediately. Essential for concurrent writes in the reservation pattern.
       * Must be set via pragma — `timeout` is not a valid better-sqlite3
       * connection option and causes a TypeScript error.
       */
      pool: {
        afterCreate: (conn: any, done: (err: Error | null, conn: any) => void) => {
          conn.pragma('journal_mode = WAL')
          conn.pragma('foreign_keys = ON')
          conn.pragma('busy_timeout = 5000')
          done(null, conn)
        },
      },

      migrations: {
        /**
         * Sort migration files naturally by filename.
         */
        naturalSort: true,

        /**
         * Paths containing migration files.
         */
        paths: ['database/migrations'],
      },

      schemaGeneration: {
        /**
         * KEEP false — enabling this causes migration:rollback to run
         * schema:generate on the now-empty DB, which overwrites database/schema.ts
         * with an empty file. migration:run then fails to boot because models
         * import from that empty file (chicken-and-egg).
         *
         * To regenerate schema.ts manually after new migrations:
         *   1. npm run db:fresh    (applies migrations, schema.ts stays intact)
         *   2. node ace schema:generate  (now the DB has tables → correct output)
         */
        enabled: false,

        /**
         * Custom schema rules file paths.
         */
        rulesPaths: ['./database/schema_rules.js'],
      },
    },

    /**
     * PostgreSQL connection.
     * Install package to switch: npm install pg
     */
    // pg: {
    //   client: 'pg',
    //   connection: {
    //     host: env.get('DB_HOST'),
    //     port: env.get('DB_PORT'),
    //     user: env.get('DB_USER'),
    //     password: env.get('DB_PASSWORD'),
    //     database: env.get('DB_DATABASE'),
    //   },
    //   migrations: {
    //     naturalSort: true,
    //     paths: ['database/migrations'],
    //   },
    //   debug: app.inDev,
    // },

    /**
     * MySQL / MariaDB connection.
     * Install package to switch: npm install mysql2
     */
    // mysql: {
    //   client: 'mysql2',
    //   connection: {
    //     host: env.get('DB_HOST'),
    //     port: env.get('DB_PORT'),
    //     user: env.get('DB_USER'),
    //     password: env.get('DB_PASSWORD'),
    //     database: env.get('DB_DATABASE'),
    //   },
    //   migrations: {
    //     naturalSort: true,
    //     paths: ['database/migrations'],
    //   },
    //   debug: app.inDev,
    // },

    /**
     * Microsoft SQL Server connection.
     * Install package to switch: npm install tedious
     */
    // mssql: {
    //   client: 'mssql',
    //   connection: {
    //     server: env.get('DB_HOST'),
    //     port: env.get('DB_PORT'),
    //     user: env.get('DB_USER'),
    //     password: env.get('DB_PASSWORD'),
    //     database: env.get('DB_DATABASE'),
    //   },
    //   migrations: {
    //     naturalSort: true,
    //     paths: ['database/migrations'],
    //   },
    //   debug: app.inDev,
    // },

    /**
     * libSQL (Turso) connection.
     * Install package to switch: npm install @libsql/client
     */
    // libsql: {
    //   client: 'libsql',
    //   connection: {
    //     url: env.get('LIBSQL_URL'),
    //     authToken: env.get('LIBSQL_AUTH_TOKEN'),
    //   },
    //   useNullAsDefault: true,
    //   migrations: {
    //     naturalSort: true,
    //     paths: ['database/migrations'],
    //   },
    //   debug: app.inDev,
    // },
  },
})

export default dbConfig
