/**
 * Which tools Ultron may run without asking.
 *
 * Voice is a bad interface for a confirmation dialog: there is no window to
 * click and the model can't pause for one. So the bridge decides.
 *
 * Read-only and generative tools run freely. Anything that writes to disk,
 * runs a shell, or changes the world waits for ULTRON_ALLOW_WRITES=1. Start
 * without it, and turn it on once you trust what you're demoing.
 */

/**
 * Both spellings of every renamed built-in are listed on purpose. The SDK
 * presents several tools to the model under newer names — Task is Agent,
 * BashOutput is TaskOutput, KillShell is TaskStop, and the MCP resource tools
 * gained a "Tool" suffix — so a set holding only the old names never matches
 * and the tool falls through to the write branch, which is the opposite of
 * what these lists mean. Keep both until the old names are certainly gone.
 */
const READ_ONLY_BUILTINS = new Set([
  'Read', 'Glob', 'Grep', 'WebFetch', 'WebSearch', 'TodoWrite',
  'Task', 'Agent', 'ToolSearch',
  'ListMcpResources', 'ListMcpResourcesTool',
  'ReadMcpResource', 'ReadMcpResourceTool',
  'BashOutput', 'TaskOutput',
])
const WRITE_BUILTINS = new Set([
  'Bash', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit',
  'KillShell', 'TaskStop',
])

/** The Agent tool under both of its names, as with the builtins above. */
export const isDelegation = (name: string): boolean => name === 'Agent' || name === 'Task'

/** MCP tools arrive as `mcp__<server>__<tool>`. */
const mcpServerOf = (toolName: string): string | null =>
  toolName.startsWith('mcp__') ? (toolName.split('__')[1] ?? null) : null

/** The tool half, which can itself contain underscores: `mcp__x__a__b` -> `a__b`. */
const mcpToolOf = (toolName: string): string => toolName.split('__').slice(2).join('__')

/**
 * MCP policy, and why it is shaped this way.
 *
 * A short list of "servers that can change things" is the wrong default,
 * because it is a list of what we happened to think of. Every server not on it
 * runs unconditionally — and on a real machine that quietly includes placing a
 * phone call, spending an advertising budget, deleting a generated character
 * and writing files to disk. A voice assistant cannot ask "are you sure", so
 * the bridge has to be the one that is sure.
 *
 * So the default is deny, softened in two ways so the demo stays usable:
 *
 *   1. READ_ONLY_MCP is an explicit allowlist of servers whose whole surface is
 *      lookups and generation — search, registries, analytics reads. Anything
 *      there runs in read-only mode.
 *   2. Everywhere else, the tool has to argue for itself: its own name must
 *      begin with a read verb. `list_devices` runs; `install_apk` does not.
 *
 * On top of both sits a veto: a name containing a plainly effectful verb needs
 * ALLOW_WRITES no matter which server it came from, which is what keeps
 * `make_outbound_call` and `download_lottie` still until you ask for them.
 */
const READ_ONLY_MCP = new Set([
  'exa', 'exa-code', 'serper', 'serpapi', 'lottie-search', 'mcp-registry',
  'openrouter', 'openrouter-image', 'Microsoft_Clarity',
  // The generation servers belong here too, and leaving them out was a real
  // regression: `generate_image` begins with no read verb, so it fell to the
  // deny branch and "generate an image of the Mark VII suit" — the headline
  // demo — stopped working in the default mode.
  //
  // Putting them on the allowlist is safe because the veto below still applies
  // to allowlisted servers: it is what continues to withhold
  // make_outbound_call, delete_character, create_* and edit_image. Generation
  // runs; acting on the world does not.
  'higgsfield', 'heygen', 'elevenlabs',
])

/**
 * Anchored on the tool name, so it reads the verb rather than the noun.
 * `screenshot` is in here because it is a read that doesn't sound like one,
 * and the persona is told in as many words to put screenshots on the display.
 */
const READ_VERB =
  /^(get|list|read|search|find|query|fetch|check|describe|inspect|show|view|explain|screenshot)/i

/**
 * Unanchored on purpose — `make_outbound_call` and `Bulk-Edit-Events` both
 * hide their verb in the middle. `download` is here because it writes a file
 * even though it sounds like a read.
 */
const EFFECTFUL_VERB =
  /(send|call|post|create|delete|remove|update|edit|write|install|launch|tap|swipe|press|type|buy|pay|charge|publish|deploy|outbound|download)/i

/**
 * Tools whose names trip the veto without deserving it.
 *
 * The veto reads verbs out of names, which is the right instinct and
 * occasionally the wrong answer. `openrouter send-message` sends a prompt to a
 * language model and gets text back — nothing in the world changes — but it is
 * indistinguishable by name from sending mail. Asking a second model a question
 * is one of the better things this assistant can do, so it is named here
 * instead of being lost to a regex.
 *
 * Full `server__tool` keys, so an exemption can never leak across servers.
 */
const VETO_EXEMPT = new Set([
  'openrouter__send-message',
  'openrouter__send-feedback',
])

/**
 * Ultron's own servers. They run in this process and draw on our own screen,
 * so none is something to withhold, and they have to be named rather than
 * left to the verb rules, which would get every one of them wrong:
 *
 * - `ultron` (the HUD) and `ultron_ui` (the interface controls): without them
 *   Ultron has no display at all, and the verb rules read `ui_theme` as a write.
 * - `ultron_chrome` gates itself, at construction: chromeServer() only builds
 *   the acting tools — click, type, form input, close tab — when writes are
 *   allowed, so anything that reaches here at all is something the same policy
 *   has already permitted. `chrome_navigate` begins with no read verb and would
 *   otherwise withhold the one tool the whole server is for.
 * - `ultron_eyes` (the camera): looking changes nothing, and the real gate is
 *   the browser's own camera permission plus an indicator the user can see for
 *   as long as it is live.
 */
const OWN_SERVERS = new Set(['ultron', 'ultron_ui', 'ultron_chrome', 'ultron_eyes'])

function permitsMcp(server: string, tool: string, allowWrites: boolean): boolean {
  if (OWN_SERVERS.has(server)) return true
  if (EFFECTFUL_VERB.test(tool) && !VETO_EXEMPT.has(`${server}__${tool}`)) return allowWrites
  // The session tools this bridge is developed inside count as read-only too.
  if (READ_ONLY_MCP.has(server) || server.startsWith('ccd_session')) return true
  return READ_VERB.test(tool) ? true : allowWrites
}

/** Decides, by name alone, whether a tool may run. */
export interface ToolPolicy {
  permits(toolName: string): boolean
}

/**
 * The bridge's permission rules, with writes on or off.
 *
 * @example
 *   const policy = toolPolicy({ allowWrites: false })
 *   policy.permits('mcp__exa__search')  // true
 *   policy.permits('Bash')              // false
 */
export function toolPolicy({ allowWrites }: { allowWrites: boolean }): ToolPolicy {
  return {
    permits(name) {
      if (READ_ONLY_BUILTINS.has(name)) return true
      if (WRITE_BUILTINS.has(name)) return allowWrites
      const server = mcpServerOf(name)
      if (server) return permitsMcp(server, mcpToolOf(name), allowWrites)
      return allowWrites
    },
  }
}
