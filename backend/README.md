# ACNETO API

Backend independente do frontend. A API expõe os mesmos endpoints `/api` usados pelo portal web e pelo app mobile.

## Rodar localmente

A partir de `backend/`:

```powershell
npm install
npm run db:generate
npm run db:push
npm run dev:api
```

O projeto já inclui um `backend/.env` para desenvolvimento local. O comando `dev:api` usa `node --watch` e reinicia a API quando os arquivos do backend mudarem. A senha inicial local é `admin123456789`; altere o arquivo antes de usar em qualquer ambiente compartilhado.

A API ficará disponível em `http://localhost:3000`. Para permitir que o frontend publicado em outro domínio acesse a API, defina:

```powershell
$env:CORS_ORIGINS = "https://seu-frontend.com"
```

Vários domínios podem ser separados por vírgula.

## Deploy independente no Fly.io

O arquivo [fly.toml](fly.toml) usa o app `acneto-api` como exemplo. Troque o nome se necessário e crie o app/volume antes do primeiro deploy:

```powershell
cd backend
fly apps create acneto-api
fly volumes create ac_neto_api_data --region gru --size 1
fly secrets set AUTH_SECRET="uma-chave-forte-com-pelo-menos-32-caracteres" ADMIN_EMAIL="admin@exemplo.com" ADMIN_NAME="Administrador" ADMIN_PASSWORD="uma-senha-forte" CORS_ORIGINS="https://seu-frontend.com"
fly deploy --config fly.toml
```

Depois do deploy, a API estará em `https://acneto-api.fly.dev`. Configure o frontend com:

```env
VITE_API_URL=https://acneto-api.fly.dev
```

E o mobile com:

```env
EXPO_PUBLIC_API_URL=https://acneto-api.fly.dev
```

O backend não serve arquivos estáticos nem depende do build do frontend.
