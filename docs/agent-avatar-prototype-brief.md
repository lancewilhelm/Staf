# Agent avatar prototype brief

Scope confirmed in the 2026-11-03 design interview. Use this brief with
`/prototype` to compare three visual families in the existing Staf UI. Avatar
selection and image uploads are planned features, not current runtime behavior.

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

Use A, B, or C in the floating bar, or the left and right arrow keys. Arrow keys
retain their normal behavior inside text inputs and crop sliders. The file URL
retains the `variant` choice. Reloading resets agents, images, chat, and appearance
to the synthetic starting state.

## Accepted direction

Each agent has three image choices: Initials, Built-in avatar, or Uploaded image.
The choice is shared across clients and used wherever that agent appears in the
GUI. Optionality belongs to each agent. There is no browser-wide display toggle.

The built-in gallery offers roughly 8–12 original geometric shapes with eyes.
The owner chooses shape and color separately. Every shape supports the same
curated palette of roughly eight colors, readable in light and dark themes.
Different agents can use the same shape and color. Names remain the primary
identifier.

Characters share one visual style, with different shapes. Grok bots inspire the
appeal, while Staf has its own character designs. The first version uses static
vector graphics with solid colors. This replaces the earlier soft 3D rendering
direction. A vector art tool must be able to recreate each character with a few
basic shapes or short paths. Eyes are simple circles or ovals.

Use solid fills without gradients, textures, blur, lighting effects, or rendered
3D assets. Any suggestion of depth comes from a small number of flat geometric
faces. The selected gallery uses one family from the comparison below.

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

Compare three visual directions in the existing Staf UI. Each direction is an
alternative for the gallery's shared style. Select one direction for the final
family. Include the existing 24, 28, and 30 px badge sizes.

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

## Prototype comparison

The question is which simple vector family gives Staf a friendly, distinct
identity while remaining readable at 24 px. Compare the following alternatives.
Each is a simplified vector interpretation of the previously discussed family.

- A, Rounded shapes: circles, rounded squares, and capsules. Use a solid body
  color and simple eyes. This replaces the shaded clay treatment.
- B, Loops and arches: rings, arches, and broad S-curves. Use solid filled
  silhouettes with open spaces and the same eye treatment across the family.
  This replaces the highlighted inflated treatment.
- C, Faceted polygons: triangles, pentagons, and irregular polygons with softened
  corners. A few solid filled faces can suggest geometry. Keep the eyes simple.

Give each direction at least three representative shapes. Use the same palette
and sample agents across directions so the comparison tests the character
family. The eventual gallery has roughly 8–12 shapes in the selected family.

Use editable SVG composed of basic shapes and short paths. Keep the primary
color independently replaceable. Avoid embedded raster images. Prioritize clear
silhouettes and visible eyes over small decorative details.

Host the comparison inside the approved Staf workspace. Preserve its layout,
typography, palette, and interactions. Switch families through a development-only
floating bar and a shareable `?variant=A`, `B`, or `C` query parameter. Keep the
agent, selected color, and workspace state consistent while switching families.

## Review journey

The prototype must make these comparisons possible with synthetic agents and
in-memory state.

1. Compare A, B, and C in the expanded sidebar, Focus rail, chat header, and
   agent messages. Include actual 24, 28, and 30 px sizes and a larger preview.
2. Choose different shapes and colors independently. Check the whole palette
   on more than one shape in each family.
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
Capture the complete comparison and the owner's chosen family on the prototype
branch. Reference that source from the eventual implementation issue.

The owner selects the final family after viewing the prototype. The verdict is
pending that review. Judge it by
small-size readability, original character, ease of vector editing, and fit with
Staf's existing appearance. Production implementation follows separately.
