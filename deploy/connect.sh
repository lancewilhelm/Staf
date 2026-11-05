#!/bin/sh
# Shared protected client path for native Linux and Docker installations.
set -eu
if [ "$#" -ne 1 ]; then
  printf 'Usage: %s USER@HOST\n' "$0" >&2
  exit 2
fi
case "$1" in ''|-*) printf 'Expected an SSH destination\n' >&2; exit 2 ;; esac
exec ssh -N -T -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=3 \
  -L 127.0.0.1:3210:127.0.0.1:3210 -- "$1"
