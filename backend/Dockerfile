FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY prisma ./prisma
COPY server ./server

RUN npx prisma generate --schema prisma/schema.prisma

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

CMD ["sh", "-c", "npx prisma db push --schema prisma/schema.prisma --skip-generate && npx prisma db seed --schema prisma/schema.prisma && node server/index.mjs"]
