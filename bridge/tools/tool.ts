/**
 * Ultron's own tools, in a shape no brain owns.
 *
 * A tool is a name, a description for the model, a zod input shape and a
 * function. Each brain adapter turns these into whatever its model takes: the
 * Claude adapter wraps them as in-process MCP servers (brain/claude-tools.ts).
 */
import type { z, ZodRawShape } from 'zod'

export type ToolContent =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string }

/**
 * What a tool hands back to the model. `isError` tells it the call failed.
 * A type, not an interface, so it fits MCP's result type, which has an index signature.
 */
export type ToolResult = {
  content: ToolContent[]
  isError?: boolean
}

export interface Tool<Shape extends ZodRawShape = ZodRawShape> {
  name: string
  description: string
  input: Shape
  // Method syntax on purpose: a list of tools with different shapes has to
  // fit in one Tool[] (method parameters are checked bivariantly).
  run(args: z.infer<z.ZodObject<Shape>>): Promise<ToolResult>
}

/** A named group of tools, the unit a brain loads them in. */
export interface ToolServer {
  name: string
  version: string
  /** Told to the model once, about the whole group. */
  instructions: string
  /** Never hidden behind tool search: if the model has to go looking, it won't. */
  alwaysLoad: boolean
  tools: Tool[]
}

/**
 * One tool.
 *
 * @example
 *   const reset = defineTool('ui_reset', 'Put the interface back.', {}, async () => ({
 *     content: [{ type: 'text', text: 'Interface restored.' }],
 *   }))
 */
export function defineTool<Shape extends ZodRawShape>(
  name: string,
  description: string,
  input: Shape,
  run: (args: z.infer<z.ZodObject<Shape>>) => Promise<ToolResult>,
): Tool<Shape> {
  return { name, description, input, run }
}

/**
 * A group of tools.
 *
 * @example
 *   const ui = toolServer({ name: 'ultron_ui', version: '1.0.0', instructions: '...', alwaysLoad: true, tools: [reset] })
 */
export function toolServer(server: ToolServer): ToolServer {
  return server
}
