# AGENTS.md — Thor XIV Companion

> Guia operacional para agentes de IA (opencode/Hermes) trabalhando neste repo.

## Visão geral

Companion de FFXIV para a segunda tela do **AYN Thor** (touch, exclusivamente online):
plugin Dalamud (`dalamud-plugin/ThorXivBridge/`) no PC + PWA (`companion/`) na tela inferior
do Thor (WebView no APK `android-app/` ou navegador). Detalhes de arquitetura/roadmap no
README.md e no vault (`4. Projetos/Thor XIV Companion`).

## Ciclo de trabalho (OBRIGATÓRIO em toda rodada de código)

1. Fazer as alterações.
2. Build: `DALAMUD_HOME=/root/.xlcore/dalamud/Hooks/dev dotnet build dalamud-plugin/ThorXivBridge -c Release` → 0 erros.
3. Smoke: `dotnet build tests/ServerHarness -c Release` + harness + `node scripts/smoke.mjs <porta> <dir-pwa>` → SMOKE PASSOU
3b. (opcional, quando Thor conectado ao PC) `scripts/deploy-pc.sh <zip> <apk>` roda o Thor automaticamente via adb
   (o smoke inclui `scripts/check-dom.mjs`: ids únicos, referências válidas e nenhuma captura
   top-level de id criado dinamicamente — o smoke NÃO executa JS da PWA, o check-dom cobre isso).
4. Bump de versão no csproj (breaking → minor; fix → patch) e gerar `dist/ThorXivBridge-<v>.zip`.
5. APK quando a PWA mudar: `APK_VERSION_NAME=<v-apk> scripts/build-apk.sh`.
6. **Deploy no PC**: `scripts/deploy-pc.sh dist/ThorXivBridge-<v>.zip` — hashes SHA256 (PC × local)
   iguais; se `LOCKED`, pedir para fechar o FFXIV e reexecutar (nunca contornar).
7. **Commit**: `git commit` com mensagem descritiva (padrão: `<versão>: resumo`).
8. Registrar no vault (Status/Logs do projeto) quando o ambiente/PC mudar.

## Identidade visual (inspirada em UI de MMO de fantasia, estilo FFXIV)

- Todo estilo vem de `companion/css/tokens.css`. **Proibido hex ou cor inline** (hex/rgb/named) fora do tokens.
- Janela/painel: fundo `--panel`, borda `1px --border` + linha interna `--border-inner`, raio `--radius`.
- Título de janela: `--font-title`, caixa alta pequena, cor `--gold`, linha fina dourada embaixo.
- Texto: sempre `--text` com `--text-shadow`. Secundário em `--text-muted`.
- Botão: fundo `--panel-solid`, borda `--border`; foco/ativo usa `--focus-glow`. Sem cor de fundo chamativa.
- Item de lista selecionado: fundo `--select-gradient` (esquerda para direita), texto `--gold-bright`.
- Divisor: linha de 1px com gradiente que esmaece nas duas pontas.
- Dourado só em título, seleção e foco; no máximo 1 destaque por área.
- Sem gradientes coloridos, sem sombras grandes, sem cantos muito arredondados.
- Todo elemento interativo precisa de estado de foco visível (navegação por gamepad).
- Componentes reutilizáveis em `companion/css/components/` (`panel.css` → `.panel`, `button.css` → `.btn` + variantes). Telas novas reaproveitam esses componentes em vez de recriar estilos.

## Convenções

- PWA: JS vanilla sem build step; IDs de elementos são contratos com `js/ui.js`/`js/app.js` — mover DOM mantendo IDs.
- Touch-first: alvos ≥44px; long-press = tooltip; nada depende de hover no Thor.
- Estado da hotbar: `localStorage` (`hotbar.v1` slots, `hotbar.grid.v1` preset). Export/import JSON mantém todos os slots (inclusive além do preset ativo).
- Segurança: nada de port-forward; bridge LAN-only; sem automação reativa no jogo.

## Lições (erros que não se repetem)

- **IDs únicos, sempre** (v0.5.3): botão e contêiner de overlay compartilharam o id `hb-config`;
  `$("id")` pega o primeiro, e o CSS do overlay (`position:fixed; inset:0`) se aplicou ao botão,
  virando um overlay full-screen inutilizável. Antes de commitar: `grep -c 'id="X"'` — cada id
  deve aparecer exatamente uma vez no HTML gerado; conferir todo par botão↔contêiner criado.
- **Elemento de innerHTML não existe na carga do script** (v0.5.5): `const grid = $("hotbar-grid")`
  no topo do IIFE capturou `null` (o elemento nasce em `build()`), `renderGrid()` estourou antes
  de ligar handlers → hotbar vazia e botões mortos por 3 versões (o overlay full-screen do Config
  escondia o problema). Regra: referenciar `$(...)` no momento do uso ou atribuir após o innerHTML;
  nunca capturar em escopo de carga um id que só nasce em template.
- **WebView Android: scroll × drag** (v0.5.7): `touch-action: none` nos slots matou o scroll da aba
  inteira, e pointer events perdem a corrida pro scroll (pointercancel antes do threshold → drag nunca
  começava). Regra: em lista rolável NUNCA `touch-action:none` no item; usar touch events com
  `touchmove passive:false` e padrão hold-then-drag — pan imediato deixa o browser rolar; segurar ~250ms
  → `preventDefault` dali em diante → mover = drag; mover antes do arm = cancelar gesto próprio.
- **Zip do plugin: sempre do output real do build** (v0.5.7): existiam DOIS `latest.zip` — o velho
  `bin/Release/latest.zip` (congelado no 0.5.1) e o correto `bin/Release/ThorXivBridge/latest.zip`
  (gerado a cada build). Copiei o velho 5 rodadas seguidas; o PC rodava 0.5.1 com DLL nova só no disco
  de espera. Regra: zip = `bin/Release/ThorXivBridge/latest.zip`; após deploy, conferir no PC o
  `AssemblyVersion` do `ThorXivBridge.json` E o tamanho/hash do DLL — hash local que casa com zip velho
  não prova nada.
- **Delegações Hermes: checar unicode sujo** (0.5.11): o operário escreveu comentários com acentos decompostos (NFD) e soft-hyphen (U+00AD) — invisíveis, mas quebram grep/normalize. Regra: após rodada do Hermes, `python3` scan de `\u00ad \u0301 \u0131` nos js/css/html alterados + NFC normalize.
- **Re-render = limpar antes de appendChild** (v0.5.6): `renderGrid()` sem `innerHTML = ""`
  acumulava os slots a cada chamada (grid duplicava e "embaralhava" ao alternar Editar/Pronto).
  Regra: toda função de render limpa o contêiner antes de recriar.
- **WebView: gesto é seu ou do navegador** (v0.5.6): long-press em slot abria o menu de contexto
  do WebView e o scroll roubava o pointer (pointercancel) — drag/long-press morriam. Regra:
  em elementos com drag/long-press, aplicar `touch-action: none`, `-webkit-touch-callout: none`,
  `user-select: none`, `contextmenu` com preventDefault e `pointer-events: none` nas `<img>`.
- **Overlay = menor forma possível** (v0.5.3): nada de modal full-screen para conteúdo pequeno
  (menu de opções, presets). Usar popover ancorado no gatilho (`position:fixed` alinhado ao
  `getBoundingClientRect()` do botão), com fechamento por toque fora dele + botão Fechar. Modal
  com backdrop só quando o conteúdo for grande (ex.: editor de slot).
