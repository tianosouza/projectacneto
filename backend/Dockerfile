# Imagem da API separada (sem portal). Build feito a partir da pasta backend/.
FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY prisma ./prisma
COPY server ./server

RUN npx prisma generate --schema prisma/schema.prisma

ENV NODE_ENV=production
# NAO MUDAR sem ajustar internal_port no backend/fly.toml (devem ser iguais).
ENV PORT=3000
# Banco SQLite no volume montado em /data (ver [[mounts]] no backend/fly.toml).
ENV DATABASE_URL=file:/data/api.db
# Em producao a API EXIGE AUTH_SECRET (32+ chars) e ADMIN_PASSWORD (12+ chars) via `fly secrets set`.
EXPOSE 3000

# Sem seed e sem --accept-data-loss de proposito: nao cria dados de teste no banco do cliente
# e nao apaga dados em mudancas de schema (o deploy falha em vez de perder dados).
CMD ["sh", "-c", "npx prisma db push --schema prisma/schema.prisma --skip-generate $PRISMA_PUSH_FLAGS && node server/index.mjs"]
