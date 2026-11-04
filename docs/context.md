# Read the context display

Enter `/context` in the shared terminal to inspect the latest available historical
request input count and the number of saved provider messages. `/context help`
explains the command. `/context refresh` also requests model metadata.

The last reported input count describes an earlier request. It is not the current
context occupancy. The next request can include dynamic instructions, memory,
tools, and notices, so its token count and context occupancy are unavailable.
No ciphertext length is converted into a token count. Staf does not compact
conversation history.

Use **History → Start fresh session** in the browser workspace to begin empty
conversation context while preserving the earlier session. Search or inspect
original earlier messages and select explicit references when needed. Starting
a session retains standing instructions and existing memory behavior. Staf does
not create summaries or automatically transfer previous session messages. See
[session behavior](session-workspace.md) and [source selection](usage.md#start-fresh-sessions-and-use-sources).

`/usage` reports observed consumption separately. Cumulative input can include
history sent more than once and is not the size of the next request. See
[usage accounting](usage-accounting.md).
