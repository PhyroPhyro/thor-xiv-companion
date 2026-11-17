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
3. Smoke: `dotnet build tests/ServerHarness -c Release` + harness + `node scripts/smoke.mjs` → SMOKE PASSOU.
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
- **Overlay = menor forma possível** (v0.5.3): nada de modal full-screen para conteúdo pequeno
  (menu de opções, presets). Usar popover ancorado no gatilho (`position:fixed` alinhado ao
  `getBoundingClientRect()` do botão), com fechamento por toque fora dele + botão Fechar. Modal
  com backdrop só quando o conteúdo for grande (ex.: editor de slot).
