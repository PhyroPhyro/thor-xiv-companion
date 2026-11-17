#!/usr/bin/env bash
# Deploy do plugin no PC (FFXIV): copia o zip do dist e troca o DLL em C:\Tools\ThorXivBridge.
# Uso: scripts/deploy-pc.sh dist/ThorXivBridge-<versao>.zip
# Requer: ssh phyro@192.168.15.194 (chave id_ed25519_omv), zip com ThorXivBridge.dll na raiz.
set -euo pipefail

ZIP="${1:?uso: $0 dist/ThorXivBridge-<versao>.zip}"
[ -f "$ZIP" ] || { echo "zip nao encontrado: $ZIP" >&2; exit 1; }

SSH_OPTS=(-F /dev/null -i "${KEY:-/root/.ssh/id_ed25519_omv}"
  -o UserKnownHostsFile="${KNOWN_HOSTS:-/tmp/opencode/known_hosts}"
  -o BatchMode=yes -o ConnectTimeout=6)
PC_HOST="${PC_HOST:-phyro@192.168.15.194}"
NAME="$(basename "$ZIP")"

echo "== copiando $NAME para o PC =="
scp "${SSH_OPTS[@]}" "$ZIP" "$PC_HOST:/Users/phyro/$NAME"

echo "== substituindo DLL (com backup) =="
ssh "${SSH_OPTS[@]}" "$PC_HOST" "
\$ErrorActionPreference='Stop'
\$zip=\"C:/Users/phyro/$NAME\"
\$dest='C:/Tools/ThorXivBridge'
Copy-Item -Path \"\$dest/ThorXivBridge.dll\" -Destination \"\$dest/ThorXivBridge.dll.bak\" -Force
try {
  Expand-Archive -Path \$zip -DestinationPath \$dest -Force
} catch {
  if (\$_.Exception.Message -match 'being used|in use|em uso') {
    Write-Output 'LOCKED: DLL em uso — o jogo esta rodando? Feche o FFXIV/XIVLauncher e rode de novo.'
    exit 2
  } else { throw }
}
Write-Output ('DEPLOYED: ' + (Get-Item \"\$dest/ThorXivBridge.dll\").LastWriteTimeUtc.ToString('u'))
Write-Output ('HASH: ' + (Get-FileHash \"\$dest/ThorXivBridge.dll\" -Algorithm SHA256).Hash)
"
echo "== hash local (conferir com HASH acima) =="
unzip -p "$ZIP" ThorXivBridge.dll | sha256sum | awk '{print "HASH-LOCAL: " toupper($1)}'
