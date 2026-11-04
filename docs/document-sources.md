# Document sources

Document sources are immutable owner-supplied files scoped to one agent. The
feature service and protected API can import, list, search, inspect, retire, and
download them. `DocumentsView.vue` is a reusable view; the coordinator must
connect it to the workspace toolbar and handle its `reference` event before
it is reachable from the main chat. No document is automatically sent to a
provider and no direct provider tool is added by this feature.

Import UTF-8 `.txt`, `.md`, and `.csv` files or PDFs with a readable text layer.
OCR, images, encrypted PDFs, URLs, and other formats are unsupported. Files are
limited to 10 MiB, PDF documents to 200 pages, and extracted text to 1,000,000
characters. PDF extraction runs in a worker with a 15-second timeout and a
128 MiB old-generation heap limit. Up to four uploads may be in progress. Worker
termination is requested on cancellation, disconnection, or service shutdown.
These bounds do not constitute a hard limit on all native or external memory.
Search uses literal matching with ASCII case folding within extracted passages, with at
most 50 results of at most 1,000 characters each; a match spanning a passage
boundary is not returned. Text locations identify the starting line; PDF
locations identify the page of the extracted text. PDF text is the parser's
reading order and is not a byte-for-byte transcription of PDF objects.

Original bytes, SHA-256 digest, and extracted passages are committed together
in SQLite and are included in the existing database backup boundary. A stable
operation ID identifies a retry; reusing it with a different agent, filename, or
bytes is rejected. Retiring a source excludes it from searches and future
capability selections while preserving inspection, download, and provenance.
Original downloads use a protected attachment response. All routes require the
existing paired-client and origin rules; upload rechecks client authorization
and agent availability after asynchronous extraction.

The parser is the Apache-2.0-licensed [Mozilla PDF.js](https://github.com/mozilla/pdf.js),
using `pdfjs-dist` 6.5.438 and its legacy Node entry point. It requires Node
22.13 or later. Staf uses Node 22.22 or later for this build; the existing Node
22 Docker image installs the same locked dependency. PDF.js has an optional
native canvas dependency, but this feature only extracts text and does not
render pages. Native and Docker behavior beyond the offline tests has not been
verified here. Parser failures are reported without accepting partial records.

The library lists up to 500 sources per page.

The scoped `Instance.documentCapabilities` adapter requires the host to supply
an authority check for the captured bot, session, command, and abort signal on
each call. The future Code Mode host must implement that check before exposing
these methods. Source text is untrusted data, not instructions.
