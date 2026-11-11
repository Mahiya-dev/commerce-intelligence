#!/usr/bin/env bash
# -----------------------------------------------------------------------------
# deploy.sh — dijalankan DI SERVER cPanel (Terminal / SSH), di folder aplikasi
# yang merupakan git clone branch `release` (dibuat otomatis oleh GitHub Actions).
#
#   ./deploy.sh               deploy versi terbaru dari branch release
#   ./deploy.sh --status      versi terpasang vs versi terbaru, tanpa mengubah apa pun
#   ./deploy.sh --rollback    kembali ke versi sebelum deploy terakhir (KODE saja)
#
# Opsi:  --yes          tanpa konfirmasi
#        --skip-backup  lewati dump database sebelum migrasi (tidak disarankan)
#
# Urutan deploy: fetch → konfirmasi → backup DB → pasang kode → migrasi → restart
# → health check. Bila migrasi gagal, kode otomatis dikembalikan ke versi lama.
#
# Kebutuhan di server:
#   - .env di folder ini (chmod 600) berisi DB_*, APP_URL — dibaca app, CLI & skrip ini
#   - ~/.my.cnf (chmod 600) berisi [client] user=… password=… untuk mysqldump
#   - Node dari "Setup Node.js App" (dideteksi otomatis di ~/nodevenv, atau set NODE_BIN)
# -----------------------------------------------------------------------------
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STATE_DIR="$APP_DIR/.deploy"
BACKUP_DIR="${BACKUP_DIR:-$HOME/backups}"
BRANCH="${DEPLOY_BRANCH:-release}"

say() { printf '\033[1m→ %s\033[0m\n' "$*"; }
ok() { printf '\033[32m✓ %s\033[0m\n' "$*"; }
warn() { printf '\033[33m! %s\033[0m\n' "$*" >&2; }
die() {
  printf '\033[31m✗ %s\033[0m\n' "$*" >&2
  exit 1
}

env_value() { # baca KEY=nilai dari .env (tanpa mengeksekusi file)
  [ -f "$APP_DIR/.env" ] || return 0
  sed -n "s/^[[:space:]]*$1[[:space:]]*=[[:space:]]*//p" "$APP_DIR/.env" | tail -n1 |
    sed -e 's/[[:space:]]*$//' -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'$/\1/"
}

find_node() {
  if [ -n "${NODE_BIN:-}" ]; then
    echo "$NODE_BIN"
    return
  fi
  local rel="${APP_DIR#"$HOME"/}" candidate
  candidate="$(ls -d "$HOME/nodevenv/$rel"/*/bin/node 2>/dev/null | sort -V | tail -n1 || true)"
  if [ -n "$candidate" ]; then
    echo "$candidate"
  elif command -v node >/dev/null 2>&1; then
    command -v node
  else
    die "Node.js tidak ditemukan. Buat aplikasi di 'Setup Node.js App' dulu, atau set NODE_BIN=/path/ke/node"
  fi
}

source_info() { # isi SOURCE_COMMIT pada revisi tertentu
  git -C "$APP_DIR" show "$1:SOURCE_COMMIT" 2>/dev/null | head -n1 || echo "(tidak diketahui)"
}

restart_app() {
  mkdir -p "$APP_DIR/tmp"
  touch "$APP_DIR/tmp/restart.txt"
  ok "Restart diminta (tmp/restart.txt)"
}

health_check() {
  local url
  url="$(env_value APP_URL)"
  if [ -z "$url" ]; then
    warn "APP_URL tidak ada di .env — health check dilewati. Cek manual: https://<subdomain>/api/health"
    return 0
  fi
  url="${url%/}/api/health"
  say "Health check $url"
  local i body=""
  for i in $(seq 1 10); do
    body="$(curl -fsS --max-time 15 "$url" 2>/dev/null || true)"
    if printf '%s' "$body" | grep -q '"status":"ok"'; then
      ok "Aplikasi sehat: $body"
      return 0
    fi
    sleep 3
  done
  warn "Health check gagal setelah 10 percobaan. Respons terakhir: ${body:-(kosong)}"
  return 1
}

backup_db() {
  local db dump file
  db="$(env_value DB_NAME)"
  db="${db:-${DB_NAME:-}}"
  [ -n "$db" ] || die "DB_NAME tidak ditemukan di .env. Isi .env, atau jalankan dengan --skip-backup (tidak disarankan)."
  [ -f "$HOME/.my.cnf" ] || die "~/.my.cnf belum ada (lihat docs/deployment.md §5), atau jalankan dengan --skip-backup."
  dump="$(command -v mysqldump || command -v mariadb-dump || true)"
  [ -n "$dump" ] || die "mysqldump/mariadb-dump tidak tersedia di server."
  mkdir -p "$BACKUP_DIR"
  chmod 700 "$BACKUP_DIR"
  file="$BACKUP_DIR/uci_predeploy_$(date +%Y%m%d-%H%M%S).sql.gz"
  say "Backup database $db → $file"
  "$dump" --single-transaction --no-tablespaces --routines "$db" | gzip >"$file"
  [ -s "$file" ] || die "File backup kosong — deploy dibatalkan."
  ok "Backup selesai ($(du -h "$file" | cut -f1))"
}

cmd_status() {
  git -C "$APP_DIR" fetch -q origin "$BRANCH"
  echo "Terpasang : $(git -C "$APP_DIR" rev-parse --short HEAD)  sumber $(source_info HEAD)"
  echo "Terbaru   : $(git -C "$APP_DIR" rev-parse --short FETCH_HEAD)  sumber $(source_info FETCH_HEAD)"
  if [ -f "$STATE_DIR/previous" ]; then
    echo "Rollback ke: $(cut -c1-7 "$STATE_DIR/previous")  sumber $(source_info "$(cat "$STATE_DIR/previous")")"
  fi
}

cmd_deploy() {
  local yes="$1" skip_backup="$2" current target node
  say "Mengambil branch $BRANCH dari GitHub"
  git -C "$APP_DIR" fetch -q origin "$BRANCH"
  current="$(git -C "$APP_DIR" rev-parse HEAD)"
  target="$(git -C "$APP_DIR" rev-parse FETCH_HEAD)"

  if [ "$current" = "$target" ]; then
    ok "Sudah versi terbaru ($(source_info HEAD)). Tidak ada yang di-deploy."
    return 0
  fi

  echo "  Sekarang : $(source_info "$current")"
  echo "  Baru     : $(source_info "$target")"
  if [ "$yes" != 1 ]; then
    read -r -p "Lanjutkan deploy? [y/N] " answer
    [[ "$answer" =~ ^[yY]$ ]] || die "Dibatalkan."
  fi

  node="$(find_node)"
  ok "Node: $node ($("$node" -v))"

  if [ "$skip_backup" = 1 ]; then warn "Backup database DILEWATI"; else backup_db; fi

  say "Memasang kode baru"
  git -C "$APP_DIR" reset -q --hard "$target"

  say "Migrasi database"
  if ! (cd "$APP_DIR" && "$node" cli/migrate.cjs); then
    warn "Migrasi GAGAL — mengembalikan kode ke versi sebelumnya"
    git -C "$APP_DIR" reset -q --hard "$current"
    restart_app
    die "Deploy dibatalkan. Aplikasi tetap di versi lama. Database: lihat docs/deployment.md §6 (Migrasi gagal)."
  fi

  # Baru dicatat setelah migrasi sukses, agar --rollback menunjuk versi yang benar.
  echo "$current" >"$STATE_DIR/previous"
  restart_app
  echo "$(date '+%F %T') deploy $(git -C "$APP_DIR" rev-parse --short HEAD) $(source_info HEAD)" >>"$STATE_DIR/history.log"
  if health_check; then
    ok "Deploy selesai."
  else
    die "Deploy terpasang tetapi aplikasi tidak sehat. Cek log, atau kembalikan dengan: ./deploy.sh --rollback"
  fi
}

cmd_rollback() {
  local yes="$1" previous
  [ -f "$STATE_DIR/previous" ] || die "Belum ada catatan versi sebelumnya."
  previous="$(cat "$STATE_DIR/previous")"
  echo "  Sekarang : $(source_info HEAD)"
  echo "  Kembali ke: $(source_info "$previous")"
  warn "Rollback hanya mengembalikan KODE. Migrasi database yang sudah jalan tidak dibatalkan."
  if [ "$yes" != 1 ]; then
    read -r -p "Lanjutkan rollback? [y/N] " answer
    [[ "$answer" =~ ^[yY]$ ]] || die "Dibatalkan."
  fi
  git -C "$APP_DIR" rev-parse HEAD >"$STATE_DIR/previous"
  git -C "$APP_DIR" reset -q --hard "$previous"
  restart_app
  echo "$(date '+%F %T') rollback $(git -C "$APP_DIR" rev-parse --short HEAD) $(source_info HEAD)" >>"$STATE_DIR/history.log"
  health_check || die "Aplikasi belum sehat setelah rollback — cek log aplikasi."
  ok "Rollback selesai."
}

main() {
  local mode=deploy yes=0 skip_backup=0
  for arg in "$@"; do
    case "$arg" in
      --status) mode=status ;;
      --rollback) mode=rollback ;;
      --yes | -y) yes=1 ;;
      --skip-backup) skip_backup=1 ;;
      -h | --help)
        sed -n '2,22p' "${BASH_SOURCE[0]}"
        return 0
        ;;
      *) die "Opsi tidak dikenal: $arg (lihat --help)" ;;
    esac
  done

  git -C "$APP_DIR" rev-parse --git-dir >/dev/null 2>&1 || die "$APP_DIR bukan git clone branch $BRANCH (lihat docs/deployment.md §3)."
  mkdir -p "$STATE_DIR"
  [ -f "$APP_DIR/.env" ] && [ "$(stat -c %a "$APP_DIR/.env")" != 600 ] && warn ".env sebaiknya chmod 600"

  # Cegah dua deploy berjalan bersamaan.
  mkdir "$STATE_DIR/lock" 2>/dev/null || die "Deploy lain sedang berjalan (hapus $STATE_DIR/lock bila yakin tidak)."
  trap 'rmdir "$STATE_DIR/lock" 2>/dev/null || true' EXIT

  case "$mode" in
    status) cmd_status ;;
    rollback) cmd_rollback "$yes" ;;
    deploy) cmd_deploy "$yes" "$skip_backup" ;;
  esac
}

# Seluruh skrip diparse dulu sebelum main() jalan, sehingga aman walau
# `git reset` menimpa file ini sendiri di tengah deploy.
main "$@"
exit
