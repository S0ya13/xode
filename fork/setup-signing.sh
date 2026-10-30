#!/bin/zsh
# One-time: create a self-signed "Xode Local Signing" identity in its own keychain.
# A stable signature lets macOS keep keychain and privacy permissions across Xode updates.
set -euo pipefail

DIR="$HOME/Library/Application Support/xode-signing"
KEYCHAIN="$DIR/xode-signing.keychain-db"
[[ -f "$KEYCHAIN" ]] && { echo "Already set up: $KEYCHAIN"; exit 0; }

mkdir -p "$DIR" && chmod 700 "$DIR"
openssl rand -hex 24 > "$DIR/keychain-password" && chmod 600 "$DIR/keychain-password"
password="$(<"$DIR/keychain-password")"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
openssl req -x509 -newkey rsa:2048 -nodes -days 3650 -subj "/CN=Xode Local Signing" \
  -addext "keyUsage=critical,digitalSignature" -addext "extendedKeyUsage=critical,codeSigning" \
  -keyout "$tmp/key.pem" -out "$tmp/cert.pem" 2>/dev/null
# macOS `security import` only reads the legacy PKCS#12 encryption.
openssl pkcs12 -export -inkey "$tmp/key.pem" -in "$tmp/cert.pem" -passout "pass:$password" \
  -certpbe PBE-SHA1-3DES -keypbe PBE-SHA1-3DES -macalg sha1 -out "$tmp/identity.p12"

security create-keychain -p "$password" "$KEYCHAIN"
security set-keychain-settings "$KEYCHAIN"
security unlock-keychain -p "$password" "$KEYCHAIN"
security import "$tmp/identity.p12" -k "$KEYCHAIN" -P "$password" -T /usr/bin/codesign >/dev/null
security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$password" "$KEYCHAIN" >/dev/null
echo "Created $KEYCHAIN"
