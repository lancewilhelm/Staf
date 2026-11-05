# Project folders and agent self-improvement

The owner accepted this direction during the selectable-tool-modes interview,
then deferred implementation to keep the first release focused on basic tools.
These are future requirements, not current runtime behavior or dependencies of
the basic-tool release.

## Project folders

Keep the agent's existing directory in place. Add a stable project area for new
folders, and allow existing folders to be attached by location without moving or
copying their contents. Working files must stay outside revisioned configuration
so publishing agent settings does not replace their location. A working folder
is a starting location, not a restriction on the service account's file access.

The first basic-tool release needs only a stable working folder for terminal
commands and relative file paths. Project management and attachment interfaces
can follow later.

## Reusable code and skills

Allow an agent to write and test scripts, then create or revise saved skills
that explain when and how to reuse them. The owner considers this ordinary skill
practice. Before specifying that implementation, investigate current first-party
Agent Skills, Codex, Claude Code, and Hermes conventions for discovery, script
references, creation, revision, and activation. Compare the actual conventions
instead of assuming all harnesses behave the same way.

Staf's existing model interface selects saved skills. Authoring files is not
currently equivalent to importing or updating the shared skill catalog. Future
skill management needs an explicit supported path and should retain the same
permissions, approvals, and revision records as other actions.

## Changes to Staf itself

An agent can work on a Staf checkout as a development project, run tests, and
prepare a reviewable change. The owner reviews and merges the change before the
running service adopts the new version. Designing automatic server updates,
plugin loading, or autonomous self-modification is outside the basic-tool release.

## Rejected workspace delivery

The owner rejected [PR #72](https://github.com/lancewilhelm/Staf/pull/72) and plans
to build sessions, documents, and artifacts again later. Preserve that work as
historical evidence without treating its implementation or contracts as accepted
requirements for the new effort. The basic-tool release does not wait for or
import that PR.
