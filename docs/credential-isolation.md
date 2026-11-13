# Credential isolation design (not implemented)

Agent host execution and file actions remain blocked. A future Linux backend
must establish a boundary before enabling them; the current environment filter,
same-user file modes, and output redaction do not establish one.

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
