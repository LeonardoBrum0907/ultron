// Particle humanoid prototype: the page.
//
// The figure itself is figure.js, which the app runs too. This page gives it a mind of
// its own and its controls: the state buttons and keys, the boot log, the microphone (M)
// and the mind's tuning panel (E).

import { createMind } from '../mind/index.ts'
import { browserStorage, saveOnHide } from '../mind/adapters/storage-browser.ts'
import { attachPointer } from '../mind/adapters/pointer.ts'
import { createPanel } from '../mind/panel/panel.ts'
import { ultron } from '../mind/personalities/ultron.ts'
import { createFigure } from './figure.js'

// Ultron's emotions (../mind, see mind/SPEC.md): the mood, kept between sessions, and what
// it does on its own. The figure maps its body channels in the frame loop.
const mind = createMind(ultron, { seed: (Math.random() * 2 ** 32) >>> 0, storage: browserStorage('ultron.mind') })
await mind.restore()
saveOnHide(mind)
attachPointer(mind)
createPanel(mind, { key: 'e' })

await createFigure({ canvas: document.getElementById('gl'), mind, controls: true })
