#!/usr/bin/env bash
# Deploy do APK no AYN Thor conectado via USB ao PC (adb). Silencioso-aviso se ausente/não autorizado.
# Uso: scripts/deploy-thor.sh dist/thorxiv-companion-<v>.apk
set -euo pipefail

APK="${1:?uso: $0 dist/thorxiv-companion-<v>.apk}"
[ -f "$APK" ] || { echo "apk nao encontrado: $APK" >&2; exit 1; }

SSH_OPTS=(-F /dev/null -i "${KEY:-/root/.ssh/id_ed25519_omv}"
  -o UserKnownHostsFile="${KNOWN_HOSTS:-/tmp/opencode/known_hosts}"
  -o BatchMode=yes -o ConnectTimeout=6)
PC_HOST="${PC_HOST:-phyro@192.168.15.194}"
ADB="${ADB:-C:/Users/phyro/AppData/Local/Android/Sdk/platform-tools/adb.exe}"
NAME="$(basename "$APK")"

scp "${SSH_OPTS[@]}" "$APK" "$PC_HOST:/Users/phyro/$NAME"
ssh "${SSH_OPTS[@]}" "$PC_HOST" "
\$ErrorActionPreference='Stop'
\$adb='$ADB'; \$apk='C:/Users/phyro/$NAME'
\$dev = (& \$adb devices) | Select-String '\tabdevice' | ForEach-Object { (\$_ -split '\s+')[0] }
if (-not \$dev) {
  \$un = (& \$adb devices) | Select-String '\tunauthorized'
  if (\$un) { Write-Output 'THOR-UNAUTHORIZED: aprove o dialogo de USB debugging na tela do Thor' }
  else { Write-Output 'THOR-NOT-CONNECTED' }
  exit 0
}
\$id = \$dev | Select-Object -First 1
& \$adb -s \$id install -r \$apk | Select-Object -Last 2
\$v = (& \$adb -s \$id shell dumpsys package com.phyro.thorxiv | Select-String 'versionName' | Select-Object -First 1)
Write-Output (\"THOR-INSTALLED: \" + \$id + ' ' + \$v)
"
