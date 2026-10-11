/**
 * Ultron's own tools for one conversation: the blades, the interface, the
 * user's Chrome and the camera. Each server key is also the middle part of
 * its tools' names (`mcp__<key>__<tool>`), which bridge/policy.ts reads.
 */
import { displayServer } from '../panels.ts'
import { uiServer } from '../ui.ts'
import { chromeServer } from '../chrome.mjs'
import { visionServer } from '../vision.ts'
import type { Frame } from '../devices.ts'
import type { ToolServer } from './tool.ts'

/** Asks the app being answered for something (a camera frame) and waits for its reply. */
export type AskApp = (kind: string, args: object, timeoutMs?: number) => Promise<Frame>

export interface OwnToolsIo {
  /** Pushes a frame to every app. */
  send: (frame: Frame) => void
  ask: AskApp
  allowWrites: boolean
}

/**
 * @example
 *   const tools = ownTools({ send: devices.broadcast, ask, allowWrites: false })
 */
export function ownTools({ send, ask, allowWrites }: OwnToolsIo): Record<string, ToolServer> {
  return {
    // The HUD. Its handler sends to every connected app, so a `display` call
    // lands on each screen directly.
    ultron: displayServer((blade) => send({ type: 'blade', blade })),
    // The interface controls, sent the same way. A separate key because
    // MCP tool names are `mcp__<key>__<tool>` and one key can only carry
    // one server; the underscore in it is why the policy and the
    // conversation both name `ultron_ui` explicitly.
    ultron_ui: uiServer((op, args) => send({ type: 'ui', op, args })),
    // The user's own Chrome, over the extension's native-host socket. It
    // holds no per-connection state, but it is built here with the rest so
    // the write gate is read once, at the same point as everything else.
    ultron_chrome: chromeServer({ allowWrites }),
    // The camera, which unlike everything else here has to ask and wait.
    ultron_eyes: visionServer(ask),
  }
}
