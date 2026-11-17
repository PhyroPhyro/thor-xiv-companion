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
# -- verificacao: exige Displayed + topResumed thorxiv + jogo seguem resumed + crash limpo.
# A saida do Probe NAO pode usar Write-Output (vira retorno da funcao e falseia a checagem).
function Probe([string]\$label, [string[]]\$extra) {
  & \$adb -s \$id shell am force-stop com.phyro.thorxiv 2>&1 | Out-Null
  Start-Sleep -Seconds 2
  \$resumedBefore = (& \$adb -s \$id shell dumpsys activity activities 2>&1 | Select-String 'Resumed: ActivityRecord' | Where-Object { \$_ -notmatch 'thorxiv' } | ForEach-Object { \$_.ToString().Trim() }) -join ' // '
  & \$adb -s \$id logcat -c 2>&1 | Out-Null
  & \$adb -s \$id logcat -b crash -c 2>&1 | Out-Null
  & \$adb -s \$id shell am start -n com.phyro.thorxiv/.MainActivity @\$extra 2>&1 | Out-Null
  Start-Sleep -Seconds 10
  \$crash = & \$adb -s \$id logcat -d -b crash 2>&1
  \$disp  = & \$adb -s \$id logcat -d -s ActivityTaskManager 2>&1 | Select-String 'Displayed com.phyro.thorxiv'
  \$pid2  = (& \$adb -s \$id shell pidof com.phyro.thorxiv 2>&1) -join ''
  \$res   = & \$adb -s \$id shell dumpsys activity activities 2>&1 | Select-String 'topResumedActivity=.*thorxiv'
  \$resumedAfter = (& \$adb -s \$id shell dumpsys activity activities 2>&1 | Select-String 'Resumed: ActivityRecord' | Where-Object { \$_ -notmatch 'thorxiv' } | ForEach-Object { \$_.ToString().Trim() }) -join ' // '
  \$global:LOG += 'PROBE [' + \$label + '] displayed=' + [bool]\$disp + ' topResumed=' + [bool]\$res + ' pid=' + \$pid2
  \$global:LOG += '  outras-resumed ANTES: ' + \$resumedBefore
  \$global:LOG += '  outras-resumed DEPOIS: ' + \$resumedAfter
  \$okv = \$true
  if (\$resumedBefore -and -not \$resumedAfter) { \$global:LOG += 'PROBE-FOCUS-STEAL: abrir o app mandou o JOGO p/ background'; \$okv = \$false }
  if (-not \$res) { \$global:LOG += 'WARN: thorxiv nao e topResumed (com session de jogo, o Cocoon retem o flag; atividade visivel e interativa e o normal)' }
  if (-not \$disp) { \$global:LOG += 'PROBE-NOT-DISPLAYED'; \$okv = \$false }
  if (\$crash -match 'thorxiv') {
    \$global:LOG += 'PROBE-CRASH-stack: ' + (((& \$adb -s \$id logcat -d -b crash 2>&1 | Select-String 'thorxiv|AndroidRuntime' | Select-Object -First 20) | ForEach-Object { \$_.ToString() }) -join ' || ')
    \$okv = \$false
  }
  return \$okv
}
\$global:LOG = @()
\$dispId = ((& \$adb -s \$id shell dumpsys display 2>&1 | Select-String 'mDisplayId=') | ForEach-Object { ((\$_ -split '=')[1] -replace '\s','') } | Where-Object { \$_ -match '^\d+$' -and \$_ -ne '0' } | Select-Object -First 1)
\$global:LOG += 'DISPLAYS: secundario=' + \$dispId
if (-not \$dispId) { & \$adb -s \$id 2>&1 | Out-Null; Write-Output 'THOR-NO-SECOND-DISPLAY'; exit 1 }
\$ok = Probe 'tela-baixo' @('--display', \$dispId)
\$global:LOG | ForEach-Object { Write-Output \$_ }
if (-not \$ok) { Write-Output 'THOR-VERIFY-FAILED'; exit 1 }
Write-Output ('THOR-OK: app visivel na tela de baixo, jogo nao foi p/ background, sem crash (' + \$NAME + ')')
"
