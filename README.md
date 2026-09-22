# ACNETO · Next Driver

Sistema de operação de fretes com portal web, API, banco Prisma/SQLite e aplicativo mobile Expo para motoristas.

## Visão geral

O sistema possui três superfícies:

- **Portal web**: motoristas, operadores e administradores.
- **API**: autenticação, motoristas, localização, negociações, chat e financeiro.
- **APK mobile**: operação do motorista, GPS, ofertas, etapas do frete e carteira.

## Requisitos

- Node.js 20 ou superior
- npm
- Expo CLI/npx para o mobile
- Android Studio/SDK somente para gerar o APK nativo
- Fly CLI somente para deploy

## Estrutura

```text
frontend/       Portal web React + Vite + TypeScript
backend/        API Express + Prisma + SQLite
mobile/         Aplicativo Expo/React Native
src/            Código fonte usado pelo Vite quando aplicável
```

## Configuração local

### Variáveis da API

Copie `.env.example` para `.env` na raiz quando necessário. Para desenvolvimento local, o backend usa `backend/.env`:

```env
DATABASE_URL="file:./dev.db"
AUTH_SECRET="uma-chave-com-pelo-menos-32-caracteres"
PORT=3000
ADMIN_EMAIL="admin@acnetotransportes.com"
ADMIN_NAME="Administrador"
ADMIN_PASSWORD="uma-senha-forte"
CORS_ORIGINS="http://localhost:5173,http://127.0.0.1:5173"
```

Nunca use a senha padrão em ambiente compartilhado ou produção.

### Frontend

O frontend usa `VITE_API_URL`. Em desenvolvimento local, deixe vazio ou use a configuração do proxy do Vite:

```env
VITE_API_URL=""
```

Para API publicada:

```env
VITE_API_URL="https://sua-api.exemplo.com"
```

## Rodar localmente

Abra dois terminais na raiz do projeto.

### Terminal da API

```powershell
npm install
npm run db:generate
npm run db:push
npm run dev:api
```

API local: `http://localhost:3000`

### Terminal do frontend

```powershell
npm run dev
```

Portal web: `http://localhost:5173`

A API precisa estar rodando antes de usar login, localização, negociações ou financeiro. Erros `ECONNREFUSED 127.0.0.1:3000` indicam que a API não está ativa.

## Banco de dados

Comandos disponíveis na raiz:

```powershell
npm run db:validate
npm run db:generate
npm run db:push
npm run db:seed
npm run db:studio
```

- `db:validate`: valida o schema Prisma.
- `db:generate`: regenera o cliente Prisma.
- `db:push`: aplica o schema ao banco local.
- `db:seed`: executa os dados iniciais.
- `db:studio`: abre o Prisma Studio.

O banco local fica em `backend/prisma/dev.db` quando `DATABASE_URL` usa `file:./dev.db` dentro de `backend/.env`.

## Perfis e permissões

### Motorista

- Fica online/offline.
- Compartilha localização GPS.
- Edita seus dados pessoais, CNH e veículo.
- Recebe propostas de frete.
- Aceita, recusa ou envia contraproposta.
- Conversa com operação dentro do sistema.
- Inicia o frete.
- Informa chegada ao posto de coleta.
- Finaliza o frete.
- Consulta a carteira e comprovantes pagos.

### Operador

- Consulta motoristas e localização.
- Busca clientes e postos de coleta no mapa.
- Calcula rotas.
- Cria negociações baseadas na posição do motorista, posto e cliente.
- Acompanha propostas e mensagens.
- Pode editar/excluir motoristas conforme a permissão operacional.
- Só acessa o financeiro se um administrador conceder a permissão.

### Administrador

- Possui todas as permissões operacionais.
- Aprova ou rejeita cadastros.
- Gerencia motoristas, operadores, clientes, postos e transportadoras.
- Concede ou remove a permissão **Gerenciar financeiro** de operadores.
- Aprova conclusões de frete.
- Registra pagamentos e comprovantes.

## Cadastro de motorista

No cadastro, o motorista informa se é:

- Autônomo.
- Motorista de uma transportadora.

Quando escolher transportadora, o sistema mostra transportadoras cadastradas para seleção. O vínculo é persistido na API e aparece no perfil do motorista.

## Clientes e postos de coleta

Operadores e administradores podem cadastrar:

- Cliente final.
- Posto de coleta.

O endereço é geocodificado para obter latitude e longitude. Esses pontos aparecem no mapa e podem ser selecionados para uma rota.

## Mapa e cálculo de rota

1. Abra **Localizar**.
2. Selecione um motorista.
3. Busque e selecione um posto de coleta.
4. Busque e selecione um cliente final.
5. Clique em **Calcular rota**.
6. O mapa centraliza no motorista, posto ou cliente selecionado.
7. A rota calcula distância e duração usando os pontos GPS.

A negociação deve ser aberta a partir da rota calculada. A distância não deve ser digitada manualmente.

## Negociação de frete

### Criar uma negociação

Na tela de rota ou na aba **Negociações**:

1. Confirme motorista, posto e cliente.
2. Informe carga e quantidade, quando aplicável.
3. Informe o valor por quilômetro em reais.
4. Clique em **Calcular rota e enviar ao motorista**.

O backend calcula:

```text
valor total = distância da rota em km × valor por km
```

O motorista recebe a proposta no portal web e no APK.

### Estados da negociação

- `pending`: aguardando resposta.
- `countered`: contraproposta enviada.
- `accepted`: proposta aceita, aguardando início.
- `in_transit`: frete iniciado.
- `at_collection`: motorista chegou ao posto.
- `driver_completed`: motorista finalizou, aguardando conferência.
- `completed`: operação aprovou a conclusão.
- `rejected`: proposta rejeitada.
- `cancelled`: negociação cancelada.
- `expired`: proposta expirada.

Negociações concluídas não aparecem no filtro geral. Para consultar concluídas, use o filtro **Concluídas**. O chat fica bloqueado para negociações encerradas; os fretes finalizados ficam na carteira.

### Chat interno

O chat acontece dentro da negociação e não depende de WhatsApp:

- Mensagens são persistidas no banco.
- O portal web recebe eventos em tempo real por SSE.
- O APK sincroniza enquanto está aberto e ao voltar ao primeiro plano.
- A conversa pode continuar durante o frete e após a conclusão operacional.

## Ciclo operacional do motorista

Depois de aceitar:

1. **Iniciar frete**: muda para `in_transit`.
2. **Cheguei ao posto de coleta**: muda para `at_collection`.
3. **Finalizar frete**: muda para `driver_completed`.
4. A operação confere o frete no módulo financeiro.
5. Ao aprovar, muda para `completed` e libera o pagamento.

## Módulo financeiro

A aba **Financeiro** aparece para:

- Administradores.
- Operadores autorizados por um administrador.

### Autorizar operador

Somente administrador:

1. Abra **Cadastros**.
2. Acesse **Acessos cadastrados**.
3. Crie um operador ou selecione um operador existente.
4. Marque **Permitir que este operador gerencie o financeiro** ou use o botão de autorização na lista.

A permissão também é validada no backend. Esconder a aba no frontend não é a única proteção.

### Conferir e pagar

1. Abra **Financeiro**.
2. Filtre por status.
3. Confira motorista, rota, empresa, valor e data.
4. Clique em **Aprovar pagamento**.
5. Para pagar, anexe o comprovante e marque como pago.
6. O sistema aceita somente:
   - PDF
   - JPG
   - JPEG
7. O arquivo é armazenado e fica disponível para o motorista somente quando o lançamento está como `paid`.

Status financeiros:

- `pending_review`: aguardando conferência.
- `approved`: aprovado para pagamento.
- `paid`: pagamento realizado.
- `rejected`: devolvido para conferência.

## Carteira do motorista

Na aba **Carteira**, o motorista vê:

- Total dos fretes.
- Valor pendente.
- Quantidade de fretes concluídos.
- Origem e destino.
- Empresa pagadora.
- Status financeiro.
- Data e valor.
- Comprovante quando o pagamento estiver como `paid`.

No APK, toque no frete para expandir os detalhes.

## APK mobile

O mobile usa a mesma API do web. Configure `mobile/.env`:

```env
EXPO_PUBLIC_API_URL="https://sua-api.exemplo.com"
```

No desenvolvimento local em aparelho físico, use o IP da máquina na rede, não `localhost`:

```env
EXPO_PUBLIC_API_URL="http://192.168.0.10:3000"
```

### Rodar com Expo

```powershell
cd mobile
npm install
npx expo start
```

### Gerar APK manualmente

O projeto já possui Android nativo:

```powershell
cd mobile/android
.\gradlew.bat assembleRelease --no-daemon
```

Se o CMake/Ninja informar `Filename longer than 260 characters`, use o script de caminho curto:

```powershell
cd mobile
npm run android:release:short-path
```

Esse comando monta temporariamente o projeto em uma unidade virtual `M:` e remove a unidade ao terminar. Ele mantém a configuração nativa e evita o limite de caminho do Windows.

O APK fica em `mobile/android/app/build/outputs/apk/release/`.

Não é necessário executar `expo prebuild` em toda alteração de TypeScript. Execute-o somente quando mudar configuração nativa ou adicionar plugin Expo.

### Versão do APK

Atualize os dois arquivos antes de uma nova versão:

- `mobile/app.json`: `expo.version` e `expo.android.versionCode`.
- `mobile/android/app/build.gradle`: `versionName` e `versionCode`.

Exemplo:

```json
"version": "1.0.3-beta-2",
"android": {
  "versionCode": 2
}
```

```gradle
versionCode 2
versionName "1.0.3-beta-2"
```

O `versionCode` deve sempre aumentar.

## Deploy

### Frontend

Configure `VITE_API_URL` com a URL pública da API e execute:

```powershell
npm run build
```

O deploy depende da infraestrutura usada pelo projeto.

### API no Fly.io

Consulte também `backend/README.md`.

```powershell
cd backend
fly apps create acneto-api
fly volumes create ac_neto_api_data --region gru --size 1
fly secrets set AUTH_SECRET="chave-com-32-caracteres-ou-mais" ADMIN_EMAIL="admin@exemplo.com" ADMIN_NAME="Administrador" ADMIN_PASSWORD="senha-forte" CORS_ORIGINS="https://seu-frontend.com"
fly deploy --config fly.toml
```

Depois configure:

```env
VITE_API_URL="https://acneto-api.fly.dev"
EXPO_PUBLIC_API_URL="https://acneto-api.fly.dev"
```

## Validação antes de publicar

```powershell
npm run db:validate
npm run db:generate
npm run typecheck
npm run build
node --check backend/server/index.mjs
Push-Location mobile
npm run typecheck
Pop-Location
```

Para validar o APK nativo, execute o Gradle manualmente. O typecheck mobile não gera APK.

## Problemas comuns

### `ECONNREFUSED 127.0.0.1:3000`

A API não está rodando ou o frontend está apontando para localhost sem o backend ativo.

```powershell
npm run dev:api
npm run dev
```

### O APK não acessa a API

- Confirme `EXPO_PUBLIC_API_URL`.
- No celular físico, não use `localhost`.
- Verifique CORS e se a API pública está acessível.

### O comprovante não abre

- Use somente PDF, JPG ou JPEG.
- O limite é 5 MB.
- O comprovante só aparece para o motorista depois que o financeiro marca o pagamento como `paid`.
- No APK, o arquivo é aberto pelo compartilhamento/visualizador nativo.

### O motorista não vê a oferta

- Confirme se a negociação foi criada com o `driverId` correto.
- Confirme se o motorista está autenticado na mesma API.
- Atualize a aba **Ofertas** ou volte ao primeiro plano no APK.

### A negociação não calcula rota

- O motorista, posto e cliente precisam ter latitude e longitude.
- O motorista precisa ter uma posição GPS recente.
- O posto e o cliente devem ser tipos diferentes e válidos.

## Segurança

- Não publique senhas presentes em `.env`.
- Use `AUTH_SECRET` forte com pelo menos 32 caracteres.
- Mantenha `CORS_ORIGINS` limitado aos domínios reais.
- O backend valida permissões independentemente da interface.
- O financeiro só pode ser operado por administrador ou operador autorizado.
