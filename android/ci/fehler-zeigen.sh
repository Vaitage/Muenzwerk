#!/usr/bin/env bash
# Fehler aus Logs/Testergebnissen als Annotation ausgeben – die lassen sich über die API lesen,
# auch wenn die vollständigen Logs nicht erreichbar sind.
out=""
for f in "$@"; do
  if [ -d "$f" ]; then
    out+=$(grep -rh -A12 "<failure" "$f" 2>/dev/null | head -60)$'\n'
  elif [ -f "$f" ]; then
    out+=$(grep -E -B2 -A8 "error:|Error:|FAILED|What went wrong|Exception|AssertionError|FAILURES|expected|Warning:.*\[|Errors? found" "$f" | head -120)$'\n'
  fi
done
[ -z "${out//[$'\n ']/}" ] && out=$(tail -n 60 "$1" 2>/dev/null)
# in Stücke zu je 3500 Zeichen, damit nichts abgeschnitten wird
i=0
while [ -n "$out" ] && [ $i -lt 8 ]; do
  part=${out:0:3500}; out=${out:3500}; i=$((i+1))
  part=${part//'%'/'%25'}; part=${part//$'\r'/}; part=${part//$'\n'/'%0A'}
  echo "::error title=Teil $i::$part"
done
