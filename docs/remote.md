# Ultron em qualquer aparelho

O bridge guarda uma conversa só, que sobrevive a recarregar a página, reiniciar o
bridge e reiniciar o PC. Todo app conectado (a aba no PC, o celular, outro
computador) vê a mesma conversa: o que um pergunta e o que o Ultron responde
aparece em todos, e a voz toca só no aparelho que perguntou.

## Comandos no terminal (tecla `;`)

- `memory` mostra desde quando a conversa existe, quantos turnos tem e quantos
  aparelhos estão conectados.
- `memory reset` esquece a conversa: a próxima pergunta começa uma nova.

A conversa fica em `~/.ultron/conversa.json` (só o id) e o histórico em si fica
onde o Claude Code já guarda as sessões (`~/.claude/projects`).

## Acesso de fora do PC, com Tailscale

O Tailscale cria uma rede privada entre os seus aparelhos. Nada fica aberto na
internet: só aparelhos logados na sua conta do Tailscale enxergam o PC. A senha
é uma segunda camada, para o caso de um aparelho ser perdido.

### Uma vez, no PC

1. Instale o Tailscale no PC e no celular e entre com a mesma conta.
2. No painel do Tailscale (login.tailscale.com, aba DNS), deixe ligados
   **MagicDNS** e **HTTPS Certificates**. O HTTPS é obrigatório: sem ele o
   navegador do celular não libera o microfone.
3. No `.env.local` do Ultron, coloque uma senha:

   ```
   ULTRON_PASSWORD=uma-senha-longa
   ```

4. Rode o Ultron normalmente (`npm start`) e, em outro terminal:

   ```
   tailscale serve --bg 5173
   ```

   Ele mostra o endereço, algo como `https://seu-pc.tail1234.ts.net`. O
   `--bg` faz isso continuar valendo depois de reiniciar; `tailscale serve
   reset` desfaz.

### No celular

Abra o endereço `https://seu-pc....ts.net`, digite a senha uma vez e pronto. No
Chrome do Android, "Adicionar à tela inicial" deixa o Ultron com ícone próprio.

## Como funciona

- O Vite repassa `/bridge` para o bridge na porta 8787. A página e o bridge
  ficam na mesma origem, então o cookie de login e o HTTPS valem para tudo.
- O bridge trata como remoto tudo que chega por esse repasse (ou de outro IP).
  Sem `ULTRON_PASSWORD`, o remoto é recusado. Com ela, cada pedido precisa do
  cookie de login e da origem da própria página.
- O cookie vale por um ano e é derivado da senha: trocar a senha desloga todos
  os aparelhos.
- Cinco senhas erradas em um minuto bloqueiam novas tentativas até o minuto
  passar.
- O `!` do terminal (shell) continua respondendo só no próprio PC, mesmo logado.
- O PC precisa estar ligado e com o Ultron rodando para os outros aparelhos
  conversarem com ele.
