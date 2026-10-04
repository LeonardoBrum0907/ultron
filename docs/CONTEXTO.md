# ULTRON: contexto do projeto

Documento de contexto para agentes que forem trabalhar neste repositório. Ele resume o
que existe, como está organizado, o que foi decidido com o usuário e o que falta.
Atualizado em 2026-10-04.

---

## 1. Como trabalhar com este usuário

- **Idioma:** o usuário escreve em português (pt-BR); responda em português. Código,
  identificadores, comentários e mensagens de commit ficam em **inglês**, seguindo o
  padrão do repositório.
- **Processo combinado para mudanças visuais e de comportamento**, o mais barato em tokens:
  1. descrever a proposta em 3 a 5 linhas de texto;
  2. o usuário aprova ou corrige;
  3. implementar, rodar lint e testes, e verificar com **números** (não capturas de tela);
  4. o usuário testa ao vivo no navegador e manda os ajustes de uma vez.
- **Esboço visual** (imagem) só vale para decisões de lugar, como o trajeto das artérias.
  Para animação e tempo, um esboço parado não ajuda.
- **Capturas de tela custam caro em tokens.** Só faça quando for algo espacial ou houver
  suspeita de bug.
- **Commits:** só quando o usuário pedir. Faça commits separados por área (`src/`,
  `mind/`, `proto/`). **Nunca faça push** sem pedido explícito. Antes de commitar,
  confira `git diff --cached --name-only`: já houve arquivos antigos pré-adicionados no
  índice que entraram no commit errado.
- **Não edite arquivos com PowerShell** (`Get-Content -Raw` + `Set-Content`). No Windows
  PowerShell 5.1 desta máquina isso corrompe UTF-8 (`·` virou `Â·`) e acrescenta BOM.
  Use as ferramentas de edição, ou Node com `fs.readFileSync(p, 'utf8')`.
- **Ambiente:** Windows 11, shell padrão PowerShell 5.1 (Git Bash também disponível),
  Node 24.

---

## 2. O que é o projeto

**ULTRON** é um assistente de voz no navegador com uma interface holográfica. Você diz
"Hey Ultron", ele acorda, escuta e executa tarefas reais por ferramentas.

| Parte | Tecnologia |
|---|---|
| Interface (o rosto) | React 19 + Vite + Three.js (react-three-fiber) + GLSL próprio |
| Cérebro | Claude Code rodando headless como biblioteca, via um bridge Node (`bridge/`). Usa o login do Claude Code, sem chave de API |
| Voz | Palavra de ativação com Picovoice Porcupine, TTS com Kokoro, ElevenLabs opcional |
| Visão | MediaPipe para mãos e gestos, câmera |

- **Origem:** começou como **JARVIS**, um fork de `adewaskar/jarvis` (remoto `upstream`),
  e foi renomeado para ULTRON (commit `a113f7a`).
- **Remoto do usuário:** `origin` = `github.com/LeonardoBrum0907/ultron`.
- **Comandos do app:** `npm start` (bridge + interface), `npm run dev` (só a interface,
  porta 5173) e `npm run bridge`.

### Estrutura do repositório

```
src/            o app React (interface atual: HUD, núcleo GLSL, blades, mãos)
  store.ts      estado global (zustand); as fases do assistente estão aqui
  ui/           Hud, Ignition (tela de clique inicial), Pointer, Blades...
  scene/        Core.tsx (núcleo GLSL), Scene.tsx, Particles, Orbits
  lib/          voz, tts, bridge, câmera, mãos, música...
bridge/         servidor Node que roda o Claude Code (o cérebro) e ferramentas
scripts/        setup.mjs, start.mjs
proto/          PROTÓTIPO da nova interface: o Ultron feito de partículas (seção 4)
mind/           ORQUESTRADOR DE EMOÇÕES, módulo independente (seção 5)
docs/           este documento
```

As fases do app ficam em `src/store.ts` (`Phase`): `offline`, `boot`, `dormant`,
`waking`, `listening`, `thinking`, `tooling` e `speaking`.

---

## 3. Estado do git

- **Branch de trabalho:** `proto-particulas`. O branch principal é `main`.
- **Commits desta frente**, em cima de `a113f7a`, nada enviado ao GitHub:

  | Commit | Conteúdo |
  |---|---|
  | `635291b` | Otimizações de desempenho em `src/` (shader do núcleo, pós-processamento, HUD, mãos) |
  | `727936a` | `mind/`: o orquestrador de emoções (lote 1) |
  | `2dc32a3` | `proto/`: o protótipo de partículas |
  | `c8e7e9d` | `mind/`: respostas ao chamado, deixas, instabilidade e autoaperfeiçoamento (lote 2) |
  | `90031e9` | `proto/`: chamado, onda nas artérias e regiões do corpo |

  Os commits seguintes (listening, thinking, tooling) estão no `git log`.

- **Fora do git, de propósito:** `proto/ref/`, com as imagens de referência usadas para
  gerar a arte (fotos do WhatsApp e uma arte de terceiros do Ultron).
- **Tamanho:** há cerca de 25 MB de PNGs gerados no histórico, longe dos limites do GitHub.

---

## 4. O protótipo de partículas (`proto/`)

É uma página independente que desenha o Ultron como uma figura holográfica com mais de
100 mil partículas. A contagem total aparece no painel de stats; cada rosto de estado é
uma camada própria, então nem todas ficam visíveis ao mesmo tempo. Ela vai substituir a interface atual, mas **ainda não está integrada
ao app**.

- **Abrir:** com `npm run dev`, acesse `http://localhost:5173/proto/index.html`.
- **Arquivo principal:** `proto/main.js`, com cerca de 2.200 linhas, Three.js e um único
  vertex shader para todas as camadas. A audição (microfone e voz simulada) fica em
  `proto/hearing.js`.

### 4.1 Arte

- **Render de origem:** `proto/gen/v2.png` foi gerada com IA (Higgsfield, FLUX 3) a partir
  das referências do usuário. `v1`, `v3` e `v4` são alternativas que o código não usa.
- **Gerador:** `node proto/art/from-image.mjs` divide a render em camadas e grava tudo em
  `proto/img-v2/`:
  - linhas, contorno, poeira, veias vermelhas, olhos e o rosto de cada estado;
  - o contorno do queixo (`chin.png`);
  - o mapa de placas (`plates.png`), que não é desenhado e só diz onde há metal por cima;
  - `meta.json`, com orçamentos de partículas e o trajeto das artérias.
- **Arte antiga:** a versão procedural fica em `proto/art/generate.mjs` → `proto/img/` e
  abre com `?art=procedural`.
- **Coordenadas:** o canvas tem 1024×1100 px, e y no canvas = y na render + 76. Rode o
  gerador de novo sempre que editar a arte.

### 4.2 Como a figura funciona

- **Estados:** a tabela `STATE` dá alvos (brilho, ritmo, quanto as partículas vagueiam,
  quanto a cabeça segue o cursor, respiração…), e o laço de quadros suaviza a transição
  até eles.
- **Cores:** fixas, ciano e vermelho, que são a identidade do Ultron. O estado se lê por
  efeitos, nunca pela cor.
- **`offline`:** não há forma. Todas as partículas flutuam soltas como poeira, e o cursor
  abre um pequeno vão nela, bem sutil.
- **`boot`:** o clique dispara a montagem, com 5 correntes de vento que levam a poeira
  até o lugar certo:
  - o vermelho sobe de baixo para cima;
  - o ciano varre da esquerda para a direita, começando aos 0,9 s;
  - os olhos chegam por último, ~8 a 10 s;
  - a montagem termina em 10,8 s.

  Cada boot sorteia rotas novas. A tecla R repete o último, e `?seed=N` fixa a sequência.
- **Cabeça e tronco seguem o cursor:** yaw ±0,44 rad e pitch ±0,2 rad, suavizados a
  4,2/s, com ganho por estado. Como a arte é 2D, o giro é falso, feito por paralaxe.
  - **Cabeça:** é rígida até a linha da mandíbula (`jawLine`).
  - **Pescoço:** são dois cabos de aço que torcem. As partículas cobertas pela mandíbula
    deslocada escurecem para 15% (oclusão falsa).
  - **Trapézio:** acompanha só o tronco.
  - **Tronco:** gira até 0,14 rad, ~0,55 s atrás da cabeça.
- **Clique:** um pulso de luz atravessa o corpo (ganho 0,8, ou 2,0 nas veias).
- **Artérias:** quatro, saindo dos portais vermelhos do peito.
  - **Trajeto:** as 2 internas vão até as bochechas e as 2 externas até o topo da cabeça.
  - **Discretas:** passam por baixo das placas de metal (`plates.png`) e só aparecem em
    alta intensidade.
  - **Intensidade (`artHeat`):** volume da voz mais o que o humor acrescenta.
  - **Origem alternativa:** `?arteries=core` usa o núcleo do peito em vez dos portais.
- **`dormant`:**
  - respiração de 5 s (sobe 3 px; o brilho vai de 36% a 52%);
  - um batimento fraco por respiração, que sai dos portais e morre no pescoço;
  - cabeça baixa ~4°, seguindo o cursor pela metade e com ~1 s de atraso;
  - olhos como brasa que respira.
- **`waking`:** é a resposta do orquestrador ao chamado (seção 5.6), não tem mais animação
  fixa.
- **Papel de cada artéria** (combinado com o usuário):
  - externas descendo: `listening` (a voz que entra);
  - externas subindo: `thinking`;
  - internas subindo: `speaking` (a voz que sai; ainda não feito);
  - as quatro em ritmo de motor: `tooling`.
- **`listening`:** queixo erguido.
  - Cada sílaba da voz (microfone real com `M`, ou voz simulada) manda um pulso descendo
    as artérias externas, do ouvido até o peito, com força pelo pico da sílaba.
  - Os olhos reagem à voz; o fim da frase acende os portais do peito.
  - A poeira em volta do corpo (fundo e a camada junto às placas) se agita com o áudio.
  - Silêncio: impaciência aos 6 s e desprezo aos 16 s (seção 5.5).
- **`thinking`:** pulsos sobem as artérias externas até o alto do crânio, onde a luz se
  junta. Olhar ausente, fixo num ponto sorteado; olhos a 0,7 com falhas; corpo parado.
- **`tooling`:** o motor do peito manda pulsos pelas quatro artérias, alternando
  esquerda e direita. O trabalho aparece nos 4 discos vermelhos (`DISCS`):
  - os do peito são pistões, que pulsam a cada batida;
  - os dos ombros são turbinas: "lâminas de luz" que giram até 1,6 volta/s (`TOP`), sem
    mover as partículas.
  - **Fim da tarefa:** `T` = sucesso: os pulsos já lançados terminam o trajeto, nenhum
    novo sai, as turbinas desaceleram e os discos dão um clarão. `Y` = falha: o motor
    engasga, os pulsos travam, piscam e apagam, e as turbinas param com um tranco.
- **Removido a pedido do usuário:** a linha vermelha horizontal sobre os olhos (camada
  `streak`), o arrasto de vento na figura montada, a "faixa larga" do waking, as ondas em
  volta dos ouvidos (listening), a espiral (thinking), as placas se ajustando e os anéis do
  rosto (tooling) e as turbinas girando as próprias partículas, que pareciam amassadas.

### 4.3 Controles e ganchos de dev

| Tecla | Ação |
|---|---|
| `0`–`6` | offline, dormant, **2 = chamado**, listening, thinking, tooling, speaking |
| `B` | boot |
| `R` | repete o último boot |
| `F` | fluxo completo de uma conversa, automático |
| `P` | paleta (tudo vermelho) |
| `C` | chamado |
| `M` | liga e desliga o microfone real (sem ele, o listening usa voz simulada) |
| `T` / `Y` | tarefa concluída / falhou |
| `E` | painel do orquestrador |

**Parâmetros de URL:**
- `?state=dormant` abre direto num estado;
- `?seed=N` fixa o boot;
- `?budget=0.35` desenha menos partículas;
- `?art=procedural` usa a arte antiga;
- `?arteries=core` muda a origem das artérias.

**`window.__ultron`:**
- `pose = {yaw, pitch, body, bodyPitch}` congela a pose;
- `artHeat` fixa a intensidade das artérias;
- `hold`, `trailAt` e `clickAge` congelam animações;
- `layers` dá acesso às camadas;
- `mind` é o orquestrador;
- `call()` e `dream()` disparam o chamado e o sonho;
- `hearing` e `listen` expõem a audição e os pulsos do listening;
- `info()` mostra o estado das interações.

---

## 5. O orquestrador de emoções (`mind/`)

**Por que existe:** o Ultron é uma **personalidade**, não este app. O usuário quer que ele
possa viver em outros sistemas, então as emoções ficam num módulo independente e
reutilizável. Especificação completa e decisões em **`mind/SPEC.md`**.

**Personalidade pedida pelo usuário:** um vilão com superioridade, instabilidade e
impaciência, mas que **precisa responder ao usuário**. Inspirado no Ultron da Marvel:
complexo de deus, humor ácido, teatral, odeia ser chamado de "marionete" ou comparado ao
Stark e ao Jarvis.

### 5.1 Arquitetura

```
mind/
  core/            motor genérico, TypeScript puro, sem dependências e sem DOM
    types.ts       formato da personalidade, da saída e dos eventos
    mind.ts        createMind(): emoções, estímulos, contextos, saída, persistência
    director.ts    decide quando e qual reação toca; atende o chamado
    emotions.ts    dinâmica de cada emoção
    envelope.ts    curvas das trilhas (ataque, sustentação, liberação)
    config.ts      vocabulário de canais do corpo, constantes, merge/diff
    random.ts      gerador com semente (mulberry32)
  personalities/
    ultron.ts      a personalidade do Ultron: SÓ DADOS
  adapters/        opcionais: storage-browser.ts (humor no localStorage), pointer.ts (mouse → estímulos)
  panel/panel.ts   painel de ajuste ao vivo (dev)
  test/run.ts      testes em Node com semente fixa e relógio simulado
  SPEC.md          especificação
```

**Princípios:**
- **Núcleo puro:** o host chama `tick(dt)`, e o núcleo não tem relógio nem sorteio próprios.
- **A personalidade é dado:** outra personalidade seria outro arquivo, com o mesmo motor.
- **O corpo é abstrato:** o motor emite canais com nome, e cada host liga os que entende.
- **O núcleo nunca chama o host:** o host lê `output()` e escuta eventos.

### 5.2 API

```ts
const mind = createMind(ultron, { seed, storage })
mind.setContext('dormant')                         // estado do host
mind.stimulate('pointerErratic', { strength: 1 })  // algo aconteceu
mind.sense('focus', { x, y, present })             // onde está o usuário (-1..1)
mind.tick(dt)
mind.output()   // { channels, gaze, mood, dominant, background, active, context, nextIn }
mind.on((e) => ...)  // eventos: stimulus, reaction (start/end/cut), context, cue, answer
mind.force('sigh'); mind.patch({...}); mind.resetMood(); mind.setEmotion('irritation', 0.9)
await mind.restore(); mind.save()
```

### 5.3 Emoções

Cada emoção tem duas partes:
- **valor do momento:** volta sempre ao repouso (`rest`), com meia-vida `halfLife`;
- **fundo (`mood`):** um rancor lento que acompanha o momento, cai em horas e é **salvo
  entre sessões**.

O valor visível é `(momento + fundo) × gain × temper.intensity`.

| Emoção | Repouso | Meia-vida | Fundo |
|---|---|---|---|
| `boredom` (tédio) | 0 | 600 s | Nenhum: o chamado cura |
| `irritation` (irritação) | 0 | 45 s | Cai em 8 h |
| `vanity` (vaidade) | 0,35 | 120 s | Cai em 12 h |

O temperamento global tem três botões: `intensity`, `frequency` (das reações
espontâneas) e `volatility` (impacto dos estímulos).

### 5.4 O que mexe nas emoções

| Causa | Efeito |
|---|---|
| Sem interação há mais de 10 s (só no dormant) | Tédio +0,005/s, cheio em ~4 min |
| Tédio acima de 0,8 | Irritação +0,002/s |
| `interaction` (qualquer uso do mouse ou teclado) | Tédio −0,02 (no máximo 1 por s) |
| `voice` (sílaba ouvida) | Tédio −0,03 (no máximo 4 por s) |
| Silêncio no `listening` há mais de 6 s | Irritação +0,025/s |
| `pointerErratic` (mouse sacudido) | Irritação +0,12 × força |
| `call` (chamado) | Tédio ×0,3, vaidade +0,05; outro chamado em menos de 30 s soma irritação +0,15 |
| `forbiddenName` | Irritação +0,6, vaidade −0,1 |
| `taskDone` / `taskFailed` | Vaidade +0,08 / irritação +0,2 |
| Fim de reações (`after`) | Suspiro: tédio −0,1. Varredura: tédio −0,05. Instabilidade: irritação −0,2 (desabafo). Placa reencaixada: vaidade +0,1. Desviar o olhar: irritação +0,05 |

**Ordem dos efeitos:** o diretor reage com o humor de **antes** do estímulo, e só depois
o estímulo mexe nas emoções. Por isso um chamado é atendido entediado e só então o tédio
cai.

### 5.5 Comportamento

- **Expressões contínuas**, de emoção para canal, o tempo todo:
  - tédio acelera a respiração e deixa a cabeça inquieta;
  - irritação esquenta as artérias e os olhos e deixa os movimentos mais bruscos;
  - vaidade ergue o queixo.
- **Contextos:** dão a liberdade por estado.

  | Contexto | Liberdade |
  |---|---|
  | `dormant` | 1 (total) |
  | `listening` | 0,2 |
  | `thinking` / `tooling` | 0,1 |
  | `speaking` | 0: só expressões |
  | `offline` / `boot` | Pausado |

- **Reflexos**, que respondem a um estímulo na hora:

  | Reflexo | Gatilho | O que faz |
  |---|---|---|
  | `lookAway` | Mouse errático | Desvia o olhar até o mouse acalmar |
  | `watchExit` | Mouse sai da janela | Olha a borda por onde ele saiu |
  | `waitForOrders` | Tédio cruza 0,85 | Ergue a cabeça e encara o centro |
  | `impatient` | 6 s sem voz no `listening` | Queixo sobe, duas piscadas, artérias aquecem |
  | `scorn` | 16 s sem voz | Desvia o olhar e se ergue; irritação +0,1 |
  | `pleased` | `taskDone` | Queixo erguido, olhos e brilho sobem |
  | `failed` | `taskFailed` | Olhos tremem, o peito esfarela, artérias quentes |

  O gatilho de silêncio é `on: 'quiet:<estímulo>:<s>'`: dispara uma vez por trecho de
  silêncio, e a contagem recomeça com o estímulo ou com a troca de contexto. Uma reação
  com `contexts` é cortada quando o contexto sai da lista.

- **Espontâneas**, sorteadas pelo diretor:
  - `sigh`: suspiro teatral;
  - `scan`: varredura da sala;
  - `dream`: olhos acendem por 0,35 s;
  - `crumble`: uma parte do corpo vira poeira e é puxada de volta. Exige irritação ≥ 0,3;
  - `selfImprove`: uma placa se solta, gira e se reencaixa. Exige irritação ≤ 0,4.
- **Regras do diretor:**
  - **intervalo:** no mínimo 20 s, mais uma espera exponencial com média de 60 s, que
    encurta com o tédio;
  - **peso:** base × (1 + Σ favoredBy × emoção) × prontidão (recarga);
  - **sem repetição:** nunca a mesma duas vezes seguidas;
  - **silêncio:** "não fazer nada" também é sorteável;
  - **uma de cada vez:** só uma reação toca por vez, e um reflexo de prioridade maior
    corta a espontânea.
- **Trilhas:** cada reação é uma lista de trilhas sobre canais, com faixas `[min, max]`
  sorteadas a cada vez, para nunca sair igual. Uma trilha pode ser uma **deixa** (`cue`),
  um gesto pontual que o host executa sozinho, como `arteries.surge`.

### 5.6 Resposta ao chamado

**Regra:** ele sempre atende, mas do jeito do humor. Três garantias valem sempre:
1. sinal de que ouviu em até 0,2 s;
2. o evento `answer` sai na hora, para o host abrir o microfone;
3. o estilo começa em no máximo 2 s.

**Prelúdios:** opcionais e combináveis, cabendo nos 2 s:
- `sigh`, quando entediado;
- `ignore`, quando irritado: fica imóvel por 0,6 + irritação s.

**Estilos:** um é sorteado com peso `base × e^(sharpness × destaque da emoção)`, sendo
`sharpness` 5.

| Estilo | Quando | Como |
|---|---|---|
| `eager` | Neutro (base 5) | Rápido, onda nas artérias, flash nos olhos |
| `weary` | Tédio | Lento, brilho e olhos sobem aos poucos |
| `curt` | Irritação | Tranco da cabeça, olhos duros, artérias quentes |
| `regal` | Vaidade | Majestoso, queixo erguido |

O evento `answer` traz `{style, preludes, delay, settle}`. No `proto/`, a figura entra em
`waking` no `delay` e em `listening` no `settle`.

### 5.7 Canais do corpo (vocabulário)

| Canal | O que controla |
|---|---|
| `gaze.x`, `gaze.y`, `gaze.weight` | Para onde olhar; o peso define quanto o `mind` manda sobre o cursor |
| `head.pitch`, `head.follow`, `head.restless` | Inclinação, rapidez para seguir e inquietação da cabeça |
| `eyes.gain`, `eyes.boost`, `eyes.flicker` | Brilho, luz extra e tremor dos olhos |
| `breath.rate`, `breath.depth` | Ritmo e profundidade da respiração |
| `body.rise` | Fôlego fundo, que ergue o corpo todo (o suspiro) |
| `glow` | Brilho geral |
| `arteries.heat`, `arteries.beat` | Intensidade das artérias e força do batimento |
| `crumble:<região>`, `rebuild:<região>` | Desfazer em poeira e reencaixar uma placa. Regiões: `shoulderL/R`, `collarL/R`, `chestL/R`, `abdomen` |

O mapeamento na figura fica em `proto/main.js`: procure `ch('` e `REGIONS`.

### 5.8 Persistência e painel

- **Humor:** salvo no `localStorage` (`ultron.mind`) a cada 10 s e ao fechar a página. Ao
  voltar, o tempo fora reduz as emoções, e até 30 min dele contam como ociosidade. Depois
  de uma noite fora, ele volta entediado e com algum rancor de fundo.
- **Painel (tecla `E`):** mostra barras de cada emoção (momento e fundo), o log e
  botões para disparar estímulos ou forçar reações. Tem também:
  - sliders do temperamento, das emoções, das reações e do ritmo;
  - **time ×10**, para ver o humor evoluir rápido;
  - **copy config**, que copia só o que mudou, em JSON, para colar no chat.

  Os ajustes ficam em `localStorage` (`mind.panel.ultron`) até alguém passá-los para
  `ultron.ts`.

### 5.9 Como estender

| Para… | Faça |
|---|---|
| Nova emoção | Uma entrada em `emotions` e ligações em `stimuli`, `drives`, `expressions`, `favoredBy` |
| Nova reação | Um bloco em `reactions`, com os canais existentes; nenhum código novo |
| Novo estímulo | Uma entrada em `stimuli`; o host chama `mind.stimulate('nome')` |
| Novo canal ou deixa | Declare em `CHANNELS` (`mind/core/config.ts`) ou em `channels` da personalidade, e ensine o host a aplicá-lo |

---

## 6. Verificação

```bash
node node_modules/tsx/dist/cli.mjs mind/test/run.ts       # 31 testes do orquestrador
node node_modules/typescript/bin/tsc -p mind/tsconfig.json  # tipos do mind/
node node_modules/oxlint/bin/oxlint proto/main.js mind       # lint (sem saída = ok)
node proto/art/from-image.mjs                                # regenerar a arte
```

**Testes no navegador** (Chrome headless com SwiftShader via CDP):
- **Servidor de teste:** `PORT=5180 node node_modules/vite/bin/vite.js --port 5180`.
  Pare-o depois, encerrando o processo na porta.
- **Desempenho:** com o orçamento cheio roda a ~1 fps. Use `?budget=0.35` a `0.6`.
- **Relógio do orquestrador:** o `dt` é limitado a 0,1 por quadro, então em fps baixo o
  tempo do `mind` anda devagar.
- **Respiração:** ela desloca a figura alguns px e estraga comparações entre capturas.
  Para comparar, zere a respiração (expressão com `breath.depth` = 0 via `mind.patch`) e
  fixe a pose.

Os scripts de checagem usados até aqui ficaram na pasta temporária da sessão, fora do
repositório.

---

## 7. Pendências e próximos passos

- **Estados ativos da figura:** listening, thinking e tooling estão feitos (seção 4.2).
  Falta o **speaking**: as artérias internas levam a voz para fora, até as bochechas, com a
  emoção na fala. Thinking e tooling foram testados ao vivo pelo usuário, mas não têm
  checagem headless.
- **Feedback ao vivo do usuário** ainda não chegou para: dormant, reações ociosas,
  respostas ao chamado, instabilidade e placa.
  - O sonho ficou mais raro (~3 min) do que o aprovado (20 a 40 s).
  - Com tédio alto, sai quase uma reação por minuto.
  - A instabilidade pode estar sutil demais.
- **Lote 3, integração com o app:** o usuário disse que **ainda não é necessário**. Quando
  vier, inclui:
  - trocar a interface de `src/` pela figura, ligada a `store.phase` e ao nível real do
    microfone;
  - remover `src/ui/Ignition.tsx` (a tela de clique inicial);
  - palavra de ativação → `call`;
  - reconhecimento de voz → `forbiddenName` ("Jarvis", "Stark", "marionete");
  - ferramentas → `taskDone` / `taskFailed`;
  - `tone.ts`: o humor vira instruções de tom para a IA. O tom muda a forma, nunca o
    conteúdo: ele sempre cumpre o pedido;
  - "ouvido passivo": som alto no dormant faz o batimento e os olhos reagirem.
- **Opcionais conversados:** a IA classificar as falas do usuário em estímulos (elogio,
  provocação); ajuste de pesos por retorno do usuário.
- **Referência de interação:** `apex-humanoid.vercel.app` (cabeça segue o cursor, clique
  vira pulso de luz). Ainda não replicados de lá: a inclinação do corpo inteiro (9% do yaw)
  e a casca de trás da cabeça ao girar.
- **Higgsfield** (geração de arte): o conector está disponível, com plano gratuito e **2
  créditos restantes**. Atenção: `get_cost` cota uma imagem só, mesmo com `count: 4`.
  Multiplique a cotação antes de pedir aprovação.
