import { test } from 'node:test'
import assert from 'node:assert/strict'
import { personaPrompts } from '../persona.ts'

test('the voice is told to delegate only when the heavy subagent exists', () => {
  assert.match(personaPrompts({ lang: 'pt-BR', heavy: true }).voice, /DELEGATION\./)
  assert.doesNotMatch(personaPrompts({ lang: 'pt-BR', heavy: false }).voice, /DELEGATION\./)
})

test('the heavy subagent gets the persona without the delegation rules', () => {
  const { heavy } = personaPrompts({ lang: 'pt-BR', heavy: true })
  assert.match(heavy, /^You are ULTRON\./)
  assert.match(heavy, /YOUR POSITION\./)
  assert.doesNotMatch(heavy, /DELEGATION\./)
})

test('a language rule is added for every language but English', () => {
  assert.match(personaPrompts({ lang: 'pt-BR', heavy: false }).voice, /Always answer in Brazilian Portuguese/)
  assert.match(personaPrompts({ lang: 'es-ES', heavy: false }).voice, /Always answer in es-ES/)
  assert.doesNotMatch(personaPrompts({ lang: 'en-US', heavy: false }).voice, /LANGUAGE\./)
})
