#!/usr/bin/env bash
# Deploy do APK no AYN Thor conectado via USB ao PC (adb). Avisos se ausente/não autorizado.
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
\$ErrorActionPreference='Continue'
\$adb='$ADB'; \$apk='C:/Users/phyro/$NAME'
& \$adb start-server 2>&1 | Out-Null
\$lines = & \$adb devices 2>&1 | Where-Object { \$_ -match '\s(device|unauthorized)\$' }
\$unauth = \$lines | Where-Object { \$_ -match 'unauthorized' }
\$ok = \$lines | Where-Object { \$_ -match 'device' }
if (-not \$lines) { Write-Output 'THOR-NOT-CONNECTED'; exit 0 }
if (-not \$ok) { Write-Output 'THOR-UNAUTHORIZED: aprove o dialogo de USB debugging na tela do Thor'; exit 0 }
\$id = (@(\$ok)[0] -split '\s+')[0]
Write-Output (\"THOR-DEVICE: \" + \$id)
& \$adb -s \$id install -r \$apk 2>&1 | Select-Object -Last 2
\$v = & \$adb -s \$id shell dumpsys package com.phyro.thorxiv 2>&1 | Select-String 'versionName' | Select-Object -First 1
Write-Output (\"THOR-INSTALLED: \" + \$id + ' ' + \$v)
# -- verificação: abrir o app e checar crash --
& \$adb -s \$id shell am force-stop com.phyro.thorxiv 2>&1 | Out-Null
& \$adb -s \$id logcat -c 2>&1 | Out-Null; & \$adb -s \$id logcat -b crash -c 2>&1 | Out-Null
& \$adb -s \$id shell am start -n com.phyro.thorxiv/.MainActivity 2>&1 | Out-Null
Start-Sleep -Seconds 5
\$alive = (& \$adb -s \$id shell pidof com.phyro.thorxiv 2>&1) -join ''
\$crash = & \$adb -s \$id logcat -d -b crash 2>&1 | Select-String 'com.phyro.thorxiv'
if (\$crash) { Write-Output 'THOR-CRASH:'; \$crash | Select-Object -First 6; exit 1 }
if (-not \$alive -or \$alive -notmatch '^\d+') { Write-Output 'THOR-NOT-RUNNING (fechou sem stack de crash)'; & \$adb -s \$id logcat -d 2>&1 | Select-String 'thorxiv' | Select-Object -Last 8; exit 1 }
Write-Output (\"THOR-OK: vivo, pid \" + \$alive)
"
