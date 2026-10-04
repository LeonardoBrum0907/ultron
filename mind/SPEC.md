# mind — o orquestrador de emoções do Ultron

Especificação para aprovação. Nada foi implementado ainda. Os identificadores estão em
inglês, como no resto do código. O texto está em português por ser um documento de
decisão; o README do módulo, quando existir, será em inglês, como os outros.

---

## 0. Objetivo

O Ultron é uma **personalidade**, não uma aplicação. O orquestrador (`mind`) é o que
ele sente e decide fazer. Ele precisa rodar igual em qualquer lugar: na figura de
partículas (`proto/`), no app React (`src/`), no bridge em Node (`bridge/`), num
terminal ou em outro sistema que ainda não existe.

### Princípios

1. **O núcleo é puro.** TypeScript sem dependências. Não usa DOM, Three.js, relógio
   próprio nem `Math.random` global:
   - o host chama `tick(dt)`;
   - o sorteio usa um gerador com semente injetável.

   Por isso o núcleo roda no navegador, em Node e em testes determinísticos.
2. **A personalidade é dado.** O Ultron é um arquivo de configuração serializável em
   JSON. Outra personalidade seria outro arquivo, com o mesmo motor, e nada no núcleo
   menciona o Ultron.
3. **O corpo é abstrato.** O motor só fala em **canais** com nome, como `gaze.x`,
   `eyes.gain` e `arteries.heat`:
   - cada host liga os canais que entende ao seu corpo e ignora os outros;
   - a figura de partículas usa quase todos;
   - um chat de texto usa só o humor.
4. **As entradas são eventos.** O host traduz o que percebe (mouse, voz, tempo,
   resultado de tarefas) em **estímulos** com nome. Os sensores são adaptadores
   opcionais.
5. **As garantias ao usuário moram no motor**, não no host: ele sempre atende o
   chamado (seção 9).

---

## 1. Estrutura

```
mind/
  core/                 o motor genérico (nenhuma referência ao Ultron)
    types.ts            tipos da configuração, da saída e da API
    mind.ts             createMind(): o laço (emoções, expressões, diretor)
    emotions.ts         dinâmica das emoções: rápida e de fundo
    director.ts         escolha das reações, ritmo, recargas, prioridade
    envelope.ts         trilhas das reações (ataque, sustentação, liberação)
    random.ts           gerador com semente
  personalities/
    ultron.ts           a personalidade do Ultron (só dados)
  adapters/             opcionais, independentes entre si
    storage-browser.ts  humor salvo no localStorage
    storage-node.ts     humor salvo num arquivo JSON
    pointer.ts          mouse/toque do navegador -> estímulos e foco
    tone.ts             humor -> instruções de tom para a IA e a voz
  panel/                painel de ajuste (DOM, só para desenvolvimento)
  test/                 testes do núcleo com semente fixa (Node, sem navegador)
  tsconfig.json         próprio: o módulo não depende do tsconfig do app
  SPEC.md
```

Os hosts ficam **fora** de `mind/`:

| Host | O que faz |
|---|---|
| `proto/` | Liga os canais à figura de partículas (seção 12) |
| `src/` | Liga `store.phase` ao contexto, o wake word ao chamado e o reconhecimento de voz aos nomes proibidos |
| `bridge/` | Injeta o tom na persona da IA |

---

## 2. Conceitos

| Termo | O que é |
|---|---|
| **Estímulo** (`stimulus`) | Algo que aconteceu, com nome e carga opcional: `call`, `pointerErratic`, `taskFailed` |
| **Sentido** (`sense`) | Um fato contínuo que o host mantém atualizado: onde está o foco (o usuário) e se ele está parado |
| **Emoção** (`emotion`) | Um número de 0 a 1 com duas partes: a **do momento** (rápida) e a **de fundo** (lenta, salva entre sessões) |
| **Expressão** (`expression`) | Ligação contínua entre emoção e canal: irritação esquenta as artérias o tempo todo |
| **Reação** (`reaction`) | Um acontecimento com começo e fim, feito de trilhas sobre canais. Pode ser *reflexo* (responde a um estímulo), *espontânea* (sorteada pelo diretor) ou *resposta ao chamado* |
| **Canal** (`channel`) | Um botão do corpo com nome e significado fixo (seção 4) |
| **Contexto** (`context`) | O estado do host (`dormant`, `speaking`…). Define quanta liberdade ele tem |
| **Diretor** (`director`) | Decide quando e qual reação acontece |
| **Temperamento** (`temper`) | Três botões globais: intensidade, frequência e volatilidade |

---

## 3. API do núcleo

```ts
const mind = createMind(ultron, { seed, storage, now })   // now: () => segundos, injetável

mind.setContext('dormant')                     // o estado do host
mind.stimulate('pointerErratic', { strength: 0.8 })
mind.sense('focus', { x: 0.3, y: -0.1, present: true, still: 4.2 })  // -1..1, segundos parado
mind.tick(dt)                                  // a cada quadro (ou a cada 100 ms num servidor)

const out = mind.output()
// out.channels  { 'gaze.x': -0.6, 'gaze.weight': 0.85, 'eyes.gain': 1.3, ... }
// out.mood      { boredom: 0.62, irritation: 0.18, vanity: 0.41, dominant: 'boredom' }
// out.active    nome da reação em curso, ou null

mind.on('reaction', (e) => {})                 // começou/terminou: para log, som, painel
mind.on('answer', (a) => {})                   // resposta ao chamado: { style, delay, tone }
mind.config                                    // a configuração viva (o painel edita)
mind.patch({ emotions: { irritation: { gain: 1.4 } } })
await mind.restore(); mind.save()              // usam o adaptador de storage
```

O núcleo nunca chama nada do host. O host lê `output()` quando quiser e escuta os
eventos que lhe interessam.

---

## 4. Canais (o vocabulário do corpo, v1)

Os canais têm dois tipos, e isso define como vários valores se somam:
- **offset:** o neutro é 0 e os valores se somam;
- **gain:** o neutro é 1 e os valores se multiplicam.

O olhar segue regra própria: vence quem tem mais peso.

| Canal | Tipo | Significado |
|---|---|---|
| `gaze.x`, `gaze.y` | alvo | Para onde olhar, de -1 a 1 na tela (o y cresce para baixo) |
| `gaze.weight` | 0..1 | 0 = o host segue o usuário como sempre, 1 = o alvo do `mind` manda |
| `head.pitch` | offset, rad | Positivo abaixa a cabeça, negativo ergue o queixo |
| `head.follow` | gain | Rapidez com que a cabeça segue |
| `head.restless` | gain | Amplitude da deriva ociosa da cabeça e do tronco |
| `eyes.gain` | gain | Brilho dos olhos |
| `eyes.boost` | offset | Luz somada aos olhos (o sonho) |
| `eyes.flicker` | 0..1 | Tremor dos olhos (aviso, falha) |
| `eyes.lid` | gain | Abertura dos olhos: 0 fechado (uma piscada), acima de 1 arregalado |
| `eyes.squint` | offset, 0..1 | A pálpebra de baixo sobe (olhar estreito) |
| `eyes.tilt` | offset, -1..1 | Positivo baixa a pálpebra de cima perto do nariz (raiva); negativo, perto da têmpora |
| `eyes.pupil` | gain | Tamanho da íris |
| `face.heat` | offset, 0..1 | Quanto o brilho vermelho do rosto esquenta |
| `breath.rate`, `breath.depth` | gain | Ritmo e profundidade da respiração |
| `body.rise` | offset, 0..1 | Um fôlego fundo que ergue o corpo todo (o suspiro), fora do ritmo da respiração |
| `glow` | gain | Brilho geral |
| `arteries.heat` | offset, 0..1 | Intensidade das artérias (soma com a da voz) |
| `arteries.beat` | gain | Força do batimento em repouso |
| `crumble:<região>` | 0..1 | Quanto da região se desfaz em poeira |
| `rebuild:<região>` | 0..1 | Progresso de uma peça que se solta, gira e se reencaixa |

As regiões são só nomes (`shoulderL`, `chestR`…). O host define o que cada uma é e
ignora as que não conhece. Para criar um canal novo, basta o host passar a entendê-lo:
o núcleo não precisa mudar.

---

## 5. Emoções

### Dinâmica

Cada emoção tem duas partes:
- **a do momento (`value`):** sobe com estímulos e impulsos e volta sempre ao `rest`, com
  meia-vida `halfLife`;
- **a de fundo (`mood`):** acompanha devagar o quanto a do momento fica acima do repouso
  (taxa `memory.share`, fração por minuto) e cai com meia-vida longa (`memory.halfLife`, em
  horas). É ela que sobrevive entre sessões: se você o irritou muito ontem, ele começa
  hoje um pouco irritado.

O valor visível é `clamp((value + mood) * gain * temper.intensity)`: o rancor levanta o
piso e o momento soma por cima. O fundo acompanha só a parte do momento, nunca a si
mesmo, então um impulso constante não o faz crescer sem limite. Uma emoção sem `memory`
não tem fundo.

### Esquema

```ts
emotions: {
  boredom: {
    rest: 0, gain: 1, halfLife: 600,           // segundos
    memory: { share: 0.05, halfLife: 2 * 3600 },
  },
}
drives: {                                      // impulsos contínuos, por segundo
  idle:     { after: 10, boredom: +0.005 },    // sem interação há mais de 10 s
  boredom:  { above: 0.8, irritation: +0.002 },// tédio demais vira irritação
}
```

### Ultron v1

| Emoção | rest | halfLife | memória (share, halfLife) | Sobe com | Desce com |
|---|---|---|---|---|---|
| `boredom` | 0 | 600 s | nenhuma (o chamado cura) | Tempo sem interação: chega ao máximo em ~4–5 min | Interação, chamado, suspiro, varredura |
| `irritation` | 0 | 45 s | 0.08, 8 h | Cursor errático, chamados repetidos, nomes proibidos, tarefa falhando, tédio no máximo | Instabilidade (desabafo) e o tempo |
| `vanity` | 0.35 | 120 s | 0.05, 12 h | Autoaperfeiçoamento, tarefa bem feita | Nomes proibidos |

O humor dominante é a emoção mais alta acima de 0.35. Se nenhuma passar disso, é `neutral`.

### Temperamento (globais)

| Botão | Efeito |
|---|---|
| `intensity` | Multiplica todas as emoções visíveis e a força das expressões |
| `frequency` | Multiplica a taxa de reações espontâneas |
| `volatility` | Multiplica o impacto dos estímulos nas emoções |

---

## 6. Estímulos

```ts
stimuli: {
  pointerErratic: { interaction: true, irritation: +0.12, scale: 'strength', every: 0.5 },
  call:           { interaction: true, boredom: '*0.3', vanity: +0.05,
                    again: { within: 30, irritation: +0.15 } },
}
```

Regras do esquema:
- `+x` soma, e `'*x'` multiplica o valor do momento;
- `scale` usa um campo da carga;
- `every` limita a frequência;
- `interaction: true` zera o relógio de ociosidade.

O núcleo também gera estímulos sozinho:

| Estímulo | Quando |
|---|---|
| `rise:<emoção>:<limite>` | A emoção cruza o limite para cima |
| `fall:<emoção>:<limite>` | A emoção cruza o limite para baixo |
| `idle` | Começa a ociosidade |

### Ultron v1

| Estímulo | Quem envia | Efeito |
|---|---|---|
| `interaction` | Adaptador `pointer`, teclado | boredom -0.02 (no máximo 1 por s) |
| `pointerErratic` {strength} | `pointer`: ≥ 3 inversões de direção em 1 s, acima de 0,8 tela/s | irritation +0.12 × strength |
| `pointerCalm` | `pointer`: 1 s sem erraticidade | Nenhum (encerra o desprezo) |
| `pointerLeft` {x, y} / `pointerReturned` | `pointer` | Nenhum (dispara reflexos) |
| `call` | Host: wake word ou clique para acordar | boredom ×0.3, vanity +0.05; outro chamado em menos de 30 s soma irritation +0.15 |
| `forbiddenName` {word} | Host: reconhecimento de voz | irritation +0.6, vanity -0.1 |
| `taskDone` / `taskFailed` | Host: resultado de ferramenta | vanity +0.08 / irritation +0.2 |

---

## 7. Contextos (liberdade por estado)

```ts
contexts: {
  dormant:  { freedom: 1,   expression: 1 },
  ...
}
```

| Contexto | freedom | expression | Leitura |
|---|---|---|---|
| `offline`, `boot` | 0 | 0 | O `mind` fica pausado; as emoções só decaem |
| `dormant` | 1 | 1 | Livre: espontâneas e reflexos |
| `waking` | — | — | Ocupado pela resposta ao chamado |
| `listening` | 0.2 | 0.6 | Só reflexos sutis (borda da janela); está atento a você |
| `thinking`, `tooling` | 0.1 | 0.8 | Sem eventos; a irritação aparece nas artérias enquanto trabalha |
| `speaking` | 0 | 1 | Nenhum evento; o humor colore tudo (tom da voz, artérias, olhos) |

Cada reação declara `minFreedom`. Os impulsos de ociosidade só correm onde `idle` faz
sentido, o que é configurável por contexto.

---

## 8. Reações e diretor

### Esquema de uma reação

```ts
sigh: {
  kind: 'spontaneous',             // 'reflex' (com on: 'estímulo') | 'spontaneous' | 'answer'
  minFreedom: 0.8,
  when: { focusStill: 3 },         // condições: foco parado há 3 s, foco ausente, emoção acima de…
  favoredBy: { boredom: 1.5, vanity: 0.3 },
  requires: {},                    // mínimos e máximos de emoção: { irritation: [0.3, 1] }
  cooldown: 60,
  chance: 1,                       // para reflexos: probabilidade de reagir ao estímulo
  priority: 1,                     // reflexo de prioridade maior interrompe a espontânea
  warn: [ /* trilhas de aviso antes do principal */ ],
  does: [
    { ch: 'breath.depth', to: [2, 2.8], attack: 1.2, hold: [0.2, 0.6], release: [1.8, 2.6] },
    { ch: 'glow', to: [0.82, 0.9], attack: 1.5, hold: 0.4, release: 2 },
  ],
  mirror: true,                    // sorteia o lado (inverte os x)
  after: { boredom: -0.1 },        // efeito nas emoções ao terminar
}
```

- **Trilhas:** cada uma tem `at` (atraso), `attack`, `hold` e `release`.
- **Variação:** números escritos como `[min, max]` são sorteados a cada vez que a reação toca.
- **Olhar:** o canal `gaze` aceita alvos com nome: `focus`, `awayFromFocus`,
  `lastFocus`, `center` e `{ sweep: [de, até] }`.
- **Deixas (`cue`):** uma trilha pode, em vez de um canal, mandar um gesto pontual que o
  host executa sozinho: `{ cue: 'arteries.surge', at: 0.2, args: { speed: 700 } }` vira um
  evento `cue` no momento `at`. Serve para o que não é um envelope, como a onda que sobe
  pelas artérias ou, no futuro, um som.

### Ritmo das espontâneas

O intervalo até a próxima é `minGap` mais um sorteio exponencial, como chuva, com média
`mean / frequency / (1 + 0.8 × boredom)`. O resultado é irregular: às vezes 25 s, às
vezes 3 min. Ultron v1: `minGap 20 s`, `mean 60 s`, teto de 4 min.

Quando o tempo chega:
- Entram como candidatas as reações permitidas no contexto, com condições satisfeitas,
  fora da recarga e diferentes da última.
- O peso de cada uma é a base × (1 + Σ favoredBy × emoção) × prontidão. A prontidão vai
  de 0, logo depois da recarga, a 1, no dobro da recarga.
- Um peso de **"nada"** (`rhythm.rest`, Ultron 0.6) concorre junto: às vezes ele
  simplesmente não faz nada. O silêncio é parte da personalidade.

### Regras do diretor

- Uma reação por vez.
- Um reflexo de prioridade maior interrompe a reação em curso, liberando-a em 0,25 s.
- As respostas ao chamado têm prioridade máxima.
- As expressões contínuas correm por baixo de tudo, sempre.

---

## 9. Resposta ao chamado

Três garantias fazem parte do motor e não dependem de configuração:

1. **Reconhecimento imediato:** em até 0,2 s o canal `eyes.flicker` dá um sinal, mesmo
   que o resto demore.
2. **Escuta imediata:** o evento `answer` sai na hora, e o host abre o microfone sem
   esperar a encenação.
3. **Atraso máximo:** 2,0 s até a resposta principal começar, seja qual for o humor.

A resposta tem duas partes:
- **prelúdios:** opcionais, independentes e combináveis;
- **estilo:** um, escolhido por sorteio ponderado pelo humor e quase sempre o dominante,
  mas nem sempre.

### Prelúdios (Ultron v1)

| Prelúdio | Quando | O que faz |
|---|---|---|
| `sigh` | boredom > 0.5 (chance cresce com ele) | Suspiro curto de 0,6–1,0 s |
| `ignore` | irritation > 0.4 | Os olhos piscam e ele não se move por 0,6 + 1,0 × irritação s |

O total dos prelúdios respeita o teto de 2 s.

### Estilos (Ultron v1)

| Estilo | Favorecido por | Cabeça | Olhos | Artérias |
|---|---|---|---|---|
| `eager` | neutro | Ergue em 0,4 s e encara você | Flash rápido | Pulso único sobe pelas 4 em 0,65 s |
| `weary` | boredom | Ergue devagar, em 1,2 s | Acendem em rampa | Pulso lento |
| `curt` | irritation | Tranco: vira para você em 0,15 s | Duros (×1,6), sem flash | Quentes (+0.5) e ficam assim por 3 s |
| `regal` | vanity | Sem pressa, em 1,0 s, queixo erguido (-0,06 rad) | Acendem por completo, devagar | Pulso amplo até o topo da cabeça |

O evento `answer` leva `{ style, preludes, delay, settle }`:
- `delay`: quando o estilo começa;
- `settle`: quando o host pode seguir para o listening, ambos em segundos a partir do
  chamado.

O tom para a voz (seção 10) virá no lote 3.

**Como ficou implementado:**
- **Humor usado:** o diretor responde com o humor de *antes* do chamado. Ele atende
  entediado, e só depois o chamado cura o tédio.
- **Peso dos estilos:** `base × e^(sharpness × Σ favoredBy × destaque)`. O destaque é
  quanto a emoção passa de 0,35. Ultron: `sharpness 5`, `eager` com base 5.
- **Resultado nos testes (300 chamados cada):**

  | Humor | Estilos escolhidos |
  |---|---|
  | Calmo | ~60% `eager` |
  | Irritado (0,9) | ~96% `curt`, sempre depois de `ignore` |
  | Entediado (0,95) | ~94% `weary`, quase sempre depois de `sigh` |

  O atraso máximo medido foi 2,00 s.

---

## 10. Tom da voz (adaptador `tone.ts`)

`toneFor(mood, personality)` devolve dois resultados:
- **instruções de tom** para o prompt da IA;
- **ajustes de TTS** (velocidade, altura), quando o motor de voz permitir.

As faixas ficam na personalidade (`voice.tones`), por exemplo:

| Condição | Instrução (exemplo) |
|---|---|
| irritation ≥ 0.6 | Responda curto e seco, sem cortesias |
| boredom ≥ 0.6 | Deixe transparecer tédio, com ironia leve |
| vanity ≥ 0.6 | Tom teatral e superior |

Uma regra fixa do adaptador vem anexada sempre: **o tom muda a forma, nunca o
conteúdo.** Ele sempre cumpre o pedido e nunca recusa ou omite por causa do humor.

---

## 11. Persistência

- **Salvo:** valor do momento e de fundo de cada emoção, horário do último chamado e
  horário do salvamento, com `version`.
- **Quando:** a cada 10 s e ao fechar ou esconder a página.
- **Ao restaurar:** o tempo fora é aplicado. As emoções decaem pelas suas meias-vidas, e
  o tempo ausente conta como ociosidade até `maxAway` (Ultron: 30 min de efeito). Depois
  de uma noite fora, ele volta entediado, mas não furioso.
- **Interface:** `{ load(): Promise<Saved | null>, save(s: Saved): Promise<void> }`.
  Emoções que sumirem da configuração são ignoradas; emoções novas começam no repouso.

---

## 12. A figura de partículas como host (`proto/`)

| Canal | Liga em |
|---|---|
| `gaze.*` | Alvo de `look.yaw/pitch`, misturado com o cursor pelo peso |
| `head.pitch`, `head.follow`, `head.restless` | `nod`, `follow`, amplitude das ondas ociosas |
| `eyes.gain`, `eyes.flicker` | `eyeGain` |
| `eyes.lid`, `eyes.squint`, `eyes.tilt`, `eyes.pupil` | Os olhos desenhados pelo motor (`uEyeSt`), por cima do que cada estado pede |
| `face.heat` | Brilho das camadas do rosto, junto com o calor das artérias e a fala |
| `breath.rate`, `breath.depth` | `breathW`, `breathAmp` (por cima dos valores do dormant de hoje) |
| `glow` | `lifeNow` |
| `arteries.heat`, `arteries.beat` | `artHeat` (máximo com o da voz), `uArtBeat` |
| `crumble:<região>`, `rebuild:<região>` | Shader: elipses em px do canvas (`REGIONS`), aplicadas antes do giro para acompanhar o corpo. Na instabilidade, cada partícula é lançada 14–60 px numa direção própria, gira como poeira e afunda um pouco. No autoaperfeiçoamento, a região gira 6–15° em torno do centro e se afasta 8–14 px do corpo |
| deixa `arteries.surge` | Uma onda forte sobe pelas 4 artérias (`uArtSurge`), atravessando as placas por onde passa, e some depois do topo da cabeça |

Regiões: `shoulderL/R` (125, 640), `collarL/R` (318, 565), `chestL/R` (345, 760) e
`abdomen` (512, 930). As do lado direito são espelhadas.

**O chamado no `proto/`:** a tecla **C**, o botão **2 waking** e o passo do fluxo
**F** chamam o Ultron. A figura entra em `waking` quando o estilo começa e em
`listening` no `settle`. A faixa larga que varria o corpo no waking saiu, e a onda nas
artérias faz esse papel.

O que o dormant faz hoje (respiração de 5 s, batimento, sonho, cabeça baixa) continua
sendo a **base**. O `mind` só modula por cima. O "sonho" passa a ser uma reação
espontânea do `mind`, com os mesmos números.

---

## 13. Ultron v1: expressões e reações livres

### Expressões contínuas

| Emoção | Canais |
|---|---|
| boredom | breath.rate ×(1 + 0,6b); head.restless ×(1 + 1,5b) |
| irritation | arteries.heat +0,35i²; eyes.gain ×(1 + 0,4i); breath.rate ×(1 + 0,3i); head.follow ×(1 + 0,5i) |
| vanity | head.pitch -0,05v (queixo erguido); eyes.gain ×(1 + 0,15v) |

### Reações

| # | Reação | Tipo | Gatilho / condições | Favorecida por | Recarga | O que faz | Depois |
|---|---|---|---|---|---|---|---|
| 1 | `lookAway` | reflexo | `pointerErratic`; só dormant; chance 0,6 + 0,4i | irritation | 8 s | Olhar `awayFromFocus` (peso 0,85, 0,35 s), queixo -0,03; sustenta até `pointerCalm` + 0,5–1,5 s; volta em 0,8 s | irritation +0,05 |
| 5 | `watchExit` | reflexo | `pointerLeft`; dormant e listening; chance 0,8 | — | 20 s | Olhar `lastFocus` empurrado à borda (peso 1), sustenta 2–4 s, volta devagar (1,2 s). Se o cursor voltar antes, vira para ele rápido | — |
| 6 | `waitForOrders` | reflexo | `rise:boredom:0.85` | — | 90 s | Olhar `center` (peso 0,9), queixo -0,04, olhos ×1,3, 4–8 s | — |
| 7 | `sigh` | espontânea | Foco parado ≥ 3 s ou ausente | boredom 1,5; vanity 0,3 | 60 s | Respiração ×2–2,8 (sobe em 1,2 s, solta em 1,8–2,6 s); brilho ×0,82–0,9; ao soltar, cabeça +0,03–0,06 e olhos ×0,7 | boredom -0,1 |
| 8 | `crumble` | espontânea | requires irritation ≥ 0,3 | irritation 2 | 180 s | Aviso: eyes.flicker 0,6 por 0,3–0,6 s. Uma região sorteada (ombros, peito, clavícula) se desfaz 0,5–0,9 em 0,15 s, fica 0,6–1,2 s e é **puxada de volta em 0,35 s**, com artérias +0,4 no tranco | irritation -0,2 |
| 9 | `selfImprove` | espontânea | requires irritation ≤ 0,4 | vanity 1,5 | 150 s | Uma placa sorteada se solta 8–14 px, gira 6–15° e se reencaixa em 1,5–2,5 s; olhos ×1,15 | vanity +0,1 |
| 10 | `scan` | espontânea | Foco parado ≥ 5 s ou ausente | boredom 0,8; vanity 0,4 | 45 s | Olhar em varredura de um lado ao outro (±0,6–0,9) em 4–7 s, às vezes com pausa no meio; olhos ×1,1–1,25 | boredom -0,05 |
| — | `dream` | espontânea | Só dormant, foco ausente ou parado; peso base 1,5 | — | 20 s | O sonho atual: olhos +0,5 por 0,35 s. Agora concorre no sorteio com as outras, então sai a cada ~3 min, e não mais a cada 20–40 s | — |
| 11 | `forbiddenName` | reflexo | `forbiddenName`; qualquer contexto ativo | — | 5 s | Dormant: artérias +0,8 (0,1 s, sustenta 0,6–1 s, solta 1,5 s), olhos ×2, crumble pequeno (0,3), tranco do olhar para você. Contextos ativos: só artérias e olhos | — |

---

## 14. Painel de ajuste (dev)

Abre com `E` no `proto/`. É genérico: é montado a partir da configuração, então
funciona para qualquer personalidade.

**Mostra:**
- uma barra por emoção (o momento, com uma marca no fundo) e o humor dominante;
- o contexto e quando sai a próxima espontânea;
- a reação em curso;
- um log dos últimos 12 estímulos e reações.

**Controla:**
- sliders do temperamento;
- `rest`, `gain` e `halfLife` de cada emoção;
- peso, recarga e liga/desliga de cada reação;
- botões para disparar qualquer estímulo ou forçar qualquer reação;
- **tempo ×10**, para ver o humor evoluir rápido;
- zerar o humor.

**Exporta:**
- **"copiar config"** copia só o que mudou em relação ao padrão, em JSON curto, para
  você me colar;
- **"copiar humor"** copia o estado atual das emoções.

Os ajustes ficam guardados no navegador (só dev) até serem incorporados ao arquivo da
personalidade.

---

## 15. Testes

Os testes do núcleo rodam em Node, com `tsx`, semente fixa e relógio simulado, sem
navegador. Por exemplo:
- "5 min sem interação levam o tédio a ≥ 0,85 e disparam `waitForOrders`";
- "irritação 0,9 + chamado escolhe `curt` na maioria das sementes e respeita 2 s";
- "a mesma espontânea nunca sai duas vezes seguidas";
- "restaurar depois de 8 h deixa a irritação de fundo e não a do momento".

É a forma mais barata de verificar o comportamento: números, não capturas de tela.

---

## 16. Plano em lotes

| Lote | Conteúdo |
|---|---|
| **1** (feito) | Núcleo (tipos, emoções, diretor, envelopes, gerador com semente, contextos), personalidade do Ultron (emoções, estímulos, expressões), `storage-browser`, `pointer`, testes, painel e host `proto/` para os canais que já existem. Reações: `lookAway`, `watchExit`, `waitForOrders`, `sigh`, `scan`, `dream` |
| **2** (feito) | `crumble` e `selfImprove` (regiões no shader) e as respostas ao chamado no `proto/`, com o chamado simulado por tecla |
| **3** | Integração: `src/` (`store.phase` → contexto, wake word → `call`, reconhecimento de voz → `forbiddenName`, ferramentas → `taskDone`/`taskFailed`), `tone.ts` no prompt da persona, `storage-node` se o bridge precisar |

## 17. Pontos para você decidir

1. **Nome e lugar do módulo:** `mind/` na raiz do repositório, ao lado de `bridge/`.
   Mais tarde pode virar um pacote próprio (`@ultron/mind`) sem mudar o código.
2. **Idioma das instruções de tom:** o mesmo da persona atual do app.
3. **Números:** todos os desta especificação são o ponto de partida. A ideia é afinar
   pelo painel, e não discutir agora.
