#!/usr/bin/env bash
###############################################################################
# AlphaCV: install fail2ban on the EC2 host and point it at the nginx access log.
#
#   sudo ./scripts/system/setup-fail2ban.sh install     install, configure, start
#   sudo ./scripts/system/setup-fail2ban.sh status      what is banned right now
#   sudo ./scripts/system/setup-fail2ban.sh unban IP    let an address back in
#   sudo ./scripts/system/setup-fail2ban.sh uninstall   remove our configuration (fail2ban itself stays)
#
# nginx must write /var/log/alphacv-nginx/access.log (docker-compose.prod.yml mounts that folder): run `./scripts/start.sh prod` first.
###############################################################################
set -Eeuo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/fail2ban"
LOG_DIR=/var/log/alphacv-nginx
die() { echo "error: $*" >&2; exit 1; }
[ "$(id -u)" = 0 ] || die "run as root (sudo)"

case "${1:-}" in
  install)
    command -v iptables >/dev/null 2>&1 || die "iptables not found (install iptables / iptables-nft first)"
    if ! command -v fail2ban-client >/dev/null 2>&1; then
      if command -v apt-get >/dev/null 2>&1; then apt-get update -qq && apt-get install -y -qq fail2ban ipset
      elif command -v dnf >/dev/null 2>&1; then dnf install -y fail2ban ipset || die "fail2ban is not in this distribution's repositories: install it first (Amazon Linux: enable EPEL, or use Ubuntu)"
      else die "no apt-get or dnf: install fail2ban and ipset yourself, then re-run"; fi
    fi
    mkdir -p "$LOG_DIR"; chmod 755 "$LOG_DIR"
    install -m 644 "$HERE"/filter.d/*.conf /etc/fail2ban/filter.d/
    install -m 644 "$HERE"/jail.d/alphacv.local /etc/fail2ban/jail.d/
    cat > /etc/logrotate.d/alphacv-nginx <<'ROTATE'
/var/log/alphacv-nginx/*.log {
    daily
    rotate 7
    compress
    missingok
    notifempty
    copytruncate
}
ROTATE
    # prove every filter works against the real log format before starting
    for f in alphacv-auth alphacv-scan alphacv-flood; do
      fail2ban-regex --print-no-missed /dev/null "/etc/fail2ban/filter.d/$f.conf" >/dev/null || die "filter $f does not load"
    done
    systemctl enable --now fail2ban
    systemctl restart fail2ban
    sleep 2
    fail2ban-client status
    echo "Done. Watch it with:  sudo $0 status     and     sudo tail -f /var/log/fail2ban.log"
    ;;
  status)
    for j in alphacv-auth alphacv-scan alphacv-flood recidive; do fail2ban-client status "$j" 2>/dev/null || echo "$j: not running"; done
    ;;
  unban)
    [ -n "${2:-}" ] || die "usage: $0 unban IP"
    fail2ban-client unban "$2"
    ;;
  uninstall)
    rm -f /etc/fail2ban/jail.d/alphacv.local /etc/fail2ban/filter.d/alphacv-{auth,scan,flood}.conf /etc/logrotate.d/alphacv-nginx
    systemctl restart fail2ban || true
    echo "Removed. (fail2ban itself and $LOG_DIR are left in place.)"
    ;;
  *)
    sed -n '3,12p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
    ;;
esac
