# Thor XIV Companion

Companion de **Final Fantasy XIV** para a segunda tela do **AYN Thor**, no modo **streaming remoto** (jogo rodando no PC via Apollo/Sunshine → Moonlight DS na tela superior).

Dois componentes:

- **ThorXivBridge** — plugin Dalamud (C#) que roda no PC junto com o jogo. Expõe o estado (party, HP/MP, zona, coordenadas de mapa, alvo, chat) via WebSocket + HTTP na LAN, e serve a PWA do companion.
- **companion/** — PWA que roda no navegador da tela inferior do Thor, consumindo esse WebSocket. Tem **modo demo** (funciona sem jogo, para testar a UI).

## Status

- F1 (streaming Moonlight DS no Thor) — depende de setup no seu PC/Thor, não feito aqui
- F2 (plugin bridge) — **código pronto e compilado** (`dist/ThorXivBridge-0.1.0.zip`, API Dalamud 15 / net10)
- F3 (PWA companion) — **pronta**; protocolo validado por smoke test (HTTP + WS + broadcast) com harness local
- Validação end-to-end com o jogo real — pendente (teste no PC)

## Setup no PC (F2)

1. Instale **XIVLauncher** com Dalamud habilitado (padrão).
2. Baixe/compile o plugin, ou use o `dist/ThorXivBridge-0.1.0.zip` incluído neste repo (compilado em 2026-11-16 contra Dalamud API 15).
3. Extraia o zip em qualquer pasta, ex.: `C:\Tools\ThorXivBridge\`.
4. No jogo: `/xlsettings` → aba **Experimental** → em *Dev Plugin Locations* adicione o caminho completo de `ThorXivBridge.dll` → salve.
5. `/xlplugins` → **Dev Tools** → ative *Thor XIV Companion Bridge*.
6. Use `/thorxiv` no chat: mostra `http://IP-DO-PC:11436/ws` e quantos clientes conectados.
7. (Opcional) libere a porta TCP 11436 no firewall do PC, escopo LAN.

### Configuração (arquivo `thorxiv.json` ao lado do DLL)

```json
{
  "port": 11436,
  "broadcastMs": 200,
  "pollMs": 100,
  "mapsDirectory": "",
  "chatEnabled": true
}
```

`mapsDirectory` vazio = pasta `maps/` ao lado do DLL. Coloque imagens de mapa nomeadas `{mapId}.jpg|png|webp` (o `mapId` atual aparece no topo da PWA). Exemplos: 184 = The Goblet, 51 = Central Thanalan.

## Uso no Thor (F3/F4)

### Opção A — APK nativo (recomendado)

`dist/thorxiv-companion-0.1.0.apk` — app Android que:

1. Move a própria janela para a **tela inferior** (presentation display) automaticamente;
2. **Descobre o bridge na LAN** sozinho: mDNS (`_thorxiv._tcp`, anunciado pelo plugin) **e** varredura TCP `/24` na porta 11436 como fallback — se achar o bridge salvo e vivo, abre direto; senão mostra a tela de conexão com os hosts encontrados (+ entrada manual de IP);
3. Carrega a PWA do bridge no WebView (mesmo app, mesmo protocolo), com monitoração de "bridge perdido" e retorno automático à tela de descoberta;
4. Tem **modo demo offline embutido** (a PWA vai dentro do APK) — funciona no Thor sem nenhum PC.

Instalação: copie o APK para o Thor, instale (allow unknown apps), abra. Se o plugin já estava rodando no PC com `thorxiv.json`, nada a configurar.

Firewall do PC: para o mDNS, permitir UDP 5353 na rede privada (o Windows pergunta na primeira execução). Sem isso, só o scan `/24` — que ainda acha o bridge.

Config do port custom: `scripts/build-apk.sh` gera keystore de debug em `scripts/debug.keystore`.

### Opção B — navegador na tela de baixo

`http://IP-DO-PC:11436/` no Hermit/Chrome (Wayfinder app pair com Moonlight DS).

Ordem de uso típica: abrir o ThorXIV (fica na tela de baixo) → abrir Moonlight DS (tela de cima) → jogar.

## Executores (v0.5+)

Comandos tocam no jogo **sem plugins extras**: o bridge injeta via `RaptureShellModule.ExecuteCommandInner`
(FFXIVClientStructs) na thread do framework. `POST /api/command` aceita apenas tipos nativos:

- `{"type":"command","cmd":"/ac \"Holy Sheltron\" <1>"}` → executa 1 linha
- `{"type":"skill","actionId":29,"target":"target"}` → **skill nativa** (mesmo caminho do botão da hotbar do jogo; alvos `auto|target|self|p1..p8`; catálogo com descrição em `GET /api/actions`)
- `{"type":"sequence","lines":["/ac ...","/ac ..."],"delayMs":200}` → macro próprio multi-linha (`//` comenta)

GET `/api/macros` lista os macros do jogador (nome/set/id/linhas) — a PWA usa para importar botões prontos como sequências nativas.
Segurança: allow-list de tipos, só `/comandos` estáticos disparados por toque humano — sem automação reativa.

## Protocolo (v1)

- `GET /` — PWA companion (assets em `companion/` dentro do pacote do plugin)
- `GET /api/state` — snapshot único (polling fallback)
- `GET /ws` (WebSocket) — push de snapshot a cada `broadcastMs`

Snapshot:

```json
{
  "type": "state", "ts": 1731700000000, "loggedIn": true,
  "zone": {"id": 399, "name": "The Goblet"},
  "map": {"id": 184, "name": "The Goblet"},
  "player": {"name": "...", "job": "DRG", "level": 100,
             "hp": 300000, "maxHp": 432100, "mp": 9000, "maxMp": 10000,
             "world": {"x": 0, "y": 0, "z": 0},
             "mapCoords": {"x": 21.0, "y": 21.0}},
  "target": {"name": "...", "hp": 0, "maxHp": 0, "dead": false},
  "party": [{"name": "...", "job": "WHM", "level": 100,
             "hp": 0, "maxHp": 0, "mp": 0, "maxMp": 0, "online": true}],
  "chat": [{"channel": 14, "sender": "...", "text": "...", "stamp": 1731700000}]
}
```

`channel` = `XivChatType` da Dalamud (14 Party, 13/12 Tell, 10 Say, 57 System, ...).

## Desenvolvimento / testes

```bash
# compilar o plugin (precisa .NET 10 SDK)
dotnet build dalamud-plugin/ThorXivBridge -c Release
# artefato: dalamud-plugin/ThorXivBridge/bin/Release/ThorXivBridge/latest.zip

# smoke test do protocolo (sem jogo): sobe o harness e valida HTTP+WS+static
dotnet build tests/ServerHarness -c Release
dotnet tests/ServerHarness/bin/Release/net10.0/ServerHarness.dll companion 11437 &
node scripts/smoke.mjs 11437

# APK do Thor (build manual, sem Gradle) — requer JDK17, android-sdk-build-tools
# (Debian arm64), android-33 em /tmp/opencode/sdk/platforms e r8.jar em /tmp/opencode
scripts/build-apk.sh
# -> dist/thorxiv-companion-0.1.0.apk (assinado v2, 34 KB)
```

No Linux o build do plugin usa `DALAMUD_HOME` apontando para as referências da Dalamud (ex.: zip de `https://goatcorp.github.io/dalamud-distrib/stg/latest.zip` extraído). No Windows basta ter XIVLauncher instalado.

### Deploy no PC (OBRIGATÓRIO após cada build do plugin)

Toda versão nova do plugin **precisa ser deployada no PC** antes de considerar a tarefa concluída
(o usuário testa em jogo). Use o script (roda na Axel, via SSH com chave `id_ed25519_omv`):

```bash
scripts/deploy-pc.sh dist/ThorXivBridge-<versão>.zip
# -> copia o zip, faz backup do DLL atual (.bak), extrai em C:\Tools\ThorXivBridge
#    e imprime o hash SHA256 do DLL novo p/ conferir com o hash local
```

- Se imprimir `LOCKED: DLL em uso` — o FFXIV está aberto; feche o jogo e rode de novo.
- A config do XIVLauncher (`DevPluginLoadLocations` → `C:\Tools\ThorXivBridge\ThorXivBridge.dll`,
  `StartOnBoot`) é permanente — o deploy só troca arquivos.
- Validar com o hash (`Get-FileHash` no PC vs `sha256sum` local) e registrar no vault o hash.
- Se o jogo estiver aberto no momento do deploy, avise o usuário para reiniciar o FFXIV e recarregar.

## Notas de segurança / política

- O bridge escuta em todas as interfaces (LAN) — exponha apenas em rede confiável; nada de port forward.
- Ferramentas de terceiros no FFXIV (Dalamud/leitura de estado) são toleradas pela Square Enix na prática, mas sem garantia. O bridge injeta apenas comandos estáticos `/...` disparados por toque humano no companion — sem automação, sem loop, sem reação a eventos do jogo.

## Roadmap

- [x] F2 plugin bridge (compilado, protocolo validado; + anúncio mDNS)
- [x] F3 PWA companion (minimapa, party, chat, alvo, demo, settings)
- [x] F4 APK do Thor (tela de baixo + descoberta mDNS/scan + WebView + demo offline) — **código pronto, APK assinado; falta validar no device**
- [ ] F1 streaming no Thor — testar com Moonlight DS + `dist/ThorXivBridge-0.1.0.zip`
- [ ] validação em jogo real (coordenadas, nomes, jobs, canais de chat)
- [ ] F6 conteúdo offline extra (checklists de duty)

Detalhes e decisões no vault: `Personal/4. Projetos/Thor XIV Companion/`.
