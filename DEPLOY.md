# Publicação completa (site + painel /admin + SQLite)

Este projeto já está preparado para rodar como aplicação completa em qualquer servidor Node >= 22.13 ou Docker (incluindo `/`, `/admin`, `/api/invite`, `/api/rsvps`, `/api/messages` e persistência em SQLite).

## Variáveis de ambiente recomendadas

- `ADMIN_PASSWORD`: senha de acesso ao painel `/admin` (defina uma senha forte no painel da hospedagem).
- `SESSION_SECRET`: chave aleatória longa para manter sessões do `/admin` ativas após reinícios.
- `GUESTBOOK_DB_PATH`: caminho do banco SQLite (no Docker, o padrão já é `/data/messages.sqlite`).
- `HOST`: `0.0.0.0` (automático quando `PORT` está definido).

---

## Opção 1 · Railway (mais simples via GitHub + Volume)

1. Crie um projeto no Railway conectando o repositório `GiantSNLX/convite-geovanna-yuri` (ele detecta automaticamente o `Dockerfile` e `railway.json`).
2. Em **Variables**, adicione:
   - `ADMIN_PASSWORD` = sua senha dos noivos
   - `SESSION_SECRET` = qualquer string longa aleatória
   - `GUESTBOOK_DB_PATH` = `/data/messages.sqlite`
3. Em **Volumes**, adicione um volume montado em `/data` (para não perder convites e confirmações ao atualizar o código).
4. Gere o domínio público ou conecte seu domínio personalizado (ex: `casamento.yuritanaka.com.br`).

## Opção 2 · Fly.io

```bash
fly launch --copy-config --no-deploy
fly volumes create convite_data --region gru --size 1
fly secrets set ADMIN_PASSWORD="sua-senha-forte" SESSION_SECRET="$(openssl rand -hex 32)"
fly deploy
```

## Opção 3 · Render

Use o arquivo `render.yaml` (Blueprint) conectando o repositório no Render, informe `ADMIN_PASSWORD` e o serviço subirá com disco persistente em `/data`.

## Opção 4 · VPS própria com Docker

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

Depois, aponte seu proxy reverso (Nginx, Caddy ou Cloudflare) para `http://127.0.0.1:4173`.
