# Memória de longo prazo

O Ultron tem duas memórias:

| Camada | O que guarda | Onde |
|---|---|---|
| A conversa | o que foi dito, turno a turno | sessão do cérebro (`~/.ultron/conversa.json` + o histórico do Agent SDK) |
| Longo prazo | o que ele sabe de você: preferências, pessoas, projetos, decisões | um servidor [ai-memory](https://github.com/akitaonrails/ai-memory) |

A de longo prazo sobrevive a `memory reset`, à troca de modelo e, um dia, à
troca de cérebro: as ferramentas que a usam são do Ultron (`bridge/tools/memory.ts`),
não do Claude.

## Como funciona

- **O modelo decide o que lembrar.** Quando aprende algo que vale para depois,
  ele grava uma nota sozinho, sem avisar. Antes de gravar, procura se já existe
  uma nota do assunto e reescreve a mesma, para um fato não ficar em dois lugares.
- **Ferramentas:** `memory_search` (palavras-chave), `memory_recent` (as últimas
  notas), `memory_read` (uma nota inteira) e `memory_save` (grava ou reescreve).
  Não há apagar: o ai-memory guarda tudo no git, e você edita ou apaga as notas
  à mão quando quiser.
- **Sem custo:** o ai-memory não chama LLM nenhum por padrão; a busca é SQLite
  full-text.
- **Permissão:** gravar nota não espera `ULTRON_ALLOW_WRITES` (o servidor
  `ultron_memory` está na lista dos servidores do próprio Ultron, em `bridge/policy.ts`).
- **As notas são markdown**, uma por assunto, em `notes/<assunto>.md` dentro do
  projeto `ultron/memoria` do ai-memory.

## Subir o ai-memory no Windows (Docker Desktop)

1. Gere um token (qualquer sequência longa e aleatória):

   ```powershell
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

2. Suba o servidor, só no localhost, com os dados num volume:

   ```powershell
   docker run -d --name ai-memory --restart unless-stopped `
     -p 127.0.0.1:49374:49374 -v ai-memory-data:/data `
     -e AI_MEMORY_AUTH_TOKEN=<o token> akitaonrails/ai-memory:latest
   ```

3. No `.env.local` do Ultron:

   ```
   ULTRON_MEMORY_URL=http://127.0.0.1:49374
   ULTRON_MEMORY_TOKEN=<o token>
   ```

4. Reinicie o bridge. O terminal mostra `[ultron] memory ready at ...`, ou
   `memory unavailable` com o motivo (servidor parado, token errado).

Para ver as notas no navegador, abra `http://127.0.0.1:49374/web` (a imagem do
Docker já liga a interface web).

## O que fica para depois

- Mostrar as notas no terminal do painel L (`memory facts`).
- Trazer um resumo das notas no começo de cada conversa, em vez de esperar o
  modelo procurar.
