/**
 * Ultron's tools as the Claude Agent SDK takes them: in-process MCP servers.
 */
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import type { ToolServer } from '../tools/tool.ts'

/**
 * @example
 *   mcpServers: { ultron_ui: toSdkServer(uiServer(emit)) }
 */
export function toSdkServer(server: ToolServer) {
  return createSdkMcpServer({
    name: server.name,
    version: server.version,
    instructions: server.instructions,
    alwaysLoad: server.alwaysLoad,
    tools: server.tools.map((t) => tool(t.name, t.description, t.input, (args) => t.run(args))),
  })
}
