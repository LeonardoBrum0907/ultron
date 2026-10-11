/**
 * Golden-master comparison: what the bridge did, against a recording of what
 * it did before. `UPDATE_GOLDEN=1 npm test` re-records, which is only right
 * when a behavior change was intended.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'

const goldenPath = (name: string) => fileURLToPath(new URL(`../golden/${name}.json`, import.meta.url))

/** Ids and dates the bridge makes up on the spot, replaced by stable markers. */
export function normalize(value: unknown): unknown {
  return JSON.parse(
    JSON.stringify(value)
      .replace(/"[pb][0-9a-z]+-[0-9a-z]+"/g, '"<blade-id>"')
      .replace(/"20\d\d-\d\d-\d\dT[\d:.]+Z"/g, '"<date>"'),
  )
}

export function matchesGolden(name: string, actual: unknown): void {
  const file = goldenPath(name)
  const seen = normalize(actual)
  if (process.env.UPDATE_GOLDEN === '1' || !existsSync(file)) {
    writeFileSync(file, `${JSON.stringify(seen, null, 2)}\n`)
    return
  }
  assert.deepEqual(seen, JSON.parse(readFileSync(file, 'utf8')))
}
