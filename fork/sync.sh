#!/bin/zsh
# Merge upstream main into the fork, rebuild "T3 Code (Fork)" and install it into /Applications.
# Runs from launchd every 3h (fork/com.s0ya13.t3code-fork.sync.plist); run by hand to sync now.
# --force rebuilds even when upstream has nothing new.
set -euo pipefail
export PATH="/opt/homebrew/bin:$HOME/.cargo/bin:/usr/bin:/bin:/usr/sbin:/sbin"
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0

REPO="${0:A:h:h}"
APP_NAME="T3 Code (Fork).app"
APP="/Applications/$APP_NAME"
STAGED="$HOME/Library/Caches/t3code-fork/$APP_NAME"
cd "$REPO"

log() { echo "$(date '+%F %T') $1"; }
notify() {
  log "$1"
  osascript -e "display notification \"$1\" with title \"T3 Code Fork\"" >/dev/null 2>&1 || true
}

# Replacing the bundle under a running Electron app crashes its helper processes, so wait until it quits.
apply_staged() {
  [[ -d "$STAGED" ]] || return 0
  if pgrep -f 'T3 Code \(Fork\)\.app/Contents/MacOS/' >/dev/null; then
    notify "Update ready: quit T3 Code (Fork) and run fork/sync.sh, or wait for the next sync"
    return 0
  fi
  rm -rf "$APP"
  mv "$STAGED" "$APP"
  notify "Installed $(defaults read "$APP/Contents/Info.plist" CFBundleShortVersionString)"
}

LOCK="$REPO/.git/fork-sync.lock"
mkdir "$LOCK" 2>/dev/null || { log "Another sync is running"; exit 0; }
trap 'rmdir "$LOCK"' EXIT

apply_staged

[[ "$(git branch --show-current)" == main ]] || { notify "Sync skipped: repo is not on main"; exit 0; }
[[ -z "$(git status --porcelain)" ]] || { notify "Sync skipped: uncommitted changes in $REPO"; exit 0; }

git fetch -q upstream main
if git merge-base --is-ancestor upstream/main HEAD && [[ "${1:-}" != --force ]]; then
  log "Up to date with upstream"
  exit 0
fi

before="$(git rev-parse HEAD)"
if ! git merge -q --no-edit upstream/main; then
  git merge --abort
  notify "Merge conflict with upstream: resolve it in $REPO"
  exit 1
fi

# The merge is local and unpushed, so dropping it on failure loses nothing.
fail() {
  git reset -q --hard "$before"
  notify "$1, kept the previous version (log: ~/Library/Logs/t3code-fork-sync.log)"
  exit 1
}

corepack pnpm install --frozen-lockfile || fail "pnpm install failed"
corepack pnpm typecheck || fail "Typecheck failed"

version="$(node -p 'require("./apps/desktop/package.json").version')-fork.$(git rev-list --count HEAD)"
rm -rf release
# No update repository: the build ships without an update feed, so the in-app updater stays off.
env -u GITHUB_REPOSITORY -u T3CODE_DESKTOP_UPDATE_REPOSITORY \
  corepack pnpm dist:desktop:dmg:arm64 --build-version "$version" || fail "Build failed"

dmgs=(release/*.dmg)
mnt="$(mktemp -d)"
hdiutil attach -quiet -nobrowse -readonly -mountpoint "$mnt" "${dmgs[1]}"
rm -rf "$STAGED"
mkdir -p "${STAGED:h}"
ditto "$mnt/$APP_NAME" "$STAGED"
hdiutil detach -quiet "$mnt"

git push -q origin main || notify "Built $version, but git push to origin failed"
apply_staged
