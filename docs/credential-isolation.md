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

## Remaining host-work design

A candidate is a dedicated unprivileged execution identity and a privileged,
small launcher configured by the operator. The launcher would enter a restricted
mount and process view, drop supplementary groups and capabilities, set
`no_new_privs`, and execute under an identity distinct from the service. Its view
must exclude the instance data directory, credential files, service process
environment and descriptors, control sockets, Docker socket, and any other path
or mechanism that can regain service authority. It must not accept a model-chosen
identity, executable policy, mount, namespace, or privilege configuration.
File actions must execute through the same boundary, rather than opening paths in
the service process. A checked path prefix alone cannot prevent symlink, hardlink,
mount, race, or alternate-path escapes. Shell descendants, background processes,
PTYs and helper work must remain subject to the same restrictions. Ordinary host
work can be exposed only through explicitly safe mounts and permissions.

The operator-facing contract still needs a concrete installation, trust, and
recovery design. The service must establish the actual effective UID, groups,
capabilities, namespace and filesystem restrictions for each launch, protect
the launcher and configuration against modification by agent work, and fail
closed on any error or unsupported platform. The environment must omit supported
credential variables and avoid inheriting secret-bearing descriptors. Process
inspection, setuid programs, privileged sockets, and access to service APIs must
not restore the lost authority. A separate UID alone is insufficient if a secret
is readable through another path or privileged service.

Before enabling the backend, tests must use real disposable Linux processes and
synthetic credentials. They must try direct and transformed reads, environment
inheritance, process inspection, symlink and alternate paths, privilege changes,
socket access, and attempts from pipe, PTY, file, background and helper paths.
They must also prove ordinary permitted work and fail-closed behavior after
configuration or launcher failures. Linux VM and live-account acceptance remain
separate owner-led checks.
