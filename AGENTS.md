# Working on Staf

This file guides coding agents editing the repository. It is not automatically
loaded into conversations by Staf's runtime or provider adapters.

When changing a provider, authentication flow, configuration option, default or
precedence, CLI command, or supported capability:

- Update the affected usage and technical/reference docs in the same change.
  Start at [README.md](README.md), [usage](docs/usage.md),
  [configuration reference](docs/reference.md), and [architecture](docs/architecture.md).
- Keep examples, `.env.example`, and relevant offline tests aligned with actual
  behavior. Explain material rationale and limitations. Distinguish implemented,
  mocked-tested, live-tested, and proposed behavior.
- Validate commands and local links where safe. Do not authenticate, use real
  credentials, or make live/billable requests solely to validate documentation.
  Report steps that remain unverified.
- Run `pnpm run check` and `pnpm test` for relevant behavior changes. For docs-only
  changes, run the checks needed to verify affected claims and examples.
- In completion reports, name the docs changed or explain why none were affected.

Keep this file short. Link the canonical docs instead of duplicating provider
setup here. [Decision records](docs/decisions.md) capture consequential choices;
[session architecture](docs/session-architecture.md) contains unimplemented design
proposals and must not be presented as current runtime behavior.
