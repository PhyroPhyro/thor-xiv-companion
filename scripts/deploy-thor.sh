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
# -- verificacao: abrir na TELA DE BAIXO (display presentation) -- display <id> e exigir Displayed+resumed+sem crash
# OBS vendor: abrir na tela de cima NAO funciona (cocoonshell ExternalDisplayActivity owns baixo e mata
# activities alheias na de cima); relocate in-app e launch cross-display sao negados ao app.
function Probe([string]\$label, [string[]]\$extra) {
  & \$adb -s \$id shell am force-stop com.phyro.thorxiv 2>&1 | Out-Null
  & \$adb -s \$id logcat -c 2>&1 | Out-Null
  & \$adb -s \$id logcat -b crash -c 2>&1 | Out-Null
  & \$adb -s \$id shell am start -n com.phyro.thorxiv/.MainActivity @\$extra 2>&1 | Out-Null
  Start-Sleep -Seconds 10
  \$crash = & \$adb -s \$id logcat -d -b crash 2>&1
  \$disp  = & \$adb -s \$id logcat -d -s ActivityTaskManager 2>&1 | Select-String 'Displayed com.phyro.thorxiv'
  \$pid2  = (& \$adb -s \$id shell pidof com.phyro.thorxiv 2>&1) -join ''
  \$res   = & \$adb -s \$id shell dumpsys activity activities 2>&1 | Select-String 'topResumedActivity=.*thorxiv'
  Write-Output (\"PROBE [\" + \$label + \"] displayed=\" + [bool]\$disp + \" resumed=\" + [bool]\$res + \" pid=\" + \$pid2)
  if (\$crash -match 'thorxiv') { Write-Output \"PROBE-CRASH [\$(\$label)]:\"; \$crash | Select-String 'thorxiv' | Select-Object -First 25 }
  if (-not \$disp -or (\$crash -match 'thorxiv')) { return \$false }
  return [bool]\$res
}
\$dispId = ((& \$adb -s \$id shell dumpsys display 2>&1 | Select-String 'mDisplayId=') | ForEach-Object { ((\$_ -split '=')[1] -replace '\s','') } | Where-Object { \$_ -match '^\d+$' -and \$_ -ne '0' } | Select-Object -First 1)
Write-Output (\"DISPLAYS: secundario=\" + \$dispId)
if (-not \$dispId) { Write-Output 'THOR-NO-SECOND-DISPLAY'; exit 1 }
\$ok = Probe 'tela-baixo' @('--display', \$dispId)
if (-not \$ok) {
  Write-Output 'THOR-NOT-RESUMED-NA-TELA-DE-BAIXO (talvez cocoonshell segure a display; abra pelo dock do Thor e valide manualmente)'
  exit 1
}
Write-Output (\"THOR-OK: resumed na tela de baixo, sem crash (\" + \$NAME + ')')

"
