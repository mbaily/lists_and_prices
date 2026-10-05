# Task integration API

The running server accepts tasks without a browser or clipboard. Imports modify
the user's live Yjs document and wait for persistence before acknowledging success.
Connected browsers receive the normal Yjs updates. The existing `YPERSISTENCE`
configuration is required; the API fails with 503 when persistence is unavailable.

`GET /api/tasks/lists` returns destination IDs/names for the authenticated user.
`POST /api/tasks/lists` with `{"name":"From Photos","folderId":"folder-id"}`
explicitly creates a plain list in an existing active folder, or returns the
existing list with that name in that folder. It requires a session or a user-wide
setup token; list-scoped tokens cannot create lists. The response contains `list`
and `created`. Repeating the same setup request reuses the existing list.
For explicit setup, `POST /api/tasks/folders` with `{"name":"From Photos"}`
creates or reuses an active top-level folder, returning `folder` and `created`.
`PATCH /api/tasks/lists/:id` with `{"folderId":"folder-id"}` moves an existing
list into an active folder, returning `list` and `moved`. It preserves the list ID
and all tasks. Both require a session or user-wide setup token; the supplies app's
list-scoped token cannot create folders or move lists.
`POST /api/tasks/import` accepts JSON:

```json
{"listId":"destination-list-id","tasks":["Buy milk #supplies_photos","Laundry powder #supplies_photos"],"addPosition":"bottom"}
```

Alternatively send `text` containing one task per line instead of `tasks`.
`addPosition` is optional (`bottom` by default, or `top`). Imports create unchecked
todos. Limit requests to 500 lines of at most 5000 characters, with a 1 MiB JSON
body. Blank lines and lines without letters are ignored. A missing destination is
404; a divider cannot receive tasks. The server never creates a list implicitly.

Success returns `added`, `duplicates`, `ignored`, and an `items` array identifying
added/existing tasks. Repeating requests is safe: matching ignores trimmed edge
whitespace and whitespace-separated trailing `#word` hashtags using the same
helper as Import from Clipboard. Case, inline tags, URL fragments and hashtag-only
names remain significant. Original names/tags are retained. Checked items and
subtasks also count as existing matches; the API does not reopen or alter them.
Deduplication applies within each API batch too. Clipboard paste retains its
existing behavior of preserving repeated new lines within a paste.

Authentication accepts the existing session cookie or a per-user bearer token.
The user's identity comes from authentication; a submitted username cannot change
the destination account. Service tokens can be restricted to one list. Requests
cannot access another user or a list outside the token's scope. Tokens are checked
against current configuration and the account's continued existence on each call.

Issue a token in the deployed runtime, as its service user:

```sh
cd /opt/lists_and_prices
sudo -u www-data node --import tsx server/task-token.ts \
  --user mb --list DESTINATION_LIST_ID --output /absolute/private/token-file
```

Omit `--list` only when the integration needs all the user's lists. The raw token
is written once to a new file with mode 0600; it is never printed. Only its SHA-256
hash and scope are stored in `server/task-tokens.json` (ignored by Git and protected
from deployment overwrite). Use `Authorization: Bearer TOKEN` over HTTPS. Revoke
a token by removing its entry from that file. Tokens do not expire with browser
sessions; keep the caller's raw token private.

The supplies app calls the API only when its Send tasks button is clicked. Its
server holds a list-scoped token, selects unfinished Task photos in the saved
session scope, and sends notes tagged `#supplies_photos`. No photo bytes are sent.
Its destination is user mb's **From Photos** list in the **From Photos** folder.
