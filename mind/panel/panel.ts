// A live tuning panel for any personality (development only). It is built from the
// mind's own config: bars for each emotion, sliders for the temper, the emotions and
// each reaction, buttons to fire any stimulus or force any reaction, a fast clock, and
// a "copy config" that copies only what was changed, as JSON to paste back.
// Changes are kept in localStorage until they are written into the personality file.
import { diff } from '../core/config.ts'
import type { Mind } from '../core/mind.ts'
import type { MindEvent } from '../core/types.ts'

export interface PanelOptions {
  /** Key that shows and hides it. */
  key?: string
  /** Start open. */
  open?: boolean
}

const CSS = `
.mind-panel{position:fixed;top:0;right:0;z-index:50;width:330px;max-height:100vh;overflow:auto;box-sizing:border-box;
  padding:10px 12px 14px;background:rgba(2,10,14,.9);color:#bfefff;font:11px/1.45 ui-monospace,Consolas,monospace;
  border-left:1px solid rgba(80,220,255,.25);backdrop-filter:blur(4px)}
.mind-panel[hidden]{display:none}
.mind-panel h3{margin:12px 0 5px;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#6fd3f0;font-weight:600}
.mind-panel .row{display:flex;align-items:center;gap:6px;margin:2px 0}
.mind-panel .row label{flex:0 0 92px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mind-panel .row input[type=range]{flex:1;min-width:0;accent-color:#3fd0ff}
.mind-panel .row .v{flex:0 0 46px;text-align:right;color:#fff}
.mind-panel .bar{position:relative;flex:1;height:9px;background:rgba(80,220,255,.12)}
.mind-panel .bar i{position:absolute;inset:0 auto 0 0;background:#2ec7f2}
.mind-panel .bar b{position:absolute;top:-2px;bottom:-2px;width:2px;background:#ff5a4a}
.mind-panel button{background:rgba(80,220,255,.1);color:#bfefff;border:1px solid rgba(80,220,255,.3);
  font:inherit;padding:2px 6px;margin:2px 3px 2px 0;cursor:pointer}
.mind-panel button:hover{background:rgba(80,220,255,.25)}
.mind-panel button.on{background:#2ec7f2;color:#001018}
.mind-panel .muted{color:#6b93a3}
.mind-panel .log{white-space:pre;color:#8fc3d3;font-size:10px}
.mind-panel textarea{width:100%;height:70px;box-sizing:border-box;background:#000;color:#bfefff;border:1px solid rgba(80,220,255,.3);font:10px monospace}
`

export function createPanel(mind: Mind, { key = 'e', open = false }: PanelOptions = {}) {
  const store = `mind.panel.${mind.config.name}`
  try {
    const kept = localStorage.getItem(store)
    if (kept) mind.patch(JSON.parse(kept))
  } catch {
    // no storage: start from the file's values
  }
  const keep = () => {
    try {
      const d = diff(mind.defaults, mind.config)
      if (d) localStorage.setItem(store, JSON.stringify(d))
      else localStorage.removeItem(store)
    } catch {
      // nowhere to keep it
    }
  }
  const change = (patch: unknown) => {
    mind.patch(patch)
    keep()
  }

  const style = document.createElement('style')
  style.textContent = CSS
  document.head.append(style)
  const root = document.createElement('div')
  root.className = 'mind-panel'
  root.hidden = !open
  document.body.append(root)

  const el = (tag: string, cls = '', text = '') => {
    const e = document.createElement(tag)
    if (cls) e.className = cls
    if (text) e.textContent = text
    return e
  }
  const section = (title: string) => {
    root.append(el('h3', '', title))
  }
  const button = (text: string, onClick: () => void, parent: HTMLElement = root) => {
    const b = el('button', '', text) as HTMLButtonElement
    b.onclick = onClick
    parent.append(b)
    return b
  }
  /** A slider over min..max; `log` spaces it evenly by ratio (for long ranges like half-lives). */
  function slider(label: string, get: () => number, set: (v: number) => void, min: number, max: number, step: number, log = false) {
    const row = el('div', 'row')
    const input = document.createElement('input')
    input.type = 'range'
    input.min = '0'
    input.max = '1000'
    const v = el('span', 'v')
    const toValue = (s: number) => (log ? min * Math.pow(max / min, s / 1000) : min + ((max - min) * s) / 1000)
    const toSlider = (x: number) => (log ? (1000 * Math.log(x / min)) / Math.log(max / min) : (1000 * (x - min)) / (max - min))
    const show = (x: number) => (v.textContent = log ? (x >= 3600 ? `${(x / 3600).toFixed(1)}h` : x >= 60 ? `${(x / 60).toFixed(1)}m` : `${x.toFixed(0)}s`) : x.toFixed(step < 0.1 ? 2 : 1))
    input.value = String(toSlider(get()))
    show(get())
    input.oninput = () => {
      const x = Math.round(toValue(Number(input.value)) / step) * step
      show(x)
      set(x)
    }
    row.append(el('label', '', label), input, v)
    root.append(row)
    return () => {
      input.value = String(toSlider(get()))
      show(get())
    }
  }

  // Mood and what is going on
  const head = el('div')
  root.append(head)
  section('mood')
  const bars: Record<string, { fill: HTMLElement; mark: HTMLElement; v: HTMLElement }> = {}
  for (const name of Object.keys(mind.config.emotions)) {
    const row = el('div', 'row')
    const bar = el('div', 'bar')
    const fill = el('i')
    const mark = el('b')
    bar.append(fill, mark)
    const v = el('span', 'v')
    row.append(el('label', '', name), bar, v)
    root.append(row)
    bars[name] = { fill, mark, v }
  }
  root.append(el('div', 'muted', 'blue: now · red mark: background (kept between sessions)'))

  const tools = el('div')
  root.append(tools)
  const speed = button('time ×10', () => {
    mind.timeScale = mind.timeScale === 1 ? 10 : 1
    speed.classList.toggle('on', mind.timeScale !== 1)
  }, tools)
  button('reset mood', () => mind.resetMood(), tools)
  const out = document.createElement('textarea')
  out.readOnly = true
  const copy = (text: string) => {
    out.value = text
    out.select()
    navigator.clipboard?.writeText(text).catch(() => {})
  }
  button('copy config', () => copy(JSON.stringify(diff(mind.defaults, mind.config) ?? {}, null, 1)), tools)
  button('copy mood', () => {
    const o = mind.output()
    copy(JSON.stringify({ now: o.mood, background: o.background }, (_, x) => (typeof x === 'number' ? Math.round(x * 1000) / 1000 : x)))
  }, tools)
  const refreshers: (() => void)[] = []
  button('reset tuning', () => {
    mind.resetConfig()
    keep()
    refreshers.forEach((r) => r())
  }, tools)

  // Fire anything by hand
  section('stimuli')
  const stim = el('div')
  root.append(stim)
  for (const name of Object.keys(mind.config.stimuli)) button(name, () => mind.stimulate(name, { strength: 1 }), stim)
  section('reactions (force)')
  const force = el('div')
  root.append(force)
  for (const name of Object.keys(mind.config.reactions)) button(`▶ ${name}`, () => mind.force(name), force)

  // Tuning
  section('temper')
  for (const k of ['intensity', 'frequency', 'volatility'] as const)
    refreshers.push(slider(k, () => mind.config.temper[k], (v) => change({ temper: { [k]: v } }), 0, 3, 0.05))
  for (const [name] of Object.entries(mind.config.emotions)) {
    section(`emotion · ${name}`)
    const c = () => mind.config.emotions[name]
    refreshers.push(slider('rest', () => c().rest, (v) => change({ emotions: { [name]: { rest: v } } }), 0, 1, 0.01))
    refreshers.push(slider('gain', () => c().gain, (v) => change({ emotions: { [name]: { gain: v } } }), 0, 3, 0.05))
    refreshers.push(slider('half-life', () => c().halfLife, (v) => change({ emotions: { [name]: { halfLife: v } } }), 5, 3600, 1, true))
  }
  section('rhythm')
  const r = () => mind.config.rhythm
  refreshers.push(slider('min gap', () => r().minGap, (v) => change({ rhythm: { minGap: v } }), 2, 300, 1, true))
  refreshers.push(slider('mean wait', () => r().mean, (v) => change({ rhythm: { mean: v } }), 5, 900, 1, true))
  refreshers.push(slider('do nothing', () => r().rest, (v) => change({ rhythm: { rest: v } }), 0, 5, 0.05))
  for (const [name] of Object.entries(mind.config.reactions)) {
    section(`reaction · ${name}`)
    const c = () => mind.config.reactions[name]
    const row = el('div', 'row')
    const on = document.createElement('input')
    on.type = 'checkbox'
    on.checked = c().enabled !== false
    on.onchange = () => change({ reactions: { [name]: { enabled: on.checked } } })
    row.append(el('label', '', 'enabled'), on)
    root.append(row)
    refreshers.push(() => (on.checked = c().enabled !== false))
    if (c().kind === 'spontaneous') refreshers.push(slider('weight', () => c().base ?? 1, (v) => change({ reactions: { [name]: { base: v } } }), 0, 5, 0.05))
    else refreshers.push(slider('chance', () => c().chance ?? 1, (v) => change({ reactions: { [name]: { chance: v } } }), 0, 1, 0.05))
    refreshers.push(slider('cooldown', () => c().cooldown ?? 0, (v) => change({ reactions: { [name]: { cooldown: v } } }), 1, 900, 1, true))
  }

  section('log')
  const log = el('div', 'log')
  root.append(log)
  root.append(out)
  const lines: string[] = []
  mind.on((e: MindEvent) => {
    const t = e.t.toFixed(1).padStart(7)
    const line =
      e.type === 'stimulus'
        ? `${t}  · ${e.name}`
        : e.type === 'reaction'
          ? `${t}  ${e.phase === 'start' ? '▶' : e.phase === 'end' ? '■' : '✕'} ${e.name}`
          : e.type === 'answer'
            ? `${t}  ⟵ ${e.style}${e.preludes.length ? ` after ${e.preludes.join('+')}` : ''} (+${e.delay.toFixed(1)}s)`
            : e.type === 'cue'
              ? `${t}    ✦ ${e.name}`
              : `${t}  ⇢ ${e.name}`
    if (e.type === 'stimulus' && e.name === 'interaction') return
    lines.unshift(line)
    lines.length = Math.min(lines.length, 12)
  })

  const update = () => {
    if (root.hidden) return
    const o = mind.output()
    head.innerHTML = ''
    head.append(
      el('div', '', `mind · ${mind.config.name}   ${o.context || '—'}`),
      el('div', 'muted', `dominant ${o.dominant} · ${o.active ? `playing ${o.active}` : `next draw in ${o.nextIn.toFixed(0)}s`}`),
    )
    for (const [name, b] of Object.entries(bars)) {
      b.fill.style.width = `${(o.mood[name] ?? 0) * 100}%`
      b.mark.style.left = `${Math.min(1, o.background[name] ?? 0) * 100}%`
      b.v.textContent = (o.mood[name] ?? 0).toFixed(2)
    }
    log.textContent = lines.join('\n')
  }
  const timer = setInterval(update, 150)

  const onKey = (e: KeyboardEvent) => {
    if (e.key.toLowerCase() !== key || (e.target as HTMLElement)?.closest?.('input,textarea')) return
    root.hidden = !root.hidden
    update()
  }
  window.addEventListener('keydown', onKey)
  // The panel's own clicks and keys are not the user talking to the figure.
  for (const type of ['pointerdown', 'pointermove', 'click', 'keydown']) root.addEventListener(type, (e) => e.stopPropagation())

  return () => {
    clearInterval(timer)
    window.removeEventListener('keydown', onKey)
    root.remove()
    style.remove()
  }
}
