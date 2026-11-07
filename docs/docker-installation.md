# Run Staf with Docker Compose

Run these commands from the repository root on the Docker host. Docker Compose builds the image using the repository lockfile. The build downloads the pinned pnpm version and dependencies. The Node base image uses a mutable tag, so rebuilding later can select a newer Node 22 image.

For OpenRouter, use global Settings or the paired CLI to save a key in the instance credential store after startup. The shared instance ignores `OPENROUTER_API_KEY` from the host environment. Keep the instance data volume private; the stored key is plaintext and Docker administrators can access it.

```sh
docker compose up -d --build
docker compose logs staf
```

Open `http://127.0.0.1:3210` on the Docker host and enter the pairing code printed in the logs. A code works once. For another code, attach to the running service and press Enter.

```sh
docker attach "$(docker compose ps -q staf)"
```

Detach with Ctrl-P followed by Ctrl-Q. Pairing codes appear in the container logs, so anyone who can read those logs can use an unspent code. Restrict Docker access to trusted administrators.

The published port binds to host loopback. The app checks the exact host and origin `http://127.0.0.1:3210`. The internal forwarder listens on container port 3211, and other containers on its Docker network can reach it and supply those headers. Trust those peers and Docker administrators. Do not publish the port to a LAN or the internet. Remote access needs a protected tunnel that preserves the accepted host and origin. A tunnel has not been verified here.

The named `staf-data` volume stores the database and instance data at `/data`. The service runs as the `node` user. Docker initializes a new named volume with the image directory's ownership. A bind mount or restored volume must be writable by that user.

## Back up and restore

Stop the service before copying the volume. The archive can contain chats, client credentials, provider credentials, and other private data. Store it securely and protect it as you would the original data.

```sh
umask 077
docker compose stop staf
docker compose run --rm -T --no-deps --user 0 --entrypoint tar staf -C /data -cf - . > staf-backup.tar
docker compose start staf
```

To restore the archive into a separate Compose project, use the same source checkout and build its image first. The separate project has its own named volume. Do not start both projects on port 3210 at the same time. This command restores into the destination volume and overwrites matching files there; choose a new project with an empty volume.

```sh
docker compose -p staf-restored build
docker compose -p staf-restored run --rm -T --no-deps --user 0 --entrypoint tar staf -C /data -xf - < staf-backup.tar
```

Stop the original service before starting the restored project with `docker compose -p staf-restored up -d`. Verify the restored bots and chats before relying on the copy. A stopped-volume copy and restore were tested locally with historical offline data. Restore to another host and a full upgrade with a schema change have not been verified.

Before an owner-initiated update, make a backup, then update the checkout and run `docker compose up -d --build`. The service creates a database backup before supported schema migrations when applicable. Keep the separate backup until you have verified the updated instance. Reverting code after a migration may require restoring the previous backup.

## Codex sign-in limitation

The shared-instance Codex sign-in flow uses the same loopback origin and published port as the paired browser, including its `/auth/callback` route. Start sign-in from a paired client on the Docker host. The initiating client can check or cancel its attempt, including after refreshing the page. The callback and approval flow have synthetic tests; live Codex sign-in and provider execution through Docker have not been verified. Keep the port on host loopback.
