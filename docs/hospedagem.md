# Hospedar o Ultron: backend na VPS, front na Vercel

O cérebro (o bridge, em `bridge/`) roda numa VPS com Docker, junto de um
Postgres e do Caddy, que cuida do HTTPS. O rosto (o app Vite) fica na Vercel.

```
navegador ──https──▶ Vercel (rosto, arquivos estáticos)
    │
    └──wss/https──▶ VPS: Caddy :443 ──▶ bridge :8787 ──▶ Postgres (rede interna)
```

## O que muda em relação ao PC

- Tudo chega ao bridge pelo Caddy, então todo pedido conta como remoto e exige
  `ULTRON_PASSWORD` (`bridge/auth.mjs`). Sem senha, o bridge recusa tudo.
- O `!` do terminal (shell) e as ferramentas de escrita agiriam na VPS, não no
  seu PC. Ficam desligados (`ULTRON_ALLOW_SHELL=0`, `ULTRON_ALLOW_WRITES=0`).
- Controle do Chrome, apps do PC e servidores MCP locais não existem na VPS.
- O modelo Laya continua opcional; sem ele o humor segue pelas regras.
- A conversa (`~/.ultron`), as sessões do Claude Code (`~/.claude`) e o cache
  de voz (`~/.cache`) ficam no volume `bridge-home`, e sobrevivem a reiniciar
  ou atualizar o container.
- O Postgres sobe vazio: nada no bridge usa banco ainda. Ele fica pronto, só na
  rede interna, com `DATABASE_URL` disponível para o bridge.

## Domínio

Use um domínio seu para os dois lados, com subdomínios do mesmo domínio, por
exemplo `ultron.seudominio.com` (Vercel) e `api.ultron.seudominio.com` (VPS).
O cookie de login é `SameSite=Strict`: o navegador só o manda para o bridge
quando a página e o bridge são do mesmo site. Com a página em `*.vercel.app`
e o bridge em outro domínio, o login não funciona.

## 1. VPS

Precisa de Docker com o plugin Compose e das portas 80 e 443 abertas.

1. No painel do seu domínio, crie um registro **A** de
   `api.ultron.seudominio.com` apontando para o IP da VPS.
2. Na VPS:

   ```
   git clone https://github.com/LeonardoBrum0907/ultron.git
   cd ultron
   cp deploy/.env.example deploy/.env
   nano deploy/.env
   ```

   Preencha pelo menos `ULTRON_API_DOMAIN`, `ULTRON_ALLOWED_ORIGINS` (o
   endereço da página na Vercel), `ULTRON_PASSWORD`, `POSTGRES_PASSWORD` (e a
   mesma senha em `DATABASE_URL`) e o login do Claude (passo 3).
3. Login do Claude, uma das duas opções:
   - **Assinatura Claude**: no seu PC rode `claude setup-token` e cole o
     token em `CLAUDE_CODE_OAUTH_TOKEN`.
   - **Chave de API**: `ANTHROPIC_API_KEY`, cobrada por token.
4. Suba tudo:

   ```
   docker compose -f deploy/docker-compose.yml up -d --build
   docker compose -f deploy/docker-compose.yml logs -f bridge
   ```

   O log deve mostrar `remote access ON` e a origem da Vercel em
   `accepting local dev origins plus ...`. Abrir
   `https://api.ultron.seudominio.com/auth` deve responder um JSON.

Atualizar depois: `git pull` e o mesmo `up -d --build`.

## 2. Vercel

1. Importe o repositório na Vercel. O `vercel.json` já diz como montar
   (copia o runtime do rastreamento de mãos e roda `npm run build`).
2. Em **Settings → Environment Variables**:

   ```
   VITE_BACKEND=bridge
   VITE_BRIDGE_URL=wss://api.ultron.seudominio.com
   ```

   O `VITE_BRIDGE_URL` também libera esse endereço na CSP da página
   (`vite.config.ts`), senão a voz e as imagens do bridge ficam bloqueadas.
3. Em **Settings → Domains**, adicione `ultron.seudominio.com` e crie o
   registro DNS que a Vercel pedir.
4. Faça o deploy, abra a página e entre com a `ULTRON_PASSWORD`.

## Pendente: login a partir da Vercel

Hoje o bridge só aceita uma página remota servida pelo próprio host dele
(`sameOrigin` em `bridge/auth.mjs`), e o front não manda o cookie para outro
endereço. Até o bridge aceitar a origem de `ULTRON_ALLOWED_ORIGINS` também para
pedidos remotos (com `Access-Control-Allow-Credentials`) e o front usar
`credentials: 'include'`, a página da Vercel recebe 403.

## Segredos

`deploy/.env` fica só na VPS e nunca vai para o git. Na Vercel só entram
variáveis `VITE_*`, e tudo que começa com `VITE_` vai parar no navegador: nunca
coloque chave de API ali.
