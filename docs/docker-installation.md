# Install and recover Staf with Docker Compose

Run these commands from a reviewed checkout on the Docker host with Docker Engine
and Compose v2. Use the explicit project name `staf` consistently: another name
selects another volume. The build downloads pinned pnpm and locked dependencies.
The Node 22 base-image tag is mutable; a later build can select a newer image.

```sh
docker compose -p staf up -d --build
docker compose -p staf ps
docker compose -p staf logs staf
```

Open `http://127.0.0.1:3210/` on the host and enter the single-use pairing code
from the logs. To issue another code, attach on the host and press Enter:

```sh
docker attach "$(docker compose -p staf ps -q staf)"
```

Detach with Ctrl-P followed by Ctrl-Q. Protect the terminal and Docker logs:
an unused code grants access to the whole instance. Every paired client acts
for the same owner and can manage settings, other clients and approvals.

Create a Demo agent for offline checks. OpenRouter keys are saved through global
Settings or the paired CLI; ChatGPT uses an instance-owned grant. Do not copy
another application's credentials. Compose does not forward host provider
environment variables. LM Studio or generic live-provider configuration needs
an explicit, reviewed Compose override. Live sign-in and inference require
separate authorization during acceptance testing.

## Protected access from another machine

Use the same authenticated SSH forwarding path as the
[native installation](native-linux-installation.md#connect-and-pair-a-client).
The host needs an SSH server and the client needs OpenSSH. Establish access and
verify the host key through your normal trusted procedure first. From a trusted
client with this checkout, keep this command running:

```sh
sh deploy/connect.sh USERNAME@HOST
```

The helper forwards only client loopback port 3210 to host loopback port 3210,
exits if the local forward cannot bind, and uses SSH keepalives. Stop a conflicting
local instance yourself before opening the tunnel. Keep Docker's published port
on host loopback. On the client open **exactly** `http://127.0.0.1:3210/` and pair
with a fresh code obtained through the protected host terminal.

A built client checkout can also pair its CLI. Read the code interactively to
keep its literal value out of shell history:

```sh
umask 077
mkdir -p "$HOME/.staf/clients"
read -r pairing_code
node dist/cli.js instance pair http://127.0.0.1:3210 "$HOME/.staf/clients/docker.json" "$pairing_code"
unset pairing_code
node dist/cli.js instance clients http://127.0.0.1:3210 "$HOME/.staf/clients/docker.json"
```

Use a new credential filename for each pairing; `pair` refuses existing files.
The code is briefly visible to local process inspectors. The browser token is
in localStorage; the CLI token is in its private file. Other local processes can
reach the forwarded port. From another paired client, revoke a selected ID with
`node dist/cli.js instance revoke URL CREDENTIAL_FILE CLIENT_ID`. Its next request
must fail; a revoked browser must return to pairing after reload.

SSH protects pairing codes, tokens and chat on the cross-machine segment. Both
endpoints, administrators, the SSH account, browser profile, Docker administrators
and peer containers on the Compose network must be trusted. Docker networking
alone provides no authenticated transport protection. The forwarder listens on
container port 3211 and passes bytes to the loopback service; peers can supply
its accepted Host and Origin headers. Protected APIs still require paired tokens.
The accepted origin is `http://127.0.0.1:3210`. Direct LAN HTTP, arbitrary reverse
proxies, public publishing and mobile access without a loopback tunnel are
outside this path. Separate-machine SSH acceptance remains unverified.

## Durable state

The project-scoped `staf-data` volume contains **all of `/data`**: SQLite, agent
configuration and soul revisions, credentials, provider defaults and database
migration backups. Agent configuration is not all in SQLite. The service runs
as `node`; new volumes initialize an owner-only data directory. Existing volumes
keep their permissions. The recovery helpers support a single-service Compose
project with one named `/data` volume. They reject bind-mounted or nested data
mounts; those installations need a separately reviewed full-directory copy.
Bind mounts must be writable by the image's `node` user. Do not mount the host
Docker socket into Staf.

`docker compose -p staf up -d --force-recreate` retains the named volume. `down`
retains it too; **`down --volumes` deletes it**. Browser appearance, unsent drafts
and client-side credentials are outside this volume. Retain the reviewed source,
Compose overrides and any separate environment files alongside the data backup.

## Back up stopped data

Stop every writer. The helper refuses a volume mounted by a running container,
checks that an existing instance database is present, creates a unique private
backup directory, and checks the archive before publishing `data.tar`. Failed
archives remain named `data.tar.partial`. It does not start or stop Staf for you.
It resolves the checkout's default Compose overrides or your `COMPOSE_FILE`
stack, validates the named data mount, and rejects an installed service using a
different store. Use the same configuration environment as your installation;
for custom `-f` files, supply the equivalent `COMPOSE_FILE` stack. A temporary
read-only inspection container parses the configuration without mounting data
or enabling networking. Inspection errors abort the operation.

```sh
docker compose -p staf stop staf
sh deploy/docker-data.sh backup staf "$HOME/staf-backups"
```

Inspect the printed archive with `tar -tf BACKUP_FILE`. Do not update if creation
or inspection fails. The directory also records the checkout commit and the
stopped service's image ID. A dirty checkout or unrecorded override needs its own
retained copy. Archives contain private chat and possibly client/provider secrets;
keep them private and retain a copy away from the host. Do not start another
writer while copying. After a backup without an update, resume with
`docker compose -p staf start staf`.

## Owner-initiated update

1. Stop Staf and make the full backup above. Retain the current source and
   Compose configuration. Tag the old image before rebuilding, for example
   `docker image tag "$(docker compose -p staf images --quiet staf)" staf-before-update:retained`.
   Use a unique tag for each retained version.
2. Select the reviewed commit with `git checkout YOUR_REVIEWED_COMMIT`, then run
   `docker compose -p staf up -d --build`. Keep the same project and volume.
3. Check logs, profiles, settings and retained chats, and use Demo to verify a
   new response. Inspect existing task history through the API or CLI; the
   deferred Activity UI is not required.

Before supported database migrations, startup creates a private
`/data/instance.sqlite.before-*.sqlite` and prints its path. That file contains
the previous database, not a full snapshot of adjacent configuration or credentials.
Keep the full backup until acceptance. An older image may reject a newer database.
To roll back, stop the updated instance and restore the full backup into a new
empty project using the retained old application/image. Preserve the updated
volume; changing the image does not reverse a migration. Updates are manual.

## Restore into a replacement instance

Use only a trusted archive. On the destination host, install the same reviewed
checkout and prerequisites, then build for a new project. Keep the original
instance stopped while accepting the copy so clients cannot write to two
instances that will diverge.

```sh
docker compose -p staf-restored build
sh deploy/docker-data.sh restore staf-restored /absolute/path/to/data.tar
docker compose -p staf-restored up -d --no-build
docker compose -p staf-restored logs staf
```

The helper refuses running or nonempty destinations and restores ownership for
`node`. Failed extraction can leave partial data; preserve it for diagnosis and
choose another empty project for a retry. It does not delete existing records
or sanitize untrusted archives.

Inspect profiles (including archived agents), configuration revisions, chat,
defaults, approval settings and existing task/Activity records. Valid clients
should still work; revoked clients must remain rejected. An older backup can
resurrect client authorizations or provider grants revoked since that backup.
Inspect/revoke clients or reauthenticate before reconnecting regular clients.
Provider reauthentication is allowed. Replacement-host recovery needs its own
observed check; same-host restore is not evidence for it.

## Verification and reusable acceptance

See [Docker verification](docker-verification.md) for observed checks and gaps.
On a development machine with pinned Node/pnpm, local Chromium, Docker access
and free loopback port 3210, run:

```sh
corepack pnpm run build
STAF_DOCKER_EVIDENCE=/absolute/new/path/docker-results.txt node test/docker/installation.mjs
```

This opt-in script builds the real image using unique disposable Compose projects.
It tests the current browser/CLI pairing and shared Demo chat, invalid tokens,
Host/Origin checks, revocation, container replacement, stopped backup and
empty-volume restore guards. It reconstructs schema 29, upgrades to 30, inspects
the private pre-migration backup, and compares retained data and file hashes.
Cleanup removes only its generated projects, volumes and local images. The
evidence path must not exist. It makes no live-provider requests. The older
`test/browser/docker-smoke.mjs` exercises scratch-shell execution on the retired
Advanced page and does not establish installation acceptance.

For separate-machine acceptance, record host/client OS, Docker/Compose/OpenSSH
versions and revision. Open the tunnel from a second machine; pair browser and
CLI using separate codes; exchange Demo messages; check unauthenticated API
rejection; inspect and revoke each client from another paired client; verify
rejection after reload or a new CLI call. Close the tunnel and confirm new
requests fail. Copy a trusted backup to a replacement Docker host through your
approved secure transport, then repeat the restore/readback checks. Record
commands, results and gaps separately from same-host container checks.

## ChatGPT sign-in limitation

The callback uses the paired browser's accepted loopback origin and port.
Synthetic callback tests do not establish live Docker or SSH sign-in. Coordinate
authorized checks with [remote setup](https://github.com/lancewilhelm/Staf/issues/23).
Do not sign in or issue inference merely to validate these instructions.
