// Loaded with `--import` ahead of the bridge: every import of the Agent SDK
// resolves to the scripted fake beside this file instead.
import { register } from 'node:module'

register(new URL('./fake-sdk-resolve.mjs', import.meta.url))
