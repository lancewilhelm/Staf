# Issue tracker: GitHub

Issues and specs live in GitHub Issues for `lancewilhelm/Staf`.
Use the `gh` CLI from this repository.

## Operations

- Create: `gh issue create --title "..." --body-file <file>`
- Read: `gh issue view <number> --json number,title,body,labels,comments`
- List: `gh issue list --state open --json number,title,body,labels`
- Comment: `gh issue comment <number> --body-file <file>`
- Label: `gh issue edit <number> --add-label "<label>"`
- Remove label: `gh issue edit <number> --remove-label "<label>"`
- Close: `gh issue close <number> --comment "..."`

Write multiline bodies to a temporary file and pass `--body-file`.
When publishing to the issue tracker, create a GitHub issue.
When fetching a ticket, read the corresponding GitHub issue.

## Related tickets

Use native GitHub sub-issues and blocking relationships with the installed gh CLI:

- Create a child: `gh issue create --parent <parent> --title "..." --body-file <file>`
- Link an existing child: `gh issue edit <child> --parent <parent>`
- Add a blocker: `gh issue edit <child> --add-blocked-by <blocker>`
- Inspect relationships: `gh issue view <number> --json parent,subIssues,blockedBy`

A ticket can start when every blocking issue is closed. Only if native
relationships are unavailable, link children with `Part of #<parent>` and a task
list in the parent, and record blockers as `Blocked by: #<number>`.

## Pull requests as a triage surface

**PRs as a request surface: no.**

## Wayfinding operations

The active map is [Plan incremental Staf MVP delivery](https://github.com/lancewilhelm/Staf/issues/1).
Plan one milestone far enough to specify and build it while later MVP questions
remain open. Decision tickets contain planning work; product changes belong to
separate implementation issues.

- Create the map with `wayfinder:map`. Create its decision tickets as native
  sub-issues, labelled `wayfinder:grilling`, `wayfinder:prototype`,
  `wayfinder:research`, or `wayfinder:task` according to the required work.
- Use only wayfinder labels on maps and decision tickets. Triage labels such as
  `ready-for-agent` belong to a different workflow.
- Create all issues before wiring native blockers, so references use real IDs.
  The map body indexes resolved decisions. Query its child issues for pending work.
- List children: `gh api repos/lancewilhelm/Staf/issues/<map>/sub_issues`.
- Inspect blockers: `gh api repos/lancewilhelm/Staf/issues/<child>/dependencies/blocked_by`.
  The frontier is open, unassigned children with no open blockers. Inspect the
  assignees, milestone and states returned by these endpoints and follow pagination.
  Read the active planning milestone from the map's Notes. Select its ready
  children before later-MVP work, using parent child order within that milestone.
  Only genuine milestone blockers gate its specification and build; an open
  decision elsewhere on the overall map is not automatically a blocker.
- Claim first: `gh issue edit <child> --add-assignee @me`. Then read the ticket's
  type label and use the matching skill. User decisions require the user.
- Resolve by posting a resolution comment with `--body-file`, closing the child,
  and adding a linked title and short gist to the map's Decisions so far section.
  Reference tickets by linked title rather than bare numbers.
- Work at most one non-research decision per session. A charting session creates
  the map and relationships without resolving a decision. Add newly specified
  questions as the existing decisions reveal them.
