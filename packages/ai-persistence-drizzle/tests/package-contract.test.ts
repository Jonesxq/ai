import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'
import packageJson from '../package.json'

const execFileAsync = promisify(execFile)

describe('drizzle package contract', () => {
  it('publishes the edge root, Node sqlite subpath, and schema-emit CLI only', () => {
    expect(packageJson.exports).toEqual({
      '.': {
        types: './dist/esm/index.d.ts',
        import: './dist/esm/index.js',
      },
      './sqlite': {
        types: './dist/esm/sqlite.d.ts',
        import: './dist/esm/sqlite.js',
      },
      './sqlite-schema': {
        types: './dist/esm/sqlite/default-schema.d.ts',
        import: './dist/esm/sqlite/default-schema.js',
      },
      './pg-schema': {
        types: './dist/esm/pg/default-schema.d.ts',
        import: './dist/esm/pg/default-schema.js',
      },
    })
    expect(packageJson.bin).toEqual({
      'tanstack-ai-drizzle-schema': './bin/tanstack-ai-drizzle-schema.mjs',
    })
    expect(packageJson.files).toEqual(['bin', 'dist', 'src', 'scripts'])
    expect(packageJson.bin).not.toHaveProperty('tanstack-ai-drizzle-migrations')
    expect(packageJson.description.toLowerCase()).toMatch(/schema-first/)
    expect(packageJson.scripts).toMatchObject({
      'codegen:pg': 'node ./scripts/codegen-pg-from-sqlite.ts',
      'codegen:pg:check': 'node ./scripts/codegen-pg-from-sqlite.ts --check',
    })
  })

  it('does not ship SQL migrations or drizzle-kit journals', async () => {
    const root = fileURLToPath(new URL('..', import.meta.url))
    await expect(
      readFile(`${root}/src/assets/0000_tanstack_ai_initial.sql`, 'utf8'),
    ).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(
      readFile(`${root}/drizzle/0000_tanstack_ai_initial.sql`, 'utf8'),
    ).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('keeps Node built-ins and Buffer out of the root import graph', async () => {
    const rootFiles = [
      'index.ts',
      'core/persistence.ts',
      'core/schema-contract.ts',
      'core/schema-source.ts',
      'core/stores.ts',
      'sqlite/default-schema.ts',
      'sqlite/ensure-tables.ts',
      'pg/default-schema.ts',
      'pg/ensure-tables.ts',
    ]
    for (const filename of rootFiles) {
      const contents = await readFile(
        fileURLToPath(new URL(`../src/${filename}`, import.meta.url)),
        'utf8',
      )
      expect(contents, filename).not.toMatch(/from ['"]node:/)
      expect(contents, filename).not.toMatch(/\bBuffer\b/)
    }
    const root = await readFile(
      fileURLToPath(new URL('../src/index.ts', import.meta.url)),
      'utf8',
    )
    // Root must not pull the Node-only `/sqlite` entry or `node:sqlite`.
    expect(root).not.toMatch(/from ['"]\.\/sqlite['"]/)
    expect(root).not.toMatch(/from ['"]\.\/sqlite\/factory['"]/)
    expect(root).not.toMatch(/from ['"]node:sqlite['"]/)
    expect(root).not.toMatch(/sqliteMigrations/)
  })

  it('keeps Postgres schema modules in sync with SQLite sources', async () => {
    const root = fileURLToPath(new URL('..', import.meta.url))
    await execFileAsync(
      process.execPath,
      ['./scripts/codegen-pg-from-sqlite.ts', '--check'],
      { cwd: root },
    )
  })
})
