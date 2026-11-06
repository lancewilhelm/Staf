# Select a model and reasoning effort

Each shared bot has a provider, model ID, and optional reasoning setting. Edit
these in `/settings` or use the terminal commands below:

```text
/set provider openrouter
/models
/set model PROVIDER/MODEL
/set reasoning high
/settings show
```

Replace the example model and reasoning level with values supported by your
provider and account. `/models` explicitly requests metadata from the selected
provider. The browser loads model metadata automatically in the composer, agent editor,
and provider defaults. It also accepts manual model IDs. A catalog entry does not establish that an account can use that model.
Discovery failure does not prevent manual model entry.

The demo provider does not use a model. Codex uses its separately authorized
Staf grant to discover models and requires an account-available model for
inference. OpenRouter uses its model catalog. LM Studio and the generic live
adapter use the configured compatible endpoint. Explicit nondefault reasoning
support depends on the provider and model. The browser labels `default` as **Automatic**. It leaves the
provider's default in effect; it does not mean reasoning is disabled. LM Studio
and live do not support a nondefault effort through these adapters.

Profile edits affect new requests and are shared with other clients. New bot
creation defaults are separate and do not change existing bots. Changing the
provider may send existing conversation history to the newly selected provider.
See [settings](settings.md) and [provider setup](usage.md#configure-a-provider).
The shared provider integration has synthetic coverage and has not been live
verified.
