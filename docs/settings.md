# Configure Staf without a model

Settings edits and inspection are deterministic local operations. They do not
need a model or interpret natural language. Explicit model-discovery commands
can read remote metadata, without sending conversation text or credentials. Use them
before configuring a model or after a provider failure.

## Use the chat menu

Start Staf, then open `/settings` to choose Provider → This session. A fresh
installation starts in offline demo; existing personal defaults are preserved.

```sh
pnpm start
```

```text
/settings
/settings keys
/settings providers
/settings show
/settings set default provider lmstudio
/settings set default model.lmstudio LOADED_MODEL_ID
/settings show
/settings cancel
/quit
```

Replace LOADED_MODEL_ID with an existing model's identifier. Saving the defaults
in this example does not contact LM Studio. Interactive remembered edits also select that provider now; a
later launch without explicit flags selects the saved provider. Use
`pnpm start --provider demo` whenever you want an offline run regardless of defaults.

In an interactive terminal, `/settings` opens a keyboard menu. Use up/down or
j/k to move, Enter/right/l to select, and Escape/left/h to go back. Escape at
the root closes settings. The footer shows the controls; narrow terminals scroll
the choices. Provider, model, reasoning, and endpoint screens ask whether to edit
**this session** or **remember as my default**. Selecting a field for another
provider also selects that provider for the next request.

Back, Escape, and left/h follow the parent hierarchy, not visit history:
settings → scope → provider target → model/reasoning choices → catalog or editor
→ confirmation. Catalog results return directly to model/reasoning choices,
skipping the loading screen. Errors return to the relevant value screen without
reopening a dismissed confirmation. At the root, Back/Escape returns to chat.
Text editors reserve left/right for the cursor and hjkl for ordinary letters.

For normal use, no provider flag is required. **This session** changes the next
request after confirmation; **Remember as my default** persists a personal
choice now and for future launches. Existing flags
remain optional scripting overrides; a session selection overrides them. A
provider missing credentials or a model leaves settings available for recovery.

After confirmed Codex selection, missing/invalid local credentials open a setup
screen. Choose **Sign in with ChatGPT**, authorize in your browser using the printed
URL, and continue to model selection in the same process. The menu also includes
**Codex sign-in / reconnect**. You can skip sign-in and configure a model manually;
credentials are still required to chat. `/auth codex login|status|logout` works
inside chat in every terminal. See [Codex setup](codex-direct.md).

Every edit has a confirmation screen with **Cancel** selected initially. Back
and Escape do not save. In a text field, hjkl are ordinary characters; use arrow
keys, Backspace, and Ctrl-U to edit. Reopening the menu is safe, and unfinished
chat input is restored on return. Ctrl-C or Ctrl-D exits chat and restores terminal
input mode. A setting already applied is not undone by closing the menu.

Model and reasoning discovery is an explicit metadata read. Leaving a loading
screen ignores its eventual result; the read itself may finish under its existing
provider timeout. Manual model entry remains available when discovery fails.
Reasoning choices depend on the provider, selected model, and current transport.

`/settings show` and the other textual commands below remain available in every
terminal. Piped input and `TERM=dumb` use the textual fallback for `/settings`.
`NO_COLOR` disables semantic colors, including when its value is empty. Non-TTY
output is plain text. Labels and selection markers convey meaning without color.
Unknown slash commands are rejected locally rather than sent to the model.

## Choose this-session settings

Between requests, including in resumed conversations, enter the following command.

```text
/settings set session provider demo
```

Use the same form for `model.openrouter`, `model.codex`, `model.lmstudio`,
`model.live`, `endpoint.lmstudio`, or `endpoint.live`. Session overrides take
precedence over launch flags and are not saved as defaults. `/settings reload`
re-reads configuration and clears session overrides before the first completed
turn. It leaves current state intact if reloading fails.

Confirmed edits apply to the next request even with existing history. **This
session** is temporary; **Remember as my default** also saves personal defaults.
Choosing a field for another provider also selects that provider now. A provider
or model change resets reasoning to provider default, shown in confirmation;
select a supported effort afterward. Generic CLI model/reasoning pins are cleared
on a provider switch so they cannot leak to the new provider. Explicit interactive
values take precedence over env/CLI values, with source warnings.

History is preserved and sent to the new destination on the next request. Context
limits, transport and native tool behavior can differ. Explicit reasoning must
pass metadata validation before activation; a failure preserves settings and
history. Credentials, login, server reachability and model availability are not
probed or guaranteed. Their warnings remain visible and request failures leave
settings usable. No generation occurs during a settings change.

On resume, current configuration selects the next provider; the startup warning
identifies the previous provider and explains history transfer. Session-only
settings are not restored automatically. Per-turn identities record successful
requests; older files remain readable without inventing historical attribution.

## Save defaults from a terminal

The terminal recovery commands use the same validated operations as chat.

```sh
pnpm start settings show
pnpm start settings keys
pnpm start settings providers
pnpm start settings path
pnpm start settings set default provider demo
pnpm start settings set default model.openrouter PROVIDER/MODEL
pnpm start settings unset default model.openrouter
```

Terminal commands accept `--data-dir PATH`. They do not support `set session`;
use chat or explicit launch flags instead. `settings help` prints the command menu.
Settings validation does not check model availability or make a network request.
A valid model ID can still be unavailable when you chat.

## Understand precedence and timing

For each field, later entries win:

1. Built-in defaults.
2. Saved defaults in `DATA_DIR/config/settings.json`.
3. The project `.env` file.
4. Shell environment variables, including explicitly empty values.
5. Explicit CLI provider/model flags.
6. Explicit this-session overrides.

There is no environment variable for selecting a provider. The selected provider
controls which model/endpoint variable applies. OpenRouter's API root is fixed;
only LM Studio and legacy live have configurable API roots.

`show` reports effective values with their sources, saved defaults separately,
and setup warnings such as a missing model or key. Credentials are never shown.
A shell variable can therefore explain why a saved model appears ignored. An
empty endpoint value selects its built-in fallback and carries that detail in
the effective view; an empty required model remains missing.

Interactive default edits apply now and are remembered. Terminal default commands
have no active chat and affect future launches only; they do not mutate another
running process. Removing a default also affects future launches only. Reload is
still restricted to before a completed turn, for configuration-file recovery.
The CLI waits for each turn, so edits run between turns. A request retains its
adapter snapshot and cannot be redirected mid-flight.

## Keep credentials separate

Only provider, per-provider model IDs, and LM Studio/legacy API roots are settings.
There are no API-key, OAuth-token, or login fields in settings JSON. Configure keys
through the shell or `.env`, and use `/auth codex login` inside chat for scoped Codex login. Never
paste credentials into slash settings commands; a terminal can retain its own history.

Validation rejects unknown fields, known configured key values, common key
patterns, and credentials in endpoint URLs. It cannot identify every arbitrary
secret disguised as a model ID. Keep configuration values nonsecret. Chat settings
commands and errors are not written into session messages. Defaults and model IDs
are plain text on disk and are not automatically copied to another client.

## Recover a damaged file

Malformed JSON, unknown schema versions, unknown keys, and unsafe paths fail
without overwriting the file. `settings path`, `settings keys`, and `/settings`
remain available even when the configuration cannot load. There is no silent
reset, migration, or automatic backup of a damaged file.

1. Run `pnpm start settings path` to locate the exact file.
2. Inspect it with your editor, or move it aside yourself if you want clean defaults.
3. Use `/settings reload` before a completed turn, or restart Staf.

If `.env` cannot be read, settings commands can still inspect or save nonsecret
defaults. The effective view warns that it excludes the unavailable file, and
chat is blocked until you repair `.env` and reload. Saving defaults does not repair
credentials or a corrupted file. A stale `config/settings.lock` after a crash
requires confirming no settings writer is active before manual removal.

## Storage and verification

The schema is version 1. For example:

```json
{
  "version": 1,
  "defaults": {
    "provider": "demo",
    "model.lmstudio": "local-model"
  }
}
```

Writers lock, reload the latest valid document, write and sync a private temporary
file, then atomically rename it. Failures before replacement retain the old bytes.
This is not a power-loss guarantee. Symlinked settings files or directories are
rejected. The existing selected data directory's permissions are not changed.

`test/settings.test.js` packages offline acceptance checks for persistence,
precedence, validation, failed writes, corruption recovery, menu cancellation,
credential rejection, between-turn switching, and restart/resume. No live model
or real credential setup is part of those checks. Natural-language settings,
agent-specific defaults, network APIs, client sync, and remote settings remain
unimplemented.

## Model and reasoning selectors

`models [refresh]`, `model session|default ID`, `reasoning [refresh]`, and
`reasoning session|default LEVEL` reuse these scopes. Changes through these
shortcuts apply on the next request, including after a completed turn. The CLI
constructs that request's adapter from its current effective settings. See
[model selection](model-selection.md) for metadata sources, provider differences,
unknown support, and cache behavior. Reasoning settings use per-provider keys;
`--reasoning LEVEL` and the documented environment variables participate in the
same precedence. Syntax is checked when saved, and actual advertised model support
is checked before generation. Saving a default remains a personal local override,
not a change to shipped defaults.

## Terminal interaction checks

`test/terminal.test.js` checks plain pipelines and real POSIX pseudo-terminals:
navigation, nested scopes, mocked catalogs, literal text editing, confirmation
and cancellation, repeated opening, error recovery, unfinished input, narrow and
dumb terminals, NO_COLOR, EOF, and raw-mode/lock cleanup. The PTY development test
requires Python 3 and skips Windows; the Staf runtime requires only Node.js.
No live model or real credential is used by these checks.
