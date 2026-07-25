import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import packageJson from '../package.json'

describe('Cloudflare package contract', () => {
  it('publishes the root entry only — no migration CLI or shipped SQL', () => {
    expect(packageJson.exports).toEqual({
      '.': {
        types: './dist/esm/index.d.ts',
        import: './dist/esm/index.js',
      },
    })
    expect(packageJson).not.toHaveProperty('bin')
    expect(packageJson.files).toEqual(['dist', 'src'])
    expect(packageJson.description.toLowerCase()).toMatch(/drizzle|d1/)
    expect(packageJson.description.toLowerCase()).toMatch(/lock/)
  })

  it('does not ship D1 migration SQL or a migrations CLI', async () => {
    const root = fileURLToPath(new URL('..', import.meta.url))
    await expect(
      readFile(`${root}/migrations/0000_tanstack_ai_initial.sql`, 'utf8'),
    ).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(
      readFile(
        `${root}/src/assets/0000_tanstack_ai_initial.sql`,
        'utf8',
      ),
    ).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(
      readFile(`${root}/bin/tanstack-ai-cloudflare-migrations.mjs`, 'utf8'),
    ).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('keeps Node built-ins, Buffer, and migration tooling out of the root graph', async () => {
    const rootFiles = ['bindings.ts', 'd1.ts', 'index.ts', 'locks.ts']
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
    expect(root).not.toMatch(/d1Migrations/)
    expect(root).not.toMatch(/from ['"]\.\/migrations['"]/)
    expect(root).not.toMatch(/from ['"]\.\/migration-cli['"]/)
    expect(root).not.toMatch(/from ['"]\.\/cli['"]/)
  })
})
