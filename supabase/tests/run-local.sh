#!/usr/bin/env bash
# Lance les tests SQL sur un PostgreSQL local jetable (aucun projet Supabase requis).
# Prérequis : binaires PostgreSQL (initdb, pg_ctl, psql) dans le PATH ou /usr/lib/postgresql/*/bin.
# En CI, PGHOST/PGPORT/PGUSER/PGPASSWORD peuvent pointer vers un service postgres existant.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/../.." && pwd)"

if [[ -z "${PGHOST:-}" ]]; then
  bin="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1 || true)"
  [[ -n "$bin" ]] && export PATH="$bin:$PATH"
  tmp="$(mktemp -d)"
  trap '"${RUN[@]}" "${bin:+$bin/}pg_ctl -D $tmp/data -m immediate stop" >/dev/null 2>&1 || true; rm -rf "$tmp"' EXIT
  if [[ "$(id -u)" == "0" ]]; then chown -R nobody "$tmp" 2>/dev/null || true; RUN=(su nobody -s /bin/bash -c); else RUN=(bash -c); fi
  "${RUN[@]}" "${bin:+$bin/}initdb -D '$tmp/data' -U postgres --auth=trust -E UTF8 --locale=C.UTF-8 >/dev/null"
  "${RUN[@]}" "${bin:+$bin/}pg_ctl -D '$tmp/data' -o '-k $tmp -p 54329 -c listen_addresses=' -l '$tmp/log' start >/dev/null"
  export PGHOST="$tmp" PGPORT=54329 PGUSER=postgres
fi
export PGDATABASE="${PGDATABASE:-postgres}"
psql_run() { psql -v ON_ERROR_STOP=1 -q -X "$@"; }

psql_run -c "drop database if exists immozen_test" >/dev/null 2>&1
psql_run -c "create database immozen_test" >/dev/null
export PGDATABASE=immozen_test

export PGOPTIONS='-c client_min_messages=warning'
psql_run -f "$here/00_supabase_emulation.sql"
psql_run -f "$repo/legacy/idf-invest/supabase.sql"          # schéma IDF Invest d'origine
psql_run -f "$here/01_legacy_seed.sql"
unset PGOPTIONS
for m in "$repo"/supabase/migrations/*.sql; do
  echo "→ migration $(basename "$m")"
  PGOPTIONS='-c client_min_messages=warning' psql_run -f "$m" >/dev/null
done
psql_run -f "$here/10_rls_and_rules.test.sql" 2>&1 | sed -n 's/^.*NOTICE:  //p; /ERROR/p; /ÉCHEC/p; /Tous les tests/p'
psql_run -f "$here/30_lot2.test.sql" 2>&1 | sed -n 's/^.*NOTICE:  //p; /ERROR/p; /ÉCHEC/p; /lot 2 passés/p'
psql_run -f "$here/40_lot3.test.sql" 2>&1 | sed -n 's/^.*NOTICE:  //p; /ERROR/p; /ÉCHEC/p; /lot 3 passés/p'
psql_run -f "$here/50_plateforme.test.sql" 2>&1 | sed -n 's/^.*NOTICE:  //p; /ERROR/p; /ÉCHEC/p; /plateforme passés/p'
psql_run -f "$here/60_loyers.test.sql" 2>&1 | sed -n 's/^.*NOTICE:  //p; /ERROR/p; /ÉCHEC/p; /rappels passés/p'
psql_run -f "$here/70_formules.test.sql" 2>&1 | sed -n 's/^.*NOTICE:  //p; /ERROR/p; /ÉCHEC/p; /formules passés/p'
psql_run -f "$here/80_espace_locataire.test.sql" 2>&1 | sed -n 's/^.*NOTICE:  //p; /ERROR/p; /ÉCHEC/p; /espace locataire passés/p'
psql_run -f "$here/90_corrections.test.sql" 2>&1 | sed -n 's/^.*NOTICE:  //p; /ERROR/p; /ÉCHEC/p; /corrections passés/p'
psql_run -f "$here/95_factures.test.sql" 2>&1 | sed -n 's/^.*NOTICE:  //p; /ERROR/p; /ÉCHEC/p; /factures passés/p'
psql_run -f "$here/96_alertes.test.sql" 2>&1 | sed -n 's/^.*NOTICE:  //p; /ERROR/p; /ÉCHEC/p; /alertes passés/p'

echo "→ annulation (rollback)"
for r in $(ls "$repo"/supabase/rollback/*.down.sql | sort -r); do PGOPTIONS='-c client_min_messages=warning' psql_run -f "$r" >/dev/null; done
psql_run -f "$here/20_rollback.test.sql" 2>&1 | sed -n 's/^.*NOTICE:  //p; /ERROR/p; /Réversibilité/p'

echo "→ ré-application après annulation"
for m in "$repo"/supabase/migrations/*.sql; do PGOPTIONS='-c client_min_messages=warning' psql_run -f "$m" >/dev/null; done
psql_run -tAc "select 'OK   ré-application : ' || count(*) || ' biens' from public.properties"
