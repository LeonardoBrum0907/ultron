/**
 * `npm test`: every test in the repo, in one command.
 *
 *   - mind/test/run.ts, the orchestrator's own numbered checks
 *   - every *.test.ts under bridge/, through Node's test runner
 *
 * Spawned with this same Node and tsx, so it needs no shell and behaves the
 * same in Git Bash, PowerShell and a Unix terminal.
 */
import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'

const TSX = 'node_modules/tsx/dist/cli.mjs'

/** Every *.test.ts below `dir`, sorted so the order is the same everywhere. */
function testFiles(dir) {
  return readdirSync(dir, { recursive: true })
    .map(String)
    .filter((name) => name.endsWith('.test.ts'))
    .sort()
    .map((name) => join(dir, name))
}

function run(label, args) {
  console.log(`\n# ${label}`)
  return spawnSync(process.execPath, [TSX, ...args], { stdio: 'inherit' }).status === 0
}

const results = [
  run('mind', ['mind/test/run.ts']),
  run('bridge', ['--test', ...testFiles('bridge')]),
]
process.exit(results.every(Boolean) ? 0 : 1)
