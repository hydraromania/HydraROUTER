#!/bin/bash
# =============================================================================
# update-router — Auto-update HydraROUTER: commit + versionare + push + build
# =============================================================================
# Rulează manual sau prin PM2 (update-router daemon).
# 
# 1. Verifică modificări locale în /root/hydrarouter
# 2. Dacă sunt modificări: incrementează versiunea, commit, push la GitHub
# 3. Sync cu upstream (9router) - fetch + merge + reaplicare patch-uri
# 4. Build
# 5. Restart HydraROUTER prin pm2
# =============================================================================

set -euo pipefail

APP_DIR="/root/hydrarouter"
DB_DIR="/root/.hydrarouter/db"
LOG_FILE="/root/.hydrarouter/logs/update-router.log"

mkdir -p "$(dirname "$LOG_FILE")"
mkdir -p "$DB_DIR"

log() {
  local ts
  ts=$(date '+%Y-%m-%d %H:%M:%S')
  echo "[$ts] $*" | tee -a "$LOG_FILE"
}

# Funcție pentru incrementare versiune (patch bump: 1.0.0 → 1.0.1)
bump_version() {
  local version
  version=$(jq -r '.version' package.json)
  local major minor patch
  major=$(echo "$version" | cut -d. -f1)
  minor=$(echo "$version" | cut -d. -f2)
  patch=$(echo "$version" | cut -d. -f3)
  patch=$((patch + 1))
  echo "${major}.${minor}.${patch}"
}

cd "$APP_DIR"

log "=== HydraROUTER update check ==="
log "Versiune curentă: $(jq -r '.version' package.json)"

# =============================================
# 1. Verificare modificări locale
# =============================================
if git diff --quiet && git diff --cached --quiet; then
  log "📝 Nici o modificare locală."
  HAS_LOCAL_CHANGES=false
else
  log "📝 Modificări locale detectate!"
  HAS_LOCAL_CHANGES=true
  
  # Generează sumarul modificărilor
  CHANGES_SUMMARY=$(git diff --stat 2>/dev/null | head -20)
  log "Schimbări:"
  echo "$CHANGES_SUMMARY" | while IFS= read -r line; do log "  $line"; done
  
  # Incrementează versiunea
  OLD_VERSION=$(jq -r '.version' package.json)
  NEW_VERSION=$(bump_version)
  jq ".version = \"$NEW_VERSION\"" package.json > package.json.tmp && mv package.json.tmp package.json
  log "⬆️ Versiune: $OLD_VERSION → $NEW_VERSION"
  
  # Commit și push
  git add -A
  git commit -m "v$NEW_VERSION

Actualizări locale:
$(git diff --stat HEAD~1..HEAD 2>/dev/null || git diff --stat 2>/dev/null | head -30)

Auto-commit prin update-router"
  log "📦 Commit creat: v$NEW_VERSION"
  
  git push origin master 2>&1 | tee -a "$LOG_FILE"
  log "🚀 Push la GitHub: v$NEW_VERSION"
fi

# =============================================
# 2. Sync cu upstream (9router) - dacă există
# =============================================
log "🔄 Verific actualizări de la 9router (upstream)..."
if git remote | grep -q upstream; then
  git fetch upstream master 2>&1 | tee -a "$LOG_FILE" || log "⚠️  Fetch upstream eșuat (ignorat)"
  
  BEHIND=$(git rev-list --count HEAD..upstream/master 2>/dev/null || echo "0")
  if [ "$BEHIND" -gt 0 ]; then
    log "⬇️ $BEHIND commit-uri noi de la 9router"
    
    # Backup DB
    log "💾 Backup baza de date..."
    cp "$DB_DIR/data.sqlite" "$DB_DIR/data.sqlite.bak.$(date +%Y%m%d%H%M%S)" 2>/dev/null || true
    ls -t "$DB_DIR"/data.sqlite.bak.* 2>/dev/null | tail -n +4 | xargs -r rm -f
    
    # Merge cu upstream
    git merge upstream/master --no-edit --no-ff 2>&1 | tee -a "$LOG_FILE" || {
      log "⚠️  Conflicte la merge. Încerc rezolvare automată..."
      CONFLICTS=$(git diff --name-only --diff-filter=U)
      for f in $CONFLICTS; do
        if [[ "$f" == patches/* ]] || [[ "$f" == "restore-patches.sh" ]]; then
          log "  Păstrez versiunea HydraROUTER pentru: $f"
          git checkout --ours "$f"
        else
          log "  Păstrez versiunea upstream pentru: $f"
          git checkout --theirs "$f"
        fi
        git add "$f"
      done
      git commit --no-edit 2>&1 | tee -a "$LOG_FILE" || true
    }
    
    # Reaplicare patch-uri
    if [ -f "restore-patches.sh" ]; then
      log "🩹 Reaplic patch-uri HydraROUTER..."
      bash restore-patches.sh 2>&1 | tee -a "$LOG_FILE" || log "⚠️  Patch restore issues"
    fi
    
    # Commit post-merge (dacă e ceva de comitat)
    if [ -n "$(git status --porcelain)" ]; then
      git add -A
      NEW_VER=$(jq -r '.version' package.json)
      git commit -m "sync: upstream merge + patch reapply (v$NEW_VER) [skip ci]" 2>&1 | tee -a "$LOG_FILE" || true
      git push origin master 2>&1 | tee -a "$LOG_FILE"
      log "🚀 Push sync la GitHub"
    fi
  else
    log "✅ HydraROUTER e la zi cu 9router."
  fi
else
  log "⚠️  Remote 'upstream' nu e configurat. Sari peste sync cu 9router."
fi

# =============================================
# 3. Build
# =============================================
log "🔨 Build..."
npm install --prefer-offline 2>&1 | tee -a "$LOG_FILE" || true
if npm run build 2>&1 | tee -a "$LOG_FILE"; then
  log "✅ Build reușit!"
else
  log "❌ Build eșuat. HydraROUTER va rula cu versiunea anterioară."
  pm2 restart hydrarouter 2>&1 | tee -a "$LOG_FILE" || true
  exit 1
fi

# =============================================
# 4. Restart HydraROUTER
# =============================================
log "▶️ Repornesc HydraROUTER..."
pm2 restart hydrarouter 2>&1 | tee -a "$LOG_FILE" || true

# Verificare stare
sleep 3
CURRENT_VER=$(jq -r '.version' package.json)
if pm2 show hydrarouter 2>/dev/null | grep -q "online"; then
  log "✅ HydraROUTER v$CURRENT_VER pornit cu succes!"
  log "   🌐 http://localhost:20128"
else
  log "⚠️  HydraROUTER nu e online. Verifică pm2 logs."
  pm2 logs hydrarouter --lines 10 2>&1 | tee -a "$LOG_FILE"
fi

log "=== Finalizat ==="
