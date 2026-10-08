# Next Driver para Motoristas

Aplicativo React Native/Expo para motoristas. Ele usa os mesmos endpoints `/api` e o mesmo backend do projeto web.

## Configuração

O app não possui domínio de API embutido no código. A URL é lida de `EXPO_PUBLIC_API_URL` **no momento do build** e fica gravada no APK, então ela precisa ser a mesma API usada pelo portal web (`VITE_API_URL` no `fly.toml` da raiz).

Configure no arquivo `mobile/.env` (fora do git):

```env
EXPO_PUBLIC_API_URL="https://nextdrivertesteapi.fly.dev"
```

Não defina a variável no terminal (`$env:EXPO_PUBLIC_API_URL = ...`): ela tem prioridade sobre o `.env` e já fez um APK sair apontando para uma API antiga. Para conferir, rode `echo $env:EXPO_PUBLIC_API_URL` antes do build; o resultado deve ser vazio.

No desenvolvimento local, troque temporariamente o valor do `.env` pelo IP do computador na mesma rede Wi-Fi; `localhost` apontaria para o próprio celular. Volte para a URL de produção antes de gerar o APK.

## Desenvolvimento

```powershell
cd mobile
npm install
npx expo start
```

No celular, instale o **Expo Go**, escaneie o QR Code mostrado pelo comando e abra o projeto. Nesse modo o app funciona normalmente e envia a localização enquanto o Expo Go estiver aberto.

O Expo Go não permite localização real em segundo plano. Para manter o GPS com a tela bloqueada ou outro app aberto, gere um development build nativo:

```powershell
npx expo prebuild
npx expo run:android
# ou
npx expo run:ios
```

No Android, o sistema mostra uma notificação enquanto o serviço de localização está ativo. No iOS, o usuário precisa permitir localização **Sempre** nas configurações do sistema. O rastreamento para quando o motorista fica offline ou faz logout.
