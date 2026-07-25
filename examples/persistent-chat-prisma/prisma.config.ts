import 'dotenv/config'
import { defineConfig } from 'prisma/config'

// Prisma 7 config. The multi-file schema lives in `prisma/schema` (the app's
// datasource + generator plus the copied TanStack AI models fragment), and
// migrations are written to `prisma/migrations` (committed).
//
// Prisma 7 no longer accepts `url` in the schema datasource — the connection
// URL for Migrate lives here (from `DATABASE_URL` in `.env` when present),
// while the runtime client connects via a driver adapter (see
// `src/lib/persistent-chat-store.ts`).
//
// Fall back to the example's local SQLite path so `prisma generate` works in
// CI / clean checkouts without a committed `.env`.
const databaseUrl =
  process.env.DATABASE_URL ?? 'file:./.data/persistent-chat.db'

export default defineConfig({
  schema: 'prisma/schema',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: databaseUrl },
})
