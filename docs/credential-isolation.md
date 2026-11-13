# Credential isolation

Agent host execution and file actions remain blocked. On Linux, a separately
configured Docker scratch backend attempts bounded execution without a host
workspace. This backend has not been tested against a Linux daemon or kernel in
this change. The environment filter, same-user file modes, and output redaction
do not establish a boundary.

## Linux scratch backend

The service requires an owner-configured Docker executable, local Unix socket,
and pinned image ID, and the existing separate permissions and exact-command
approval. The owner must trust the daemon, executable, image, host kernel, and
their administrators. Staf does not expose the Docker socket or a host bind to
the command. It requests a private PID, IPC, network and cgroup view, a bounded
tmpfs workspace, read-only root, UID/GID 65534, no capabilities, no new
privileges, and Docker's built-in seccomp profile. It checks the daemon's Linux
and seccomp reports and inspects the resulting container settings before start.
An entry wrapper checks seccomp, no-new-privileges, and zero effective, permitted
and bounding capabilities in `/proc/self/status` before executing the command.
The observed configuration must also disable daemon logging and restart, so
Docker does not retain output in its normal log driver or replay the command.
Any failed or unavailable check blocks execution. This is isolated scratch, not
access to existing host files or an interactive terminal. Previously launched
detached processes and unrelated same-user software remain outside this gate.

Docker's [container security documentation](https://docs.docker.com/engine/security/)
explains the role and limits of namespaces and daemon authority. Docker documents
[`seccomp=builtin`](https://docs.docker.com/reference/cli/docker/container/run/#optional-security-options---security-opt)
as selecting its built-in profile, and the Linux kernel documents
[no-new-privileges](https://docs.kernel.org/userspace-api/no_new_privs.html).
Container and kernel bugs, a malicious daemon or image, and compromised host
administration are outside this protection. Older Docker versions or platforms
that cannot establish the required settings fail closed.

## Host-work candidate (not enabled)

The repository includes an **uninstalled, incomplete candidate**, not a usable
host-work backend. `deploy/native-linux/staf-exec-launch.example` sketches a
fixed launcher for distinct `staf-service` and `staf-exec` accounts and one
operator-approved workspace. `staf-exec-guard.c` checks the in-sandbox identity, capabilities,
no-new-privileges and mount layout; it attempts to apply Landlock ABI 9 and a
seccomp filter before requesting a command. The filter permits only Unix socket
families, so even networking mechanisms outside a network namespace, such as
vsock, must fail. The example starts with no network egress; programs requiring
the network will not work. Linux kernel and user-namespace policy must support
every requested mechanism or the guard must reject the launch. The candidate has
not been run on Linux and is not connected to the service. Do not install the
example or use its readiness message as proof of a secure boundary.

The intended launcher enters a restricted mount and process view, drops
supplementary groups and capabilities, sets `no_new_privs`, and executes under an
identity distinct from the service. Its view
must exclude the instance data directory, credential files, service process
environment and descriptors, control sockets, Docker socket, and any other path
or mechanism that can regain service authority. It must not accept a model-chosen
identity, executable policy, mount, namespace, or privilege configuration.
File actions must execute through the same boundary, rather than opening paths in
the service process. A checked path prefix alone cannot prevent symlink, hardlink,
mount, race, or alternate-path escapes. Shell descendants, background processes,
PTYs and helper work must remain subject to the same restrictions. Ordinary host
work can be exposed only through explicitly safe mounts and permissions.

The operator-facing contract still needs a verified installation, trust, and
recovery implementation. The service must establish the actual effective UID, groups,
capabilities, namespace and filesystem restrictions for each launch, protect
the launcher and configuration against modification by agent work, and fail
closed on any error or unsupported platform. The environment must omit supported
credential variables and avoid inheriting secret-bearing descriptors. Process
inspection, setuid programs, privileged sockets, and access to service APIs must
not restore the lost authority. A separate UID alone is insufficient if a secret
is readable through another path or privileged service.

The launcher example binds `/usr` and the approved workspace recursively.
The guard rejects nested mounts in either tree, but the operator would still
need to ensure that neither tree contains readable credentials, unsafe hard
links, exposed control sockets, or files consumed by a more privileged service.
It is not enough to check a workspace's path or Unix mode bits: ACLs, group
membership, hard links, cooperating processes, and races matter. Existing user
files would need an explicitly safe shared workspace or carefully scoped ACLs.
The execution account must not share the service UID, groups or access to its
credential authority. Root ownership of launcher policy and binaries is a
trust prerequisite, not proof that the full boundary is working.

The service still needs a trusted per-launch handshake and lifecycle handling,
including PTY, job control and descendant termination, plus file operations and
recovery inside the same boundary. Until those pieces and controlled Linux tests exist,
agent host file and native terminal actions remain unavailable on every platform.
See the upstream [bubblewrap security discussion](https://github.com/containers/bubblewrap#security)
and Linux [Landlock documentation](https://docs.kernel.org/userspace-api/landlock.html)
for the underlying primitives and their limits.

Before claiming Linux acceptance, tests must use real disposable Linux processes and
synthetic credentials. They must try direct and transformed reads, environment
inheritance, process inspection, symlink and alternate paths, privilege changes,
socket access, and attempts from pipe, PTY, file, background and helper paths.
They must also prove ordinary permitted work and fail-closed behavior after
configuration or launcher failures. Linux VM and live-account acceptance remain
separate owner-led checks.

`test/linux-host-guard.integration.test.js` provides opt-in checks for a pipe,
an interactive PTY, socket and descriptor isolation, a symlink to a synthetic
private file, environment filtering, and a background descendant. It assumes a
disposable Linux system on which an operator has separately configured the exact
example launcher, `sudo`, a writable shared workspace and `/usr/bin/python3`.
On that system only, set `STAF_TEST_LINUX_WORKSPACE` to the approved host
workspace and run `node --test test/linux-host-guard.integration.test.js`.
The checks are skipped otherwise. Passing them is not sufficient acceptance:
they do not yet cover service dispatch, file actions and recovery, every socket
or privilege bypass, launcher/configuration tampering, or network and process
namespace attacks. No account, sudo policy or privileged service is installed by
these tests.
