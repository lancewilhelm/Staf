# Read the context display

Enter `/context` in the shared terminal to inspect the latest available historical
request input count and the number of saved provider messages. `/context help`
explains the command. `/context refresh` also requests model metadata.

The last reported input count describes an earlier request. It is not the current
context occupancy. The next request can include dynamic instructions, memory,
tools, and notices, so its token count and context occupancy are unavailable.
No ciphertext length is converted into a token count. Staf does not compact
conversation history.

`/usage` reports observed consumption separately. Cumulative input can include
history sent more than once and is not the size of the next request. See
[usage accounting](usage-accounting.md).
