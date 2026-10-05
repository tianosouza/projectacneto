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

O arquivo [fly.toml](fly.toml) traz comentarios em cada ponto a mudar (`app` e `CORS_ORIGINS`). Esta e a parte 1 do deploy separado; o portal e publicado depois com o `fly.toml` da raiz do projeto. Edite o arquivo e rode:

```powershell
cd backend
fly apps create <nome-unico-da-api>
fly volumes create ac_neto_api_data --region gru --size 1 -a <nome-unico-da-api>
# Na raiz, copie .env.fly.example para .env.fly (AUTH_SECRET 32+, ADMIN_PASSWORD 12+, sem aspas) e envie:
$pairs = Get-Content ..\.env.fly -Encoding UTF8 | ForEach-Object { $_.Trim() } | Where-Object { $_ -match '^[A-Za-z_][A-Za-z0-9_]*=.+' }
fly secrets set $pairs -a <nome-unico-da-api>
fly deploy --ha=false -a <nome-unico-da-api>
```

`AUTH_SECRET` e `ADMIN_PASSWORD` são obrigatórios em produção. `SUPERADMIN_PASSWORD` (12+ caracteres) cria o super administrador; sem ele, nenhum é criado. Sem `CORS_ORIGINS`, requisições de outros domínios são bloqueadas em produção.

Depois do deploy, a API estará em `https://<nome-unico-da-api>.fly.dev`. Configure o frontend com:

```env
VITE_API_URL=https://<nome-unico-da-api>.fly.dev
```

E o mobile com:

```env
EXPO_PUBLIC_API_URL=https://<nome-unico-da-api>.fly.dev
```

O backend não serve arquivos estáticos nem depende do build do frontend.
