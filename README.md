# PRISMA Launcher

Agente de desktop (Electron) que fica na bandeja do sistema e abre, com um atalho
global configurável, uma busca ultrarrápida (fuzzy, algoritmo [Bitap](https://en.wikipedia.org/wiki/Bitap_algorithm))
sobre seus favoritos, links encurtados e QR Codes salvos no [PRISMA](https://github.com/pgup-sistemas/prisma).

Inspirado em launchers como [Raycast](https://raycast.com), [Alfred](https://alfredapp.com)
e principalmente o [ueli](https://github.com/oliverschwendener/ueli) (open source,
Electron, multiplataforma) — mesma ideia de atalho global + busca extensível, aqui
amarrada à conta do usuário num SaaS em vez de um sistema de plugins genérico.

## Funcionalidades

- **Busca ultrarrápida** — Bitap com tolerância a 1 erro de digitação, ranqueada por
  uso recente e frequência, consumindo a mesma API do widget Launcher embutível do PRISMA.
- **Atalho global configurável** — escolhido pelo próprio usuário na primeira execução,
  com validação de disponibilidade antes de salvar (não sobrescreve atalhos de outros apps).
- **Ações rápidas** — cole uma URL na busca e gere QR Code ou encurte o link ali mesmo,
  sem trocar de janela.
- **Sincronização de favoritos** (opt-in) — monitora o arquivo local de favoritos do
  Chrome/Edge/Brave/Chromium e importa os novos automaticamente para sua conta PRISMA.
- **Checagem de atualização** — compara a versão instalada com a mais recente publicada
  pelo servidor e avisa na bandeja quando houver uma nova.
- Multiplataforma: Windows, macOS e Linux.

## Rodando em desenvolvimento

```bash
npm install
npm start
```

Na primeira execução, a janela de **Configurações** abre sozinha pedindo:
- **URL do servidor PRISMA** (ex: `http://localhost/prisma`)
- **UUID** e **Chave de API** do usuário — ambos ficam em **Perfil → Widget Launcher**
  dentro do PRISMA (é a mesma chave usada no `<script>` de embed)
- **Atalho global** — clique no campo e pressione a combinação desejada

Depois disso o agente fica na bandeja do sistema. Aperte o atalho configurado (ou
clique no ícone da bandeja) pra abrir a busca em qualquer lugar do sistema. O ícone
de engrenagem dentro da busca reabre as Configurações a qualquer momento.

## Gerando os instaladores

```bash
npm run dist:linux   # .AppImage e .deb
npm run dist:win      # .exe (NSIS) — precisa rodar em/via Windows
npm run dist:mac       # .dmg — precisa rodar em macOS
```

Ícones `.ico`/`.icns` (só existe `assets/icon.png` por padrão):

```bash
npx electron-icon-builder --input=assets/icon.png --output=assets --flatten
```

Builds multiplataforma do Electron normalmente precisam rodar no próprio SO de
destino (ou via CI — veja [`.github/workflows`](.github/workflows) se configurado).

## Arquitetura

```
main.js               processo principal: tray, atalho global, janelas, config
                        (electron-store), sync de favoritos, checagem de versão
preload.js              ponte segura (contextBridge) entre main e renderer
renderer/
  settings.html/js      tela de configuração (primeira vez + editar depois)
  search.html/js         janela de busca flutuante (Bitap + ações rápidas)
assets/                  ícones (app e bandeja)
```

### IPC (preload.js → main.js)

| Canal | Direção | Descrição |
|---|---|---|
| `get-config` / `save-config` | invoke | lê/grava configuração (electron-store) |
| `test-shortcut` | invoke | testa se um atalho está disponível sem substituir o atual |
| `open-external` | invoke | abre URL no navegador padrão (só `http(s)://`) |
| `copy-to-clipboard` | invoke | copia texto pra área de transferência (via `clipboard` do Electron) |
| `hide-search-window` / `resize-search-window` | send | controla a janela de busca |
| `open-settings` / `close-settings` | invoke | abre/fecha a janela de Configurações |
| `window-shown` | on (main→renderer) | avisa a busca que a janela ficou visível |

### Backend consumido (PRISMA)

| Rota | Auth | Uso |
|---|---|---|
| `GET /launcher/index` | `uid` + `key` (query) | índice de busca (favoritos/links/QR) |
| `POST /launcher/track` | `uid` + `key` | registra uso de um item selecionado |
| `POST /agent/qr` | `uid` + `key` | gera QR Code a partir da busca (ação rápida) |
| `POST /agent/link` | `uid` + `key` | encurta link a partir da busca (ação rápida) |
| `POST /agent/bookmarks/sync` | `uid` + `key` | importa favoritos lidos localmente |
| `GET /download/version.json` | pública | versão mais recente publicada, pra checagem de atualização |

Todas as chamadas usam corpo `application/x-www-form-urlencoded` (não JSON) de
propósito — evita preflight CORS, já que o renderer roda em origem `file://`.

## Segurança

- `contextIsolation: true` e `nodeIntegration: false` em todas as janelas — o
  renderer nunca tem acesso direto ao Node.js, só ao que `preload.js` expõe
  explicitamente via `contextBridge`.
- `shell.openExternal()` só aceita URLs `http://`/`https://`, nunca abre caminhos
  de arquivo local ou protocolos arbitrários.
- Nenhuma credencial fica hardcoded — UUID e chave de API ficam no `electron-store`
  local (arquivo JSON na pasta de dados do usuário do SO), preenchidos pelo próprio
  usuário na tela de Configurações.
- Sincronização de favoritos é **opt-in** (desligada por padrão) e só lê o arquivo
  local do navegador — nada é enviado sem o usuário habilitar explicitamente a opção.

## Licença

[MIT](LICENSE).
