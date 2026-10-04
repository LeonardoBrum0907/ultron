/**
 * Filler speech.
 *
 * A tool call can take ten seconds, and silence that long reads as a crash. So
 * ULTRON says something the instant work starts — then goes quiet until he has
 * an answer. One acknowledgement, no progress chatter.
 *
 * The phrasing follows the character's actual grammar rather than generic
 * assistant-speak, which matters more than it sounds:
 *
 *   - Working lines are subjectless present participles: "Compiling.",
 *     "Cross-referencing." Not "I'm now checking" and never "let me".
 *   - There is no snap-to compliance formula. "Right away" and "At once" are
 *     not in his vocabulary; acknowledgement is deferential, not eager.
 *   - No filler words, no enthusiasm, no apology, no exclamation marks.
 *   - "Sir" fronted means urgency; final means routine. These are all routine,
 *     so it goes at the end, and only sometimes.
 *
 * Every pool is kept in English and Brazilian Portuguese, picked by the
 * language the bridge reports. The Portuguese follows the same grammar
 * ("Compilando.", "senhor" at the end). They are short on purpose: the bridge
 * caches each line's audio after its first synthesis, so they cost voice
 * credits once.
 */
import { speaksEnglish } from './capabilities'

type Lines = { en: string[]; pt: string[] }

/** Said as soon as the first tool fires, before any answer exists. */
const WORKING: Lines = {
  en: [
    'Working on it, sir.',
    'Compiling.',
    'Retrieving.',
    'Accessing the archive.',
    'Cross-referencing.',
    'Running the query now.',
    'Searching.',
    'Under way.',
  ],
  pt: [
    'Trabalhando nisso, senhor.',
    'Compilando.',
    'Recuperando.',
    'Acessando o arquivo.',
    'Cruzando os dados.',
    'Executando a consulta.',
    'Procurando.',
    'Em andamento.',
  ],
}

/** Acknowledging an order where no tool is involved. */
const ACKNOWLEDGE: Lines = {
  en: [
    'As you wish, sir.',
    'Very good, sir.',
    'Certainly.',
    'Understood.',
    'Consider it done.',
    'Directly, sir.',
  ],
  pt: [
    'Como desejar, senhor.',
    'Muito bem, senhor.',
    'Certamente.',
    'Entendido.',
    'Considere feito.',
    'Pois não, senhor.',
  ],
}

/** Answering to his name, before the user has said what they want. */
const ATTENTION: Lines = {
  en: ['Yes, sir?', 'Sir?', 'At your service, sir.', 'Standing by.', 'Awake, sir.'],
  pt: ['Sim, senhor?', 'Senhor?', 'Às suas ordens, senhor.', 'A postos.', 'Acordado, senhor.'],
}

/**
 * Avoids repeating the same phrase twice running, which is what makes canned
 * lines sound canned. Keeps one slot of history per pool.
 */
function makePicker(lines: Lines) {
  let last = -1
  return () => {
    const pool = speaksEnglish() ? lines.en : lines.pt
    if (pool.length < 2) return pool[0] ?? ''
    let i = last
    while (i === last) i = Math.floor(Math.random() * pool.length)
    last = i
    return pool[i]
  }
}

export const working = makePicker(WORKING)
export const acknowledge = makePicker(ACKNOWLEDGE)
export const attention = makePicker(ATTENTION)

/**
 * Naming the task is warmer than a generic acknowledgement and shows the
 * integration off on camera. Still participial, still under five words.
 *
 * MCP tool names are `mcp__<server>__<tool>`, and the two halves say different
 * things: the server is who is being asked, the tool is what is being asked
 * for. Matching one flat substring against the whole string gets both wrong —
 * `mcp__playwright__browser_click` announced a web search because "browse"
 * appeared earlier in the table than "browser", `Get-Report` looked like a code
 * repository, `Get-Events` like a calendar entry, and "highlight" like a lamp.
 *
 * So: split the name, match the halves separately, order the table so the
 * specific beats the general, and put word boundaries on the short words that
 * hide inside longer ones. Either half matching is enough — the server is the
 * better signal when a name gives one, but plenty of them don't.
 */
type Rule = {
  /** Matched against the server segment, if there is one. */
  server?: RegExp
  /** Matched against the tool segment, or the whole name for a built-in. */
  tool?: RegExp
  lines: Lines
}

const FOOTAGE: Lines = {
  en: ['Assembling the footage.', 'Rendering the sequence.'],
  pt: ['Montando as imagens.', 'Renderizando a sequência.'],
}

const BY_TOOL: Rule[] = [
  // Video sits above image because higgsfield and palmier both do either, so
  // the verb in the tool name is the only thing separating them — a rule on the
  // server alone would send every generate_video to "Rendering."
  { tool: /video|footage|\bclip\b|\breel\b|talking_head/, lines: FOOTAGE },
  {
    server: /higgsfield|openrouter-image|dalle|flux|midjourney/,
    tool: /image|photo|thumbnail|render|upscale|seedream/,
    lines: { en: ['Rendering.', 'Composing it now.'], pt: ['Renderizando.', 'Compondo agora.'] },
  },
  // The editors, once the two rules that read the verb have had their turn.
  { server: /palmier|heygen|runway|descript/, lines: FOOTAGE },
  {
    server: /playwright|puppeteer|browserbase|chrome/,
    tool: /\bbrowser\b|navigate/,
    lines: { en: ['Opening the browser.', 'Navigating.'], pt: ['Abrindo o navegador.', 'Navegando.'] },
  },
  {
    server: /android|\badb\b|simulator/,
    tool: /\bdevice\b|\bapk\b|\bphone\b/,
    lines: { en: ['Reaching the device.', 'Connecting to your phone.'], pt: ['Acessando o aparelho.', 'Conectando ao seu celular.'] },
  },
  {
    server: /gmail|\bmail\b/,
    tool: /gmail|\bmail\b|email|inbox/,
    lines: { en: ['Checking your mail.', 'Reading the inbox.'], pt: ['Verificando seus e-mails.', 'Lendo a caixa de entrada.'] },
  },
  // Calendar keys off "calendar" alone. "event" used to live here, which is how
  // a Mixpanel event query came out as "Checking your calendar."
  {
    tool: /calendar|\bdiary\b|\bmeeting\b/,
    lines: { en: ['Checking your calendar.', 'Consulting the diary.'], pt: ['Consultando sua agenda.', 'Verificando os compromissos.'] },
  },
  {
    server: /elevenlabs|openai-tts/,
    tool: /speech|\bvoice\b|\btts\b|text_to_sound/,
    lines: { en: ['Synthesising.', 'Working on it, sir.'], pt: ['Sintetizando.', 'Trabalhando nisso, senhor.'] },
  },
  {
    server: /spotify|sonos/,
    tool: /\bplay\b|\bmusic\b|playlist|\btrack\b/,
    lines: { en: ['Queuing it up.', 'Putting it on.'], pt: ['Colocando na fila.', 'Pondo para tocar.'] },
  },
  {
    server: /^home|homeassistant|\bhue\b|\bhass\b/,
    tool: /\blights?\b|thermostat|\bdimmer\b/,
    lines: { en: ['Adjusting it now.', 'Seeing to it, sir.'], pt: ['Ajustando agora.', 'Cuidando disso, senhor.'] },
  },
  {
    server: /github|linear|jira|sentry/,
    tool: /\brepo\b|repository|\bissues?\b|pull_request|\bcommit\b/,
    lines: { en: ['Checking the repository.', 'Consulting the tracker.'], pt: ['Verificando o repositório.', 'Consultando os chamados.'] },
  },
  // Also where the anonymously named analytics servers land — theirs are bare
  // UUIDs, so only the tool half says anything: Get-Report, Get-Events,
  // Run-Query. "report" is safe from the repository rule above because that one
  // is bounded.
  {
    server: /mixpanel|clarity|posthog|amplitude/,
    tool: /analytic|\bmetrics?\b|\breports?\b|\bevents?\b|cohort|funnel|dashboard|\bquery\b/,
    lines: { en: ['Running the query.', 'Pulling the figures.'], pt: ['Executando a consulta.', 'Levantando os números.'] },
  },
  {
    server: /\bexa\b|serper|serpapi|perplexity|tavily|brave/,
    tool: /search|\bweb\b|\bfetch\b|crawl|research/,
    lines: { en: ['Searching.', 'Consulting the record.'], pt: ['Procurando.', 'Consultando os registros.'] },
  },
]

const pickers = BY_TOOL.map((r) => ({ ...r, pick: makePicker(r.lines) }))

/**
 * `mcp__<server>__<tool>`, split on the first separator so tool names keep
 * their own underscores (`browser_click`, `text_to_speech`). A built-in like
 * WebSearch or Bash has no server half.
 *
 * The second form matters more than it looks: the bridge client prettifies
 * names for the HUD badge before handing them on, so what actually arrives
 * here is `higgsfield · generate image`. Parsing only the raw form meant every
 * rule below silently missed and every tool got the generic line.
 */
function split(toolName: string): { server: string; tool: string } {
  const raw = /^mcp__(.+?)__(.+)$/.exec(toolName)
  if (raw) return { server: raw[1].toLowerCase(), tool: raw[2].toLowerCase() }

  const pretty = toolName.split(' · ')
  if (pretty.length === 2) {
    return { server: pretty[0].toLowerCase(), tool: pretty[1].toLowerCase() }
  }

  return { server: '', tool: toolName.toLowerCase() }
}

/** A phrase suited to the tool that just fired. */
export function forTool(toolName: string): string {
  const { server, tool } = split(toolName)
  for (const r of pickers) {
    const hit =
      (r.server !== undefined && server !== '' && r.server.test(server)) ||
      (r.tool !== undefined && r.tool.test(tool))
    if (hit) return r.pick()
  }
  // Read, Bash, Grep and anything unrecognised: better a neutral line than a
  // confident wrong one.
  return working()
}
