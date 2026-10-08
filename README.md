# ACNETO · Next Driver

Sistema de operação de fretes da A C Neto Transportes. Conecta a **operação**
(administradores e operadores), os **motoristas** e as **transportadoras** em um
só lugar: cadastros, rotas, acompanhamento do frete, chat e acertos financeiros.

O sistema tem três partes:

| Parte | Quem usa | Para quê |
| --- | --- | --- |
| **Portal web** | Administradores, operadores, transportadoras, motoristas | Operação completa pelo navegador |
| **App Android (APK)** | Motoristas | Disponibilidade, GPS, mural de rotas, etapas do frete, chat e recebimentos |
| **API** | Portal e app | Guarda os dados e aplica as regras e permissões |

**Sumário**

- [Perfis de acesso](#perfis-de-acesso)
- [Entrar no sistema e recuperar senha](#entrar-no-sistema-e-recuperar-senha)
- [Cadastros](#cadastros)
- [Aprovações e solicitações](#aprovações-e-solicitações)
- [Localizar motoristas no mapa](#localizar-motoristas-no-mapa)
- [Rotas](#rotas)
- [Mural de rotas e aceite pelo motorista](#mural-de-rotas-e-aceite-pelo-motorista)
- [Andamento do frete](#andamento-do-frete)
- [Chat entre operação e motorista](#chat-entre-operação-e-motorista)
- [Acertos financeiros](#acertos-financeiros)
- [Relatórios e indicadores](#relatórios-e-indicadores)
- [Painel do motorista (web e app)](#painel-do-motorista-web-e-app)
- [Portal da transportadora](#portal-da-transportadora)
- [Portal do cliente](#portal-do-cliente)
- [Ferramentas do superadmin](#ferramentas-do-superadmin)
- [Regras gerais do sistema](#regras-gerais-do-sistema)
- [Limitações conhecidas](#limitações-conhecidas)
- [Para desenvolvedores](#para-desenvolvedores)

---

## Perfis de acesso

| Perfil | O que faz |
| --- | --- |
| **Administrador** | Tudo o que o operador faz, mais: cadastra operadores e administradores, aprova qualquer perfil, redefine senha de qualquer conta. |
| **Operador** | Cadastra motoristas e clientes, aprova motoristas, transportadoras e clientes, cria rotas, acompanha fretes, faz os acertos financeiros e redefine senhas de motoristas, transportadoras e clientes. |
| **Superadmin** | Administrador com acesso extra à aba **Dados** (manutenção do banco). |
| **Transportadora** | Cadastra os próprios motoristas e veículos e vê no mapa os motoristas vinculados. |
| **Motorista** | Fica disponível, compartilha o GPS, aceita rotas, informa as etapas do frete, conversa com a operação e acompanha os recebimentos. |
| **Cliente** | Portal ainda em desenvolvimento (veja [Portal do cliente](#portal-do-cliente)). |

As permissões são conferidas na API. Esconder um botão na tela não é a única
proteção.

---

## Entrar no sistema e recuperar senha

### Login

Todos entram com **e-mail e senha**. Contas novas só entram depois de aprovadas
pela operação (veja [Aprovações](#aprovações-e-solicitações)).

### Esqueci minha senha

O sistema **não envia SMS nem e-mail**. A senha é redefinida pela operação e
enviada pelo WhatsApp:

1. Na tela de login (web ou app), toque em **Esqueci minha senha**.
2. Informe o **celular cadastrado** com DDD (qualquer formato: `85987090983`,
   `(85) 98709-0983` ou `+55 85 98709-0983`).
   - Se o número estiver em mais de uma conta, o sistema pede também o e-mail.
3. O pedido aparece para a operação na aba **Solicitações**.
4. O administrador ou operador clica em **Redefinir e enviar no WhatsApp**. O
   sistema gera uma senha temporária e abre o WhatsApp Web com a mensagem pronta.
5. O usuário entra com a senha temporária e é **obrigado a criar uma nova senha**
   antes de continuar (no portal e no app).

Operadores só redefinem senhas de motoristas, transportadoras e clientes. Senhas
de operadores e administradores só um administrador redefine.

### Senha inicial de operadores e administradores

Contas de operador e administrador são criadas com uma senha inicial informada
pelo administrador. No primeiro acesso, a pessoa precisa trocar essa senha.

---

## Cadastros

Aba **Cadastros** do painel (administrador e operador).

### Motoristas

O motorista pode ser cadastrado de três formas, sempre com os mesmos dados:
**nome, telefone, e-mail, senha e compartimentação**.

| Onde | Quem cadastra | Situação inicial |
| --- | --- | --- |
| Tela de login → **Ainda não tenho cadastro** → Motorista | O próprio motorista | Em análise (precisa de aprovação) |
| Portal da transportadora → **Cadastrar motorista** | A transportadora | Em análise, já vinculado à transportadora |
| Painel → **Cadastros → Motoristas** | Administrador ou operador | Já aprovado e homologado |

- Ao editar um motorista pelo painel, a senha não aparece. Mudam apenas nome,
  telefone, e-mail e compartimentação; os demais dados já salvos continuam.
- Veículo e transportadora são vinculados depois do cadastro.

### Clientes finais e postos de coleta

Painel → **Cadastros → Clientes**.

1. Preencha nome, e-mail, WhatsApp, tipo (**Cliente final** ou **Posto de
   coleta**), cidade, UF e **Rua/Av., número e bairro**.
2. Marque, se quiser, quais transportadoras podem ver esse ponto.
3. Clique em salvar. O sistema procura o endereço no mapa e grava o GPS.

**Quando o endereço não é encontrado**, abre a janela **Endereço não
encontrado**:

1. Clique em **Pesquisar no Google Maps**. O Google Maps abre já pesquisando o
   endereço digitado.
2. Clique no local exato e use **Compartilhar → Copiar link** (ou clique com o
   botão direito no ponto e copie as coordenadas).
3. Cole o link ou as coordenadas na janela e clique em **Usar esta
   localização**.

São aceitos links completos, links curtos (`maps.app.goo.gl`), a localização
enviada pelo WhatsApp e coordenadas como `-6.1191, -47.2840`.

Ao editar um cliente **sem mudar o endereço**, o GPS salvo é mantido. Se o
endereço mudar, o sistema busca de novo.

### Transportadoras

A transportadora se cadastra pela tela de login → **Ainda não tenho cadastro →
Transportadora**, informando os dados do sócio representante, razão social,
CNPJ, endereço e ao menos um documento anexado. O cadastro passa pela aprovação.

### Operadores e administradores

Somente o administrador: Painel → **Cadastros → Administradores**. Informe nome,
e-mail, telefone, perfil e uma senha inicial (mínimo de 8 caracteres).

---

## Aprovações e solicitações

Aba **Solicitações** (administrador) ou **Aprovações** (operador). O número em
vermelho na aba soma tudo o que está pendente.

| Bloco | O que fazer |
| --- | --- |
| **Pedidos de nova senha** | **Redefinir e enviar no WhatsApp** (gera a senha temporária e abre o WhatsApp Web) ou **X** para descartar. As senhas geradas ficam visíveis até a página ser recarregada, com o link **Abrir WhatsApp de novo**. |
| **Veículos pendentes** | Aprovar ou recusar os veículos cadastrados pelas transportadoras. |
| **Cadastros pendentes** | Conferir e aprovar ou rejeitar contas novas. Para motorista, confira **nome, telefone e compartimentação**. O administrador pode mudar o perfil da conta; para operador/admin, informa a senha inicial. |

---

## Localizar motoristas no mapa

Aba **Localizar**.

- Mostra no mapa os motoristas com posição de GPS recente, além dos clientes e
  postos de coleta.
- Filtre por cidade e selecione um motorista para ver os detalhes.
- Selecione um posto de coleta e um cliente final para traçar o trajeto e ver a
  distância.
- Com um motorista selecionado:
  - **Negociar frete pelo WhatsApp** abre o WhatsApp Web com uma mensagem pronta
    sobre a rota.
  - **Abrir chat** abre a conversa interna com o motorista.

A aba **Resumo** reúne a busca rápida e as listas de clientes, operadores e
motoristas, com atalhos para editar.

---

## Rotas

Aba **Rotas → Rotas**.

### Criar uma rota

1. Clique em **Nova rota**.
2. Escolha o **posto de coleta** e o **cliente final**. A distância é calculada
   pelo trajeto; ninguém digita a distância.
3. Opcional: marque **Enviar alerta** para avisar os motoristas na hora.
4. Salve. A rota nasce com a situação **Aberta**.

### Alertar motoristas

O botão **Alertar motoristas** envia **todas as rotas em aberto**, de qualquer
data, para todos os motoristas homologados. Para cada motorista:

- uma mensagem com a lista de rotas chega no chat;
- o **mural de rotas** abre na tela dele (portal e app).

### Situações da rota

| Situação | Significado |
| --- | --- |
| **Aberta** | Disponível no mural, ainda sem motorista |
| **Designada** | Tem motorista vinculado |
| **Em andamento** | O frete já começou |
| **Concluída** | Entrega confirmada |
| **Cancelada** | Encerrada sem conclusão |

### Vincular motorista manualmente

Na rota selecionada, escolha o motorista e clique em **Vincular**. O motorista
precisa estar homologado e sem outra rota ativa.

---

## Mural de rotas e aceite pelo motorista

O **mural de rotas** lista todas as rotas em aberto, com coleta, entrega,
cidade/UF e distância. Ele abre:

- **sempre que o motorista entra** no portal ou no app;
- **quando a operação alerta os motoristas**;
- pela aba **Mural** da navegação do portal;
- pelo botão **Ver rotas e aceitar** nas mensagens de alerta do chat.

### Aceitar uma rota

1. O motorista toca em **Aceitar pelo chat** e confirma.
2. A rota passa a ser dele e sai do mural dos outros motoristas.
3. No chat com a operação aparece: `✅ Aceitei a rota pelo mural: Coleta → Entrega`.
4. No painel de **todos os administradores e operadores logados**, abre o balão
   do chat daquele motorista no canto inferior direito, piscando em vermelho com
   **"Aceitou a rota …"**, até alguém abrir.

Se dois motoristas aceitarem ao mesmo tempo, **só o primeiro leva**. Quem já tem
rota em andamento não consegue aceitar outra.

### Cancelar uma rota aceita

No portal, em **Rotas → Minhas rotas**, o motorista usa **Cancelar minha parte**
e confirma. Então:

- aparece no chat: `❌ Cancelei a rota: …`;
- abre o balão piscando no painel da operação com **"Cancelou a rota …"**;
- se ninguém mais estiver na rota, ela volta a **Aberta** e reaparece no mural.

### Balões de aviso no painel

- Um balão por motorista; vários balões ficam empilhados.
- Clicar abre o chat. O **X** dispensa o aviso.
- Os balões continuam após recarregar a página (ficam salvos no navegador de
  cada usuário).
- Quem não estava com o painel aberto no momento não recebe o balão depois, mas
  a mensagem fica no chat do motorista.

---

## Andamento do frete

O motorista informa cada etapa e a operação confirma as chegadas:

| Etapa | Quem age | Botão |
| --- | --- | --- |
| Aguardando início | Motorista | **Iniciar frete · a caminho do posto** |
| A caminho da coleta | Motorista | **Cheguei ao posto de coleta** |
| Chegada à coleta pendente | Operação | **Confirmar chegada ao posto** |
| Coleta confirmada | Motorista | **A caminho do cliente final** |
| A caminho do cliente final | Motorista | **Cheguei ao cliente final** |
| Chegada ao cliente pendente | Operação | **Confirmar chegada ao cliente** |
| Frete concluído | — | O frete vai para os acertos financeiros |

A operação acompanha tudo em **Rotas → Rotas**, na rota selecionada. Lá também
estão **Concluir rota** e **Cancelar rota**.

---

## Chat entre operação e motorista

- Cada motorista tem uma conversa com a operação.
- As mensagens ficam salvas e chegam em tempo real no portal. No app, a conversa
  é atualizada a cada poucos segundos enquanto ele está aberto.
- Mostra quando o outro lado está digitando.
- Alertas de rotas, aceites e cancelamentos também aparecem no chat.
- No painel, o chat abre em uma janela que pode ser arrastada e minimizada; o
  balão minimizado pisca quando chega mensagem nova.
- O superadmin tem o **arquivo de conversas** no painel do motorista selecionado.

---

## Acertos financeiros

Depois que o frete é concluído:

1. **Motorista**: em **Fretes** (portal) ou **Fretes** (app), informa o valor do
   frete e, se quiser, uma observação.
2. **Operação**: em **Rotas → Acertos**, confere o frete, ajusta a situação,
   registra a referência do pagamento e anexa o **comprovante** (PDF, JPEG ou
   PNG, até 8 MB).
3. **Motorista**: acompanha a situação e baixa o comprovante em **Baixar
   comprovante**.

Situações: **Pendente** → **Aprovado** → **Pago**.

Administradores e operadores têm acesso aos acertos.

---

## Relatórios e indicadores

Aba **Rotas**:

- **Relatórios**: filtros por situação, cliente, motorista e período, com resumo,
  totais por motorista e por cliente e exportação.
- **Dashboard**: total de rotas, ativas, concluídas, distância total, rotas dos
  últimos 14 dias, motoristas mais ativos e clientes com mais rotas.

---

## Painel do motorista (web e app)

### Navegação do portal web

| Aba | Conteúdo |
| --- | --- |
| **Início** | Disponibilidade, situação operacional, observações para o comercial e atalhos |
| **Mural** | Abre o mural de rotas em aberto |
| **Perfil** | Dados do cadastro |
| **Rotas** | Minhas rotas e as etapas do frete |
| **Fretes** | Recebimentos e comprovantes |
| **Chat** | Conversa com a operação |
| **Ajustes** | Preferências e sair |

No celular, a navegação fica no rodapé; em telas grandes, no topo da página.

### Disponibilidade e localização

- Para ficar **disponível**, o motorista informa **cidade, data e hora** em que
  estará livre. Isso ajuda a operação a oferecer fretes antes.
- Ao ficar disponível, o sistema pede permissão de localização. O GPS é enviado
  periodicamente para a operação encontrar o motorista no mapa.
- Situações operacionais: Estou disponível, Aguardando carregamento, Aguardando
  documentação, Em trânsito e Aguardando descarga.

### Perfil

O motorista vê os dados do cadastro. Para alterar algo, abre uma solicitação de
alteração na própria tela de perfil.

### App Android

O app tem as mesmas funções principais: disponibilidade com GPS (inclusive em
segundo plano), mural de rotas, etapas do frete, fretes e recebimentos, chat,
dados do motorista e do veículo, **Esqueci minha senha** e a troca obrigatória
de senha temporária.

---

## Portal da transportadora

A transportadora aprovada tem três abas:

| Aba | O que faz |
| --- | --- |
| **Motoristas** | Cadastra motoristas (nome, e-mail, celular, senha inicial e compartimentação). Eles ficam vinculados à transportadora e passam pela aprovação da operação. |
| **Veículos** | Cadastra veículos (tipo, placa, capacidade, compartimentação e produtos), que passam pela aprovação da operação, e vincula um motorista a cada veículo. |
| **Localizar** | Mapa com os motoristas vinculados e os pontos liberados para a transportadora. |

---

## Portal do cliente

A conta de cliente entra no sistema, mas o portal mostra **"Tela em
desenvolvimento"**. O acompanhamento de cargas pelo cliente ainda não existe.

---

## Ferramentas do superadmin

Aba **Dados**, somente para o superadmin:

- consultar os registros de cada tabela;
- apagar registros individuais;
- limpar uma tabela inteira, digitando **ZERAR** para confirmar.

As contas de superadmin são sempre preservadas. Apagar registros pode apagar
dados relacionados. **Use com cuidado: não há como desfazer.**

---

## Regras gerais do sistema

- **Telefone único**: o mesmo celular não pode estar em dois cadastros
  diferentes (contas, motoristas, transportadoras, clientes e postos). A conta,
  o cadastro de motorista e a transportadora do mesmo dono podem usar o mesmo
  número. Formatação, `+55` e espaços são ignorados na comparação.
- **E-mail de login único**: não existem duas contas com o mesmo e-mail
  (maiúsculas e minúsculas contam como iguais).
- **CPF, CNH, CNPJ e placa** também são únicos.
- **Distâncias** sempre são calculadas pelo trajeto, nunca digitadas.
- **Avisos em tempo real**: o portal recebe eventos ao vivo (alertas, aceites,
  mensagens) e se atualiza sozinho.

---

## Limitações conhecidas

- No painel, os formulários **Cadastros → Transportadoras** e **Cadastros →
  Veículos** gravam apenas no navegador de quem cadastrou e não vão para a API.
  Transportadoras e veículos válidos são os que vêm do cadastro público e do
  portal da transportadora.
- As **solicitações de alteração de dados** abertas em **Perfil / Meus dados**
  ficam salvas, mas só aparecem para o superadmin na aba **Dados**.
- A tela **Meus dados** ainda pede a data de nascimento "para recuperar a
  senha", mas a recuperação de senha não usa mais esse dado.
- E-mails de motorista, transportadora e cliente (fora o e-mail de login) podem
  se repetir. Alterar o e-mail no perfil do motorista não muda o e-mail de login.
- O app Android não tem a opção de cancelar uma rota aceita (só o portal web).
- Telefones que já estavam duplicados antes da regra de telefone único
  continuam no banco; a regra vale para novos cadastros e para alterações de
  telefone.
- A tela de nova rota fala em alertar "motoristas online", mas o alerta vai para
  todos os motoristas homologados.

---

## Para desenvolvedores

### Estrutura

```text
frontend/       Portal web (React + Vite + TypeScript + Tailwind + Leaflet)
backend/        API (Express + Prisma + SQLite)
mobile/         App Android (Expo / React Native)
```

### Requisitos

- Node.js 20 ou superior e npm
- Android Studio/SDK somente para gerar o APK
- Fly CLI somente para deploy

### Variáveis de ambiente

`backend/.env` (desenvolvimento):

```env
DATABASE_URL="file:./dev.db"
AUTH_SECRET="uma-chave-com-pelo-menos-32-caracteres"
PORT=3000
ADMIN_EMAIL="admin@acnetotransportes.com"
ADMIN_NAME="Administrador"
ADMIN_PASSWORD="uma-senha-forte"
CORS_ORIGINS="http://localhost:5173,http://127.0.0.1:5173"
```

Frontend: `VITE_API_URL` vazio em desenvolvimento (o Vite repassa `/api` para
`http://127.0.0.1:3000`) ou a URL da API publicada.

Mobile (`mobile/.env`): `EXPO_PUBLIC_API_URL` com a URL da API. Em celular
físico, use o IP da máquina na rede, não `localhost`.

### Rodar localmente

Em dois terminais, na raiz do projeto:

```powershell
# Terminal 1: API (http://localhost:3000)
npm install
npm run db:generate
npm run db:push
npm run dev:api

# Terminal 2: portal (http://localhost:5173)
npm run dev
```

`ECONNREFUSED 127.0.0.1:3000` significa que a API não está rodando.
`[vite] http proxy error: /api/events ... ECONNRESET` só indica que a API
reiniciou e a conexão de eventos ao vivo caiu; o navegador reconecta sozinho.

### Banco de dados

```powershell
npm run db:validate   # valida o schema
npm run db:generate   # gera o cliente Prisma
npm run db:push       # aplica o schema ao banco
npm run db:seed       # dados iniciais
npm run db:studio     # abre o Prisma Studio
```

No Windows, pare a API antes de `db:generate`/`db:push`; com ela rodando, o
Prisma não consegue substituir o arquivo do motor (`EPERM ... query_engine`).

### App Android

```powershell
cd mobile
npm install
npx expo start                     # desenvolvimento
npm run android:release:short-path # gera o APK de release
```

O APK fica em `mobile/android/app/build/outputs/apk/release/`. Antes de cada
versão, aumente `expo.version`/`expo.android.versionCode` em `mobile/app.json` e
`versionName`/`versionCode` em `mobile/android/app/build.gradle` (o
`versionCode` sempre aumenta). O script de caminho curto evita o erro
`Filename longer than 260 characters` do Windows.

### Deploy (Fly.io)

API e portal são dois apps separados. Publique **a API primeiro**.

| Parte | Pasta | App |
| --- | --- | --- |
| API | `backend/` | `fly.toml` + `Dockerfile` (SQLite em volume montado em `/data`) |
| Portal | raiz | `fly.toml` + `Dockerfile` + `nginx.conf` |

```powershell
# API
cd backend
fly secrets set AUTH_SECRET=... ADMIN_PASSWORD=... -a <app-da-api>
fly deploy --ha=false -a <app-da-api>
curl https://<app-da-api>.fly.dev/api/health

# Portal
cd ..
fly deploy -a <app-do-portal>
```

- `AUTH_SECRET` (32+ caracteres) e `ADMIN_PASSWORD` (12+) são obrigatórios em
  produção. `SUPERADMIN_PASSWORD` cria o superadmin.
- A API roda `prisma db push` ao iniciar, então tabelas novas são criadas no
  deploy. Se o Prisma pedir confirmação por perda de dados, revise e faça um
  deploy com `--env PRISMA_PUSH_FLAGS=--accept-data-loss`.
- `CORS_ORIGINS` da API deve ser exatamente a URL do portal.
- A URL da API fica gravada no build do portal: ao mudar, publique o portal de
  novo. Para o app, gere um APK novo.
- Mantenha **uma** máquina da API (o banco é um arquivo SQLite).
- Não entregue nem versione arquivos `.env`.

### Validação antes de publicar

```powershell
npm run db:validate
npm run typecheck
npm run lint
npm run build
node --check backend/server/index.mjs
cd mobile; npx tsc --noEmit
```
