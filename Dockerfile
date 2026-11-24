FROM node:22-slim

WORKDIR /app

COPY package.json server.mjs guestbook.mjs index.html admin.html admin.js app.js config.js experience.js qr.js styles.css casamento-yuri-geovanna.ics ./
COPY assets ./assets
COPY scripts ./scripts

RUN mkdir -p /data && chown -R node:node /app /data

USER node

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4173 \
    GUESTBOOK_DB_PATH=/data/messages.sqlite

EXPOSE 4173
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 4173) + '/healthz').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "server.mjs"]
