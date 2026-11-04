# Agent avatar prototype brief

Scope confirmed in the 2026-11-03 design interview and prototype review. The
owner selected rounded shapes and regular polygons together in one gallery.
Avatar selection and image uploads are planned features, not current runtime
behavior.

## Run the comparison

The comparison is captured on branch `prototype/agent-avatars`, in the worktree
`/Users/lancewilhelm/projects/Staf-avatar-prototype`. It uses Staf's existing
workspace CSS and DM Sans font with a synthetic workspace. Node.js 22.16 or
later and the pinned Corepack pnpm version are prerequisites.

From that worktree, run:

```sh
corepack pnpm prototype:avatars
```

The command builds and opens a self-contained HTML file. It needs no server,
provider connection, or credentials. To generate it without opening a browser,
append `--no-open`. You can also open
[the generated comparison](../.prototype/agent-avatars/index.html) directly.

Open Change image to choose from both shape groups, then choose a color
separately. Each agent keeps its own shape choice. Reloading resets agents,
images, chat, and appearance to the synthetic starting state.

## Accepted direction

Each agent has three image choices: Initials, Built-in avatar, or Uploaded image.
The choice is shared across clients and used wherever that agent appears in the
GUI. Optionality belongs to each agent. There is no browser-wide display toggle.

The eventual built-in gallery offers roughly 8–12 original geometric shapes
with eyes across the two selected groups. The current prototype has six shapes.
The owner chooses shape and color separately. Every shape supports the same
curated palette of roughly eight colors, readable in light and dark themes.
Different agents can use the same shape and color. Names remain the primary
identifier.

Characters share one visual style, with different shapes. Grok bots inspire the
appeal, while Staf has its own character designs. The first version uses static
vector graphics with solid colors. This replaces the earlier soft 3D rendering
direction. A vector art tool must be able to recreate each character with a few
basic shapes or short paths. Every character has two solid black circular eyes,
placed symmetrically. Eyes have no pupils or whites.

Use solid fills without gradients, textures, blur, lighting effects, or rendered
3D assets. Use one solid fill for the body and two black circles for the eyes.
The existing eight colors are retained.

Images replace the existing initial badges in the expanded sidebar, Focus rail,
chat header, and agent messages. Selecting Initials restores the current badge.
Agent names and duplicate-name suffixes keep their existing behavior.

New agents start with initials. An optional Change image control opens the
chooser during creation and later in agent Settings. Creation stays compact
until the owner opens the chooser. Uploads include a square crop preview with
repositioning and zoom before saving, plus a preview at the small badge size.

Browsing shapes, colors, or crops updates a preview. The existing Create agent
or Save changes action persists the selection with the rest of the form.
Cancel preserves the previous saved choice.

Include rounded shapes and regular polygons together in the existing Staf UI.
Preview the existing 24, 28, and 30 px badge sizes.

## Current UI context

These observations come from a static read of local code, not a browser session.

- [Agent navigation](../web/components/AgentSidebar.vue) uses the first letter
  of each agent's name. The Focus rail retains those markers.
- [The app header](../web/App.vue) includes the selected agent's marker and
  opens agent settings from chat.
- [Agent messages](../web/components/ChatView.vue) include an initial marker.
- [New agent](../web/components/NewAgent.vue) and
  [agent settings](../web/components/AgentSettings.vue) currently have no image
  selector.
- [Appearance decisions](decisions.md#approved-chat-workspace-appearance) assign
  appearance and layout preferences to each browser. The selected image is a
  proposed addition to shared agent identity.

## Prototype verdict

The owner chose both rounded shapes and faceted polygons from the original
comparison. Keep them together in one gallery with the same eyes and palette.
Loops and arches are excluded from the selected gallery.

- Rounded shapes include a circle, rounded square, and capsule.
- Regular polygons include an equilateral triangle, regular pentagon, and
  regular hexagon. Each polygon has equal sides and equal angles, with a vertex
  at the top and a vertical axis of symmetry.

Generate polygon vertices at equal angular intervals on a circle. This keeps
the sides and angles equal without hand-adjusted points. Each built-in image
stores its own shape group, shape, and color in the prototype's agent model.

Use editable SVG composed of basic shapes and short paths. Keep the primary
color independently replaceable. Avoid embedded raster images. Prioritize clear
silhouettes and visible eyes over small decorative details.

Host the gallery inside the approved Staf workspace. Preserve its layout,
typography, palette, and interactions. The floating prototype bar retains the
theme control and saved/draft selection state. Choosing a shape for one agent
leaves other agents' images unchanged.

## Review journey

The prototype must make these comparisons possible with synthetic agents and
in-memory state.

1. Review rounded shapes and polygons in the expanded sidebar, Focus rail,
   chat header, and agent messages. Include actual 24, 28, and 30 px sizes and a
   larger preview.
2. Choose a rounded shape for one agent and a polygon for another. Check that
   both retain their choices. Choose colors independently from the same palette.
3. Compare light and dark themes and a narrow viewport. Check eye visibility,
   silhouette recognition, name readability, and the existing duplicate suffix.
4. Open Change image from New agent and agent Settings. Compare Initials,
   Built-in avatar, and Uploaded image in the same chooser.
5. Preview an uploaded image, reposition it, and zoom its square crop. Confirm
   that the resulting image uses the same badge space as the other modes.
6. Preview changes and cancel them. Then confirm a selection with the form's
   Create agent or Save changes action. Reproduce the intended result locally
   without writing to a real instance.

The prototype demonstrates shared identity through one in-memory agent model
used across these views. It does not prove cross-client persistence or production
upload support.

## Delivery and verdict

Inspect and preserve unrelated working-tree changes before building. Keep the
prototype on a dedicated prototype branch and provide one project task-runner
command to launch it. Use the existing synthetic setup where practical.

Hand back the launch command, comparison URL, and the review journey above.
Capture the complete comparison and the owner's chosen gallery on the prototype
branch. Reference that source from the eventual implementation issue.

The original three-family comparison is retained in commit `58455f9`. The
selected combination and revised geometry are captured in the subsequent
prototype revision. Production implementation follows separately.
