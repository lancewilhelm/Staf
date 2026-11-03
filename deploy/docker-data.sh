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
compose() { (cd "$root" && docker compose -p "$project" "$@"); }
image=$(compose config --images)
case "$image" in ''|*'
'*) printf 'Recovery requires a single-service Staf Compose project\n' >&2; exit 1 ;; esac
docker image inspect "$image" > /dev/null

configuration=$(mktemp "${TMPDIR:-/tmp}/staf-compose-XXXXXXXX")
trap 'rm -f -- "$configuration"' 0
trap 'exit 1' HUP INT TERM
compose config --format json > "$configuration"
# Parse with the already-built image; the host needs no Node/Python/jq runtime.
# This inspection container has no data mount or network, and receives config on stdin.
volume=$(docker run --rm -i --network none --read-only --entrypoint node "$image" -e '
  const config = JSON.parse(require("node:fs").readFileSync(0, "utf8"));
  if (Object.keys(config.services).length !== 1 || !config.services.staf) throw Error("Recovery requires a single Staf service");
  const mounts = (config.services.staf.volumes || []).filter(mount => mount.target === "/data" || mount.target.startsWith("/data/"));
  if (mounts.length !== 1 || mounts[0].target !== "/data" || mounts[0].type !== "volume") throw Error("Recovery requires one named /data volume; bind and nested mounts are unsupported");
  const name = config.volumes?.[mounts[0].source]?.name;
  if (typeof name !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(name)) throw Error("Invalid named data volume");
  console.log(name);
' < "$configuration")

# Refuse configuration drift when an installed service still mounts a different store.
containers=$(compose ps --all --quiet staf)
for container in $containers; do
  mounts=$(docker inspect --format '{{range .Mounts}}{{.Destination}}|{{.Type}}|{{.Name}}{{println}}{{end}}' "$container")
  found=false
  while IFS='|' read -r destination kind name; do
    case "$destination" in
      /data) [ "$kind:$name" = "volume:$volume" ] || { printf 'Installed service uses a different data store\n' >&2; exit 1; }; found=true ;;
      /data/*) printf 'Installed service has unsupported nested data mounts\n' >&2; exit 1 ;;
    esac
  done <<EOF
$mounts
EOF
  [ "$found" = true ] || { printf 'Installed service has no data volume\n' >&2; exit 1; }
done

# Check all running mounts, including containers outside this Compose service.
running=$(docker ps -q --filter "volume=$volume")
if [ -n "$running" ]; then
  printf 'Stop every container using project %s data before %s.\n' "$project" "$action" >&2
  exit 1
fi

if [ "$action" = backup ]; then
  docker volume inspect "$volume" > /dev/null
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
    contents=$(find /data -mindepth 1 -maxdepth 1 -print -quit)
    test -z "$contents" || { echo "Destination data volume must be empty" >&2; exit 1; }
    tar -C /data -xf -
    test -f /data/instance.sqlite
    chown -R node:node /data
    chmod 700 /data
  ' < "$3"
  printf 'Restored project %s. Inspect it before relying on the copy.\n' "$project"
fi
