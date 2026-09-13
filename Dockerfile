FROM node:20-alpine AS build
WORKDIR /app

ARG VITE_API_URL=https://acneto-api-red-log-1872.fly.dev
ENV VITE_API_URL=$VITE_API_URL

COPY package*.json ./
RUN npm install

COPY . .
RUN npx prisma generate --schema backend/prisma/schema.prisma
RUN npm run build

FROM node:20-alpine
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=4173
ENV VITE_API_URL=https://acneto-api-red-log-1872.fly.dev

COPY --from=build /app/package*.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/backend ./backend

EXPOSE 4173

CMD ["sh", "-c", "npx prisma db push --schema backend/prisma/schema.prisma --skip-generate && node backend/server/index.mjs"]
