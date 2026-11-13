# Install and recover Staf on native Linux

This path runs the shared instance as a non-root systemd user service. It binds to
`127.0.0.1:3210`. An optional HTTPS gateway gives paired browsers access over a
trusted home network; an SSH tunnel remains available for loopback access and the
CLI. The units, gateway and wrapper are prepared for review. Installation, reboot,
pairing, update, and restore have not been verified on a Linux VM. Issue [#24](https://github.com/lancewilhelm/Staf/issues/24)
remains open until its actual Linux acceptance checks pass.

The steps use `$HOME/.local/share/staf` and `$HOME/.config/staf`. They do not
change Hermes or other services. The owner account needs OpenSSL, a running systemd user
manager, `/usr/bin/node` with Node.js 22.16 or later, Git, and Corepack with
the project-pinned pnpm 12.16.1.
Install prerequisites separately using the host's normal administration method.

## Install the service

1. Sign in to the Linux host as the non-root account that will own the instance.
2. Create the private directories and clone the repository. Stop if `app` already
   exists; do not overwrite an existing installation.

   ```sh
   umask 077
   mkdir -p "$HOME/.local/share/staf/data" "$HOME/.config/staf" "$HOME/.config/systemd/user"
   git clone https://github.com/lancewilhelm/Staf.git "$HOME/.local/share/staf/app"
   cd "$HOME/.local/share/staf/app"
   ```

3. Select the reviewed commit or release to install. Install its locked
   dependencies and build the application.

   ```sh
   git checkout YOUR_REVIEWED_COMMIT
   corepack pnpm install --frozen-lockfile
   corepack pnpm run build
   ```

4. If needed, create `$HOME/.config/staf/instance.env` with provider variables
   in systemd `EnvironmentFile` syntax and restrict it to the owner. Set only
   provider variables; do not override `HOME`, `RUNTIME_DIRECTORY`, or
   `STAF_NATIVE_DATA`. Run `chmod 600 "$HOME/.config/staf/instance.env"`.
   The service does not read the interactive CLI's project `.env`. Environment variables
   and any backups containing credentials require protection. Provider sign-in
   and inference need separate authorization.
5. Copy the unit, reload the user manager, and enable the service.

   ```sh
   cp deploy/native-linux/staf.service "$HOME/.config/systemd/user/staf.service"
   systemctl --user daemon-reload
   systemctl --user enable --now staf.service
   systemctl --user status staf.service
   ```

To start the user service after reboot without an active login, an administrator
must enable lingering for this account. Ask the host administrator to run
`loginctl enable-linger USERNAME`, then verify the setting with
`loginctl show-user USERNAME -p Linger`. Do not assume lingering is enabled.
This step may require administrator authorization. A real reboot check remains
required.

## Enable home-network HTTPS access

The optional gateway listens on one private IPv4 address and forwards only to the
local Staf service. It encrypts traffic but does not replace pairing or the
instance's permissions. Use a stable private address on the Linux host (for
example, a DHCP reservation). Restrict port 3443 to trusted home-network clients
with the host/network firewall; do not forward it from the internet. Any paired
client can control this instance and use permitted host tools. The gateway is not
a general-purpose reverse proxy and does not support a DNS name or IPv6.

1. On the host, set `STAF_LAN_ADDRESS` to its private IPv4 address. Generate an
   owner-only self-signed certificate for that exact address. The command below
   creates a new key: preserve an existing key and certificate rather than
   overwriting them. The browser must trust the certificate on every client.

   ```sh
   STAF_LAN_ADDRESS=192.168.1.20  # replace with this host's private address
   umask 077
   test ! -e "$HOME/.config/staf/lan-key.pem" && test ! -e "$HOME/.config/staf/lan-cert.pem" &&
   openssl req -x509 -newkey rsa:3072 -nodes -days 365 \
     -keyout "$HOME/.config/staf/lan-key.pem" -out "$HOME/.config/staf/lan-cert.pem" \
     -subj "/CN=$STAF_LAN_ADDRESS" -addext "subjectAltName=IP:$STAF_LAN_ADDRESS" \
     -addext "basicConstraints=critical,CA:FALSE" -addext "extendedKeyUsage=serverAuth"
   ```

2. Create `$HOME/.config/staf/lan.env`, substituting your host's actual absolute
   paths and the same address. Do not use shell expansion inside this systemd
   environment file. The port defaults to 3443 and must be 1024–65535.

   ```text
   STAF_LAN_ADDRESS=192.168.1.20
   STAF_LAN_PORT=3443
   STAF_LAN_KEY=/home/USERNAME/.config/staf/lan-key.pem
   STAF_LAN_CERT=/home/USERNAME/.config/staf/lan-cert.pem
   ```

   Run `chmod 600 "$HOME/.config/staf/lan.env" "$HOME/.config/staf/lan-key.pem"`.
   Copy `deploy/native-linux/staf-lan.service` to `~/.config/systemd/user/`,
   then run `systemctl --user daemon-reload` and
   `systemctl --user enable --now staf-lan.service`. Lingering and the base
   service setup above are required for automatic startup after reboot. Inspect
   `systemctl --user status staf-lan.service` and
   `journalctl --user -u staf-lan.service` for startup errors.

3. Transfer **only** `lan-cert.pem` to each trusted client over authenticated
   SSH and install it as a trusted certificate using that client's OS/browser
   procedure. Verify the certificate fingerprint on the host with
   `openssl x509 -in "$HOME/.config/staf/lan-cert.pem" -noout -sha256 -fingerprint`
   and compare before trusting it. Never transfer the private key to clients.
   Visit `https://YOUR_PRIVATE_IP:3443/` without bypassing a TLS warning. A new
   browser origin needs its own pairing code, as described below. If the IP or
   certificate changes, update the config and client trust deliberately.

The gateway checks the exact Host and any browser Origin before forwarding. It
keeps the application's API and database on loopback. An unpaired browser cannot
access owner APIs; a paired browser retains access until revoked. TLS and pairing
do not protect a compromised paired client or host. Stop or disable the optional
gateway with `systemctl --user stop staf-lan.service` or
`systemctl --user disable --now staf-lan.service`. The CLI still requires an SSH
tunnel. ChatGPT sign-in uses a loopback callback: initiate it through the SSH
loopback path on the machine receiving the callback, not through this HTTPS origin.
The gateway has local controlled coverage; it has not been tested on a Linux VM,
actual LAN, browsers' certificate stores, or live services.

## Connect and pair a client

The code grants access to the whole instance. The wrapper captures it in
`$XDG_RUNTIME_DIR/staf/pairing-code`, in a private directory and file, and does not
forward instance stdout or stderr to the journal. It writes lifecycle messages to
the journal. Detailed instance diagnostics are therefore unavailable there.
The file can contain a code that was already used. Rotate before pairing.

1. On the host, follow lifecycle messages in one terminal.

   ```sh
   journalctl --user -u staf.service -f
   ```

2. In another host terminal, request a new code.

   ```sh
   systemctl --user kill --kill-whom=main --signal=SIGUSR1 staf.service
   ```

3. After the journal reports that a code is available, read it on the host.
   Protect the host terminal and do not paste the code into a shared chat.

   ```sh
   cat "$XDG_RUNTIME_DIR/staf/pairing-code"
   ```

4. Use the HTTPS address above from a trusted paired-network client, or on a
   separate trusted client forward its local port through authenticated SSH.
   For the SSH option, keep this terminal open.

   ```sh
   ssh -N -L 3210:127.0.0.1:3210 USERNAME@HOST
   ```

5. Open the HTTPS address above, or `http://127.0.0.1:3210/` through SSH, and enter the code. The code is
   single-use. Rotate it again for another client. The browser stores its token
   in local storage. Other processes on the client may reach the forwarded port.

The CLI accepts a loopback URL too. Its pairing command takes the code as an
argument, which can be visible briefly to local process inspectors. Avoid putting
the literal code in shell history. Use the paired clients view to inspect and
revoke access. These pairing, revocation, and tunnel steps still need verification
against the installed Linux service.

## Operate the service

```sh
systemctl --user status staf.service
journalctl --user -u staf.service --since today
systemctl --user stop staf.service
systemctl --user start staf.service
# If the HTTPS gateway is enabled:
systemctl --user start staf-lan.service
```

Stopping the service interrupts running work. Review interrupted work before an
explicit retry. The wrapper does not emit the application's diagnostics, so the
journal shows lifecycle status rather than application error details.

## Back up before updating

Stop the service and every other process that writes this data before copying it.
The service check below does not detect a separately started instance. The backup
includes the whole data directory, including SQLite sidecar files, and the separate service configuration.
It can contain private conversations, client credentials, provider secrets, and the
HTTPS private key. It includes the complete core revision tree and symlinks.
Store it in an owner-only location outside the installation and protect copies on
other media.

```sh
systemctl --user stop staf-lan.service staf.service
state=$(systemctl --user show staf.service --property=ActiveState --value)
if [ "$state" = inactive ] || [ "$state" = failed ]; then
  umask 077
  if mkdir -p "$HOME/staf-backups" &&
    backup_dir=$(mktemp -d "$HOME/staf-backups/staf-$(date -u +%Y%m%dT%H%M%SZ)-XXXXXXXX"); then
    if tar -C "$HOME" -czf "$backup_dir/staf.tar.gz" .local/share/staf/data .config/staf; then
      printf 'Backup created: %s\n' "$backup_dir/staf.tar.gz"
    else
      printf 'Backup failed; do not use the incomplete archive in %s\n' "$backup_dir" >&2
    fi
  else
    printf 'Backup failed; could not create a unique private directory\n' >&2
  fi
else
  printf 'Backup blocked: service state is %s\n' "$state" >&2
fi
```

Stop the gateway too before backup or replacement. The archive command runs only when the user manager reports `inactive` or `failed`.
Each run creates a new owner-only directory, so simultaneous backups do not
overwrite one another. A full data-directory backup includes the unencrypted named
secret store at `secrets/credentials.sqlite`; protect the archive accordingly.
The store has no implemented secret-use grants. Restoring an old backup can
restore secrets that were deleted later. Review and revoke provider credentials
as needed after recovery. Verify the archive exists and is
readable, then retain it independently of the host. Inspect the archive with
`tar -tzf BACKUP_FILE`. Do not proceed with an update if backup creation or
inspection fails.

For an owner-initiated update, prepare a separate checkout at the reviewed
revision and build it before stopping the service. After the stopped-data backup,
move the old `app` directory to a unique retained name, move the prepared
checkout to `app`. Review the new unit, copy it to the user unit directory if it
changed, and run `systemctl --user daemon-reload`. Start the service and, if enabled, the gateway. Preserve
the data and configuration directories. If the service fails, stop it and restore the prior application and
backup deliberately; never assume an older application can read a migrated
store. A migration can create its own database backup, but it does not replace
this stopped-data backup. No unattended update is configured.

## Restore on a replacement host

Use only a trusted archive. Install the same reviewed application revision and
prerequisites on the replacement host, but leave the service stopped. Confirm
that the destination data and config directories contain no records you need to
keep. Move any existing directories to unique retained names before extracting;
never overwrite the only copy of existing data. From the replacement account's
home directory, extract the archive with `tar -xzf BACKUP_FILE -C "$HOME"`,
run `chmod -R go-rwx "$HOME/.local/share/staf/data" "$HOME/.config/staf"`,
and start the service. Inspect agents, conversations, memory, schedules, settings, task history,
Activity, and client access. This full archive retains paired client authority:
review and revoke clients after restore, including any revoked since the backup. It also copies any connections and secrets stored
in these directories, including the HTTPS key. External secret stores or paths are
not included. Gmail and Slack connections may require reconnecting or renewing
credentials; restore does not establish that either connection is valid. Check
their actual status and reconnect if needed. Avoid running both copies against
the same rotating credentials or schedules. Restore the gateway configuration
only after adjusting its address and certificate for the replacement host. Verify this procedure on a Linux VM and record the result before treating
the backup path as accepted.
