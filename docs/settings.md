# Configure a shared bot

A bot's provider, model, and reasoning are part of its shared profile. A paired
terminal or browser can edit the profile without generating a model response.
Changes apply to new work; an accepted request keeps the profile it captured.
Creation defaults are copied into new bots and do not change existing bots.
The settings menu can edit those defaults. In a plain terminal, use `/defaults`
to inspect them and `/set-default provider|model|reasoning VALUE` to edit them.

## Use the chat menu

Run `staf` and enter `/settings`. In an interactive terminal, the menu offers
provider, model, reasoning, and ChatGPT sign-in. Use the arrow keys or j/k to move,
Enter to select, and Escape to go back. The menu confirms changes before saving.
In a plain terminal, `/settings` prints the current profile.

Use `/settings show` to print the profile in any terminal. `/set provider NAME`,
`/set model ID`, and `/set reasoning LEVEL` update that bot without opening the
menu. A provider change displays the destination and asks you to enter `/confirm-provider` or `/cancel-provider`. The next request may send the conversation history to that provider. Reselecting the current provider does not require confirmation. `/unset model` and `/unset reasoning` restore provider defaults. `/models` explicitly requests the selected provider's model catalog; the
menu can also offer discovered models. `/settings models` is an alias for `/models`, and `/settings reasoning` prints the current profile. You can enter a model ID manually when
discovery fails. Model availability is not guaranteed by a saved profile.

The supported providers are `demo`, `codex`, `openrouter`, `lmstudio`, and
`live`. A live provider needs an explicit model. Demo does not use a model.
Provider, model, and reasoning changes affect future work, including work in an
existing conversation. The next provider may receive the conversation history.

For a one-shot command, use `staf settings show`, `staf settings defaults`,
`staf settings set provider|model|reasoning VALUE`, or `staf settings set-default
provider|model|reasoning VALUE`. For a provider change, add `--confirm-provider-change` to acknowledge that the next request may send conversation history to the new provider. Use `staf settings unset model|reasoning` and `staf settings unset-default model|reasoning` to clear saved values. `/unset-default model|reasoning` clears creation defaults in chat. Add the same trailing `--data-dir PATH` or
`--instance URL --credential FILE` options used for chat.

The terminal also recognizes `show settings`, `set provider to NAME`, `set model
to ID`, and `set reasoning to LEVEL`. These are bounded shortcuts, not general
natural-language configuration. Unknown slash commands are rejected locally.

## Credentials and endpoints

Configure OpenRouter, LM Studio, and live credentials or endpoints in the
instance host environment before starting the instance. An already-running
automatic instance retains its original environment. See the [usage guide](usage.md#start-the-shared-terminal)
for restart instructions and [configuration reference](reference.md#terminal-commands-and-environment)
for supported variables. Never paste a credential into chat or a profile field.

For ChatGPT, use `/auth chatgpt login` or the settings menu's sign-in action. See
[ChatGPT sign-in](codex-direct.md). Sign-in and model requests in the shared
instance have synthetic coverage but have not been live verified.

## Conflicts and recovery

The service checks the profile revision when saving an edit. If another client
changes the bot first, reload the profile and make the edit again. An accepted
request uses its captured profile. A provider failure leaves settings available.
A revoked or missing local client credential for an existing database is not
silently recreated; pair an explicit client to regain access.

The shared terminal reconnects to the persistent main chat after it exits. If a
submission has an uncertain outcome, use `/status ID` before retrying. The terminal checks accepted requests in the background and displays their results when they finish. `/discard
ID` removes a local pending draft and does not cancel work accepted by the
instance. When the bot is busy, the terminal saves the unsent text and offers `/retry ID` or `/discard ID`, including after a restart. The [usage guide](usage.md) describes the shared instance and its limits.
