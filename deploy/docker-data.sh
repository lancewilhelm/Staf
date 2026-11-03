#!/bin/sh
# Stopped-volume backup and empty-volume restore. See docs/docker-installation.md.
set -eu
umask 077

usage() {
  printf 'Usage: %s backup PROJECT BACKUP_DIRECTORY\n       %s restore PROJECT ARCHIVE\n' "$0" "$0" >&2
  exit 2
}
[ "$#" -eq 3 ] || usage
action=$1
project=$2
case "$action" in backup|restore) ;; *) usage ;; esac
case "$project" in ''|*[!a-z0-9_-]*|[-_]*) usage ;; esac
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
compose() { docker compose -f "$root/compose.yaml" -p "$project" "$@"; }
image=$(compose config --images)
docker image inspect "$image" > /dev/null

# Check all running mounts, including containers outside this Compose service.
volume=$(docker volume ls -q --filter "label=com.docker.compose.project=$project" --filter label=com.docker.compose.volume=staf-data)
case "$volume" in *'
'*) printf 'Ambiguous data volume for project %s\n' "$project" >&2; exit 1 ;; esac
if [ -n "$volume" ] && [ -n "$(docker ps -q --filter "volume=$volume")" ]; then
  printf 'Stop every container using project %s data before %s.\n' "$project" "$action" >&2
  exit 1
fi

if [ "$action" = backup ]; then
  [ -n "$volume" ] || { printf 'No existing data volume for project %s\n' "$project" >&2; exit 1; }
  mkdir -p -- "$3"
  destination=$(mktemp -d "$3/staf-$(date -u +%Y%m%dT%H%M%SZ)-XXXXXXXX")
  archive=$destination/data.tar
  # Leave an incomplete file visibly marked if tar or Docker fails.
  compose run --rm -T --no-deps --pull never --user 0 --entrypoint sh staf -eu -c \
    'test -f /data/instance.sqlite; exec tar -C /data -cf - .' > "$archive.partial"
  compose run --rm -T --no-deps --pull never --user 0 --entrypoint tar staf -tf - < "$archive.partial" > /dev/null
  mv -- "$archive.partial" "$archive"
  git -C "$root" rev-parse HEAD > "$destination/checkout-commit.txt"
  compose images --quiet staf > "$destination/image-id.txt"
  printf 'Backup created: %s\n' "$archive"
else
  [ -f "$3" ] && [ -r "$3" ] || { printf 'Archive must be a readable file\n' >&2; exit 1; }
  # Only restore trusted archives; this is not an archive sanitizer.
  compose run --rm -T --no-deps --pull never --user 0 --entrypoint sh staf -eu -c '
    test -z "$(find /data -mindepth 1 -maxdepth 1 -print -quit)" || { echo "Destination data volume must be empty" >&2; exit 1; }
    tar -C /data -xf -
    test -f /data/instance.sqlite
    chown -R node:node /data
    chmod 700 /data
  ' < "$3"
  printf 'Restored project %s. Inspect it before relying on the copy.\n' "$project"
fi
