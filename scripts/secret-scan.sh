#!/bin/sh
# Refuses commits that contain private keys or API secrets (§15). Runs on the staged diff.
patterns='[1-9A-HJ-NP-Za-km-z]{86,88}|\[([0-9]{1,3}, ?){63}[0-9]{1,3}\]|shpss_[0-9a-f]{8}|shpat_[0-9a-f]{8}|sk-ant-[A-Za-z0-9_-]{8}|gsk_[A-Za-z0-9]{8}|8b8add46|3030020100300706'
hits=$(git diff --cached -U0 --no-color -- . ':(exclude)package-lock.json' ':(exclude)scripts/secret-scan.sh' | grep '^+' | grep -v '^+++' \
  | sed -E 's#/tx/[1-9A-HJ-NP-Za-km-z]{86,88}#/tx/SIG#g' | grep -En "$patterns")
if [ -n "$hits" ]; then
  echo "secret-scan: possible secret in staged changes:" >&2
  echo "$hits" | cut -c1-120 >&2
  exit 1
fi
