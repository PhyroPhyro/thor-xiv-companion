#!/usr/bin/env bash
# Build manual do APK (sem Gradle): aapt2 + javac + d8 + zip + zipalign + apksigner.
# Requisitos ( Axel ): openjdk-17, android-sdk-build-tools, /tmp/opencode/sdk/platforms/android-33/android.jar, /tmp/opencode/r8.jar
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="$ROOT/android-app"
BUILD="$ROOT/.apkbuild"
DIST="$ROOT/dist"

AAPT2=${AAPT2:-/usr/lib/android-sdk/build-tools/29.0.3/aapt2}
ZIPALIGN=${ZIPALIGN:-/usr/lib/android-sdk/build-tools/29.0.3/zipalign}
APKSIGNER=${APKSIGNER:-/usr/lib/android-sdk/build-tools/29.0.3/apksigner}
ANDROID_JAR=${ANDROID_JAR:-/tmp/opencode/sdk/platforms/android-33/android.jar}
R8=${R8:-/tmp/opencode/r8.jar}
KS="$ROOT/scripts/debug.keystore"

rm -rf "$BUILD"
mkdir -p "$BUILD/obj" "$BUILD/classes" "$BUILD/dex" "$BUILD/out" "$DIST"

echo "==> icone"
python3 "$ROOT/scripts/gen_icon.py" "$BUILD/ic_launcher.png"
mkdir -p "$APP/res/drawable"
cp "$BUILD/ic_launcher.png" "$APP/res/drawable/ic_launcher.png"

echo "==> aapt2 compile/link"
( cd "$APP/res" && find . -type f -print0 | while IFS= read -r -d '' f; do
  "$AAPT2" compile "$APP/res/${f#./}" -o "$BUILD/obj/"
done )
FLATS=$(find "$BUILD/obj" -name '*.flat')

# monta assets (picker + copia atual da PWA para o modo demo offline)
mkdir -p "$BUILD/pkg"
cp -r "$APP/assets" "$BUILD/pkg/assets"
rm -rf "$BUILD/pkg/assets/companion"
cp -r "$ROOT/companion" "$BUILD/pkg/assets/companion"

"$AAPT2" link -I "$ANDROID_JAR" \
  --manifest "$APP/AndroidManifest.xml" \
  --auto-add-overlay $FLATS \
  -A "$BUILD/pkg/assets" \
  --min-sdk-version 33 --target-sdk-version 33 \
  --version-code "${APK_VERSION_CODE:-2}" --version-name "${APK_VERSION_NAME:-0.2.0}" \
  -o "$BUILD/out/base.apk"

echo "==> javac"
find "$APP/src" -name '*.java' > "$BUILD/sources.txt"
javac -encoding UTF-8 --release 8 -classpath "$ANDROID_JAR" -d "$BUILD/classes" @"$BUILD/sources.txt"

echo "==> d8"
find "$BUILD/classes" -name '*.class' > "$BUILD/classes.txt"
java -cp "$R8" com.android.tools.r8.D8 --min-api 33 --lib "$ANDROID_JAR" \
  --output "$BUILD/dex" $(cat "$BUILD/classes.txt")

echo "==> empacotar dex"
cd "$BUILD/dex" && zip -q9 -X "$BUILD/out/base.apk" classes.dex

echo "==> zipalign + assinar"
"$ZIPALIGN" -f 4 "$BUILD/out/base.apk" "$BUILD/out/aligned.apk"

if [ ! -f "$KS" ]; then
  keytool -genkeypair -v -keystore "$KS" -alias thorxiv -keyalg RSA -keysize 2048 \
    -validity 10000 -storepass android -keypass android -dname "CN=ThorXIV Dev" >/dev/null 2>&1
fi
"$APKSIGNER" sign --ks "$KS" --ks-pass pass:android --key-pass pass:android \
  --v1-signing-enabled true --v2-signing-enabled true --v3-signing-enabled false \
  --out "$DIST/thorxiv-companion-${APK_VERSION_NAME:-0.2.0}.apk" "$BUILD/out/aligned.apk"
"$APKSIGNER" verify --verbose "$DIST/thorxiv-companion-${APK_VERSION_NAME:-0.2.0}.apk" | grep -E "v1|v2|Verifies"

echo "==> verificação"
"$AAPT2" dump badging "$DIST/thorxiv-companion-${APK_VERSION_NAME:-0.2.0}.apk" | grep -E "package|sdkVersion|launchable|application-label" || true
ls -la "$DIST/thorxiv-companion-${APK_VERSION_NAME:-0.2.0}.apk"
echo "OK: APK gerado em dist/thorxiv-companion-${APK_VERSION_NAME:-0.2.0}.apk"
