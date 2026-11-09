#!/usr/bin/env bash
# Local store for /whats-next. SQLite at ~/.claude/whats-next/store.db.
# Usage:
#   store.sh known <kind>                       -> "key<TAB>version" per stored item
#   store.sh upsert <kind> <key> <version> <url> <title> <summary> [herdr]
#   store.sh resolve <key>                      -> mark handled (hidden until its version changes)
#   store.sh open                               -> open items as TSV: kind key url title summary herdr
#   store.sh prune <kind> <key>...              -> delete the items of <kind> not in the key list
set -euo pipefail
db="$HOME/.claude/whats-next/store.db"
mkdir -p "$(dirname "$db")"
sqlite3 "$db" "create table if not exists items(
  key text primary key, kind text not null, version text not null, url text not null,
  title text not null, summary text not null, herdr text not null default '',
  resolved integer not null default 0, first_seen text not null default (datetime('now')),
  last_seen text not null default (datetime('now')));"

q() { sqlite3 -separator $'\t' "$db" "$@"; }
esc() { printf "%s" "$1" | sed "s/'/''/g"; }

case "$1" in
  known) q "select key, version from items where kind='$(esc "$2")';" ;;
  upsert)
    q "insert into items(key,kind,version,url,title,summary,herdr) values
       ('$(esc "$3")','$(esc "$2")','$(esc "$4")','$(esc "$5")','$(esc "$6")','$(esc "$7")','$(esc "${8:-}")')
       on conflict(key) do update set
         resolved = case when version != excluded.version then 0 else resolved end,
         version=excluded.version, url=excluded.url, title=excluded.title,
         summary=excluded.summary, herdr=excluded.herdr, last_seen=datetime('now');" ;;
  resolve) q "update items set resolved=1 where key='$(esc "$2")';" ;;
  open) q "select kind,key,url,title,summary,herdr from items where resolved=0 order by kind,first_seen;" ;;
  prune)
    kind="$2"; shift 2
    keep=$(printf "'%s'," "${@//\'/\'\'}"); keep="${keep%,}"
    q "delete from items where kind='$(esc "$kind")' and key not in (${keep:-''});" ;;
esac
