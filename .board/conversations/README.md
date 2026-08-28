# Agent conversations

Written by the Board VS Code extension. One pair of files per ticket:

- `<TICKET>.json` — the state the panel reloads, including the Claude
  session id so the conversation can be resumed rather than restarted.
- `<TICKET>.md` — the same conversation, readable.

Safe to delete: a missing file just starts that ticket fresh. Commit them
if you want the reasoning in history, ignore them if you do not.
