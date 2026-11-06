# Keep shared Staf guidance separate from each agent's soul

Accepted during the main-branch review interview on 2026-11-05. Staf ships useful
default operating guidance and offers an inspectable, editable, resettable
instance-wide override in Advanced Settings, while each agent retains its own
soul. This gives agents useful behavior without requiring custom instructions
and lets the owner customize shared behavior in one place.

The owner accepted full replacement of the built-in core through one
authoritative Markdown file shared by Advanced Settings, the CLI, and direct
editing. Saved changes apply to each agent's next accepted message, while
in-flight work retains its captured instructions. Each agent's soul, offered
tool definitions, and runtime context remain separate inputs.

Upgrades preserve a custom override. Without an override, the instance uses the
current built-in core. Reset adopts the latest shipped default. An intentionally
empty override is valid and removes only the shared core guidance.

Prompt text does not grant authority. The service continues to enforce
permissions and execution controls. See the
[workspace review](../decisions.md#simplify-the-agent-workspace-after-the-main-branch-review)
for the accepted interaction and evaluation requirements.
