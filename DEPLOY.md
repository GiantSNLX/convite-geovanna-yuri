# Publicação completa (site + painel /admin + banco SQLite)

Este projeto suporta publicação **100% na Cloudflare (Workers + Assets + banco D1)** no plano gratuito ou em qualquer servidor Node >= 22.13 / Docker.

---

## Opção 1 · Cloudflare Workers + Assets + Cloudflare D1 (Recomendado, 24h grátis)

Tudo (`/`, `/admin`, `/api/invite`, `/api/rsvps`, `/api/messages`, links `?c=` e exportação CSV) roda direto na Cloudflare usando o banco SQLite gerenciado **Cloudflare D1**.

### Passo a passo rápido (via terminal com `npx wrangler`)

1. Entre na sua conta Cloudflare:
   ```bash
   npx wrangler login
   ```
2. Crie o banco **Cloudflare D1**:
   ```bash
   npx wrangler d1 create convite-geovanna-yuri
   ```
3. Copie o `database_id` retornado no comando acima e cole no arquivo `wrangler.toml` substituindo `PREENCHER_COM_ID_DO_D1`.
4. Aplique as tabelas iniciais no D1 remoto:
   ```bash
   npx wrangler d1 migrations apply convite-geovanna-yuri --remote
   ```
   *(O Worker também cria as tabelas automaticamente na primeira requisição caso o banco ainda esteja vazio.)*
5. Cadastre os segredos do painel `/admin`:
   ```bash
   npx wrangler secret put ADMIN_PASSWORD
   npx wrangler secret put SESSION_SECRET
   ```
   *(Em `ADMIN_PASSWORD`, digite a senha que os noivos vão usar para entrar em `/admin`. Em `SESSION_SECRET`, informe uma frase/chave longa aleatória.)*
6. Publique na Cloudflare:
   ```bash
   npx wrangler deploy
   ```

### Domínio personalizado na Cloudflare (ex: `casamento.yuritanaka.com.br`)

1. No painel da Cloudflare, abra **Workers & Pages -> `convite-geovanna-yuri` -> Settings -> Domains & Routes -> Add -> Custom Domain**.
2. Informe `casamento.yuritanaka.com.br` (ou `yuritanaka.com.br`) para ativar DNS e HTTPS automaticamente.
3. Depois que o domínio estiver no ar, você pode atualizar `site.url` em `config.js` com essa URL pública.

---

## Opção 2 · Railway / Render / Fly.io / VPS Docker

Se preferir rodar o servidor Node clássico (`server.mjs`) com volume em disco:

- **Variáveis de ambiente:** `ADMIN_PASSWORD`, `SESSION_SECRET`, `GUESTBOOK_DB_PATH=/data/messages.sqlite`.
- Arquivos prontos na raiz: `Dockerfile`, `railway.json`, `render.yaml` e `fly.toml`.

### Exemplo direto com Docker em VPS:

```bash
docker build -t convite-geovanna-yuri .
docker run -d \
  --name convite-gy \
  --restart unless-stopped \
  -p 4173:4173 \
  -e ADMIN_PASSWORD="sua-senha-forte" \
  -e SESSION_SECRET="uma-chave-secreta-longa" \
  -v convite_gy_data:/data \
  convite-geovanna-yuri
```
