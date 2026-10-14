// Module resolve hook, registered by fake-sdk-hooks.mjs.
const FAKE = new URL('./fake-agent-sdk.ts', import.meta.url).href

export async function resolve(specifier, context, next) {
  if (specifier === '@anthropic-ai/claude-agent-sdk') return { url: FAKE, shortCircuit: true }
  return next(specifier, context)
}
