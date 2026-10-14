import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isDelegation, toolPolicy } from '../policy.ts'

const readOnly = toolPolicy({ allowWrites: false })
const writes = toolPolicy({ allowWrites: true })

const permitted = (names: string[]) => names.filter((n) => readOnly.permits(n))

test('read-only built-ins run, write built-ins wait for ULTRON_ALLOW_WRITES', () => {
  assert.deepEqual(permitted(['Read', 'WebSearch', 'Agent', 'Task', 'TaskOutput', 'Bash', 'Write', 'TaskStop']), [
    'Read', 'WebSearch', 'Agent', 'Task', 'TaskOutput',
  ])
  assert.equal(writes.permits('Bash'), true)
})

test("Ultron's own servers always run", () => {
  for (const name of [
    'mcp__ultron__display', 'mcp__ultron_ui__ui_theme', 'mcp__ultron_chrome__chrome_click', 'mcp__ultron_eyes__look',
    'mcp__ultron_files__files_read', 'mcp__ultron_web__web_fetch',
  ]) {
    assert.equal(readOnly.permits(name), true, name)
  }
})

test('other MCP tools argue for themselves with a read verb', () => {
  assert.equal(readOnly.permits('mcp__phone__list_devices'), true)
  assert.equal(readOnly.permits('mcp__phone__ring'), false)
  assert.equal(readOnly.permits('mcp__x__screenshot'), true)
  assert.equal(writes.permits('mcp__phone__ring'), true)
})

test('an effectful verb is vetoed even on an allowlisted server', () => {
  assert.equal(readOnly.permits('mcp__higgsfield__generate_image'), true)
  assert.equal(readOnly.permits('mcp__higgsfield__edit_image'), false)
  assert.equal(readOnly.permits('mcp__phone__make_outbound_call'), false)
  assert.equal(readOnly.permits('mcp__openrouter__send-message'), true)
})

test('unknown names are writes', () => {
  assert.equal(readOnly.permits('SomethingNew'), false)
  assert.equal(readOnly.permits('mcp__'), false)
})

// A known trap (docs/legacy-notes.md): ai-memory's read tool starts with no
// read verb, so it is refused in read-only mode. Pinned until it is fixed.
test('ai-memory is refused in read-only mode today', () => {
  assert.equal(readOnly.permits('mcp__ai-memory__memory_query'), false)
})

test('isDelegation knows the Agent tool by both names', () => {
  assert.deepEqual(['Agent', 'Task', 'Bash'].map(isDelegation), [true, true, false])
})
