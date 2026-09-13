# Next Driver para Motoristas

Aplicativo React Native/Expo para motoristas. Ele usa os mesmos endpoints `/api` e o mesmo backend do projeto web.

## Configuração

O app não possui domínio de API embutido. Configure `EXPO_PUBLIC_API_URL` apontando para o mesmo backend que atende o frontend:

```powershell
$env:EXPO_PUBLIC_API_URL = "https://acneto-api-red-log-1872.fly.dev"
```

O arquivo `.env` do mobile já aponta para a API de produção. No desenvolvimento local, substitua temporariamente o valor pelo IP do computador na mesma rede Wi-Fi; `localhost` apontaria para o próprio celular.

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
