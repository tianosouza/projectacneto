# ============================================================================
# PORTAL (React/Vite) servido por nginx. NAO contem a API nem banco.
# Usado pelo fly.toml da RAIZ. Contexto de build: RAIZ do projeto.
# A API tem deploy proprio (pasta backend/). A URL da API entra no build (VITE_API_URL)
# via [build.args] do fly.toml.
# ============================================================================
FROM node:20-alpine AS build
WORKDIR /app

# MUDAR em fly.toml (nao aqui): URL publica da API, ex.: https://<nome-da-api>.fly.dev
ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL

# Falha o build se a URL da API faltar: sem ela o portal chamaria o proprio nginx (404 em /api).
RUN test -n "$VITE_API_URL" || (echo "ERRO: defina VITE_API_URL em [build.args] do fly.toml" && exit 1)

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build

FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

# NAO MUDAR sem ajustar internal_port no fly.toml e o listen no nginx.conf.
EXPOSE 8080
