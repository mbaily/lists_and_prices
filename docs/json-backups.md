# JSON backup coverage

Settings → Backup & Restore exports version 2 JSON. The app accepts version 1
and version 2 files. The format version is independent of the client release
version shown at the bottom of Settings.

| Feature | Included |
| --- | --- |
| Folders | Hierarchy, colours, order, favourites, archive state, filters, navigation options, named checkbox definitions and default-item templates |
| Lists | Type, folder, colours, ordering, favourites, archive state, filters, default-note setting and journal mode |
| Items and notes | Text, rich-text formatting and embeds, hierarchy, price, quantity, named checkbox states, completion, headings, pins, full-screen flag and timestamps |
| Smart Folders / reports | Folder assignments |
| Nearby errands | Personal locations and starting-point flags, selected origin, location filtering, hot suburbs, preview limit, recently modified order, checklist progress and paused tags/items |
| Older spreadsheets | Metadata, stored cell values and formulas; the current app does not provide a spreadsheet editor |

Browser preferences (including keyboard shortcuts), destination marks, automatic
sync mode, credentials, API tokens, undo history and the named Version History
collection are not included. The public location catalogue ships with the app.
Restoring a file leaves these separate settings and saved versions unchanged.
Exporting while browsing history exports the viewed historical data.

## Restore behaviour

Files are fully validated before confirmation and validated again immediately
before mutation. Invalid JSON, unsupported format versions, unknown sections or
record fields, duplicate IDs, invalid field types, parent cycles, cross-list
parents and malformed rich-text or spreadsheet content reject the import.
Existing orphan recovery remains available for missing parents in legacy data.
An optional UTF-8 byte-order mark is accepted. Files larger than 100 MB are
rejected before the browser reads them; exports use the same limit.

Merge updates matching IDs and adds new records, keeping other records. For a
matching spreadsheet, an included `cells` object replaces its cell contents;
an absent legacy `cells` field preserves them. Replace clears current data and
restores the file, including optional sections. Current restores participate in
Undo, but a separate downloaded backup remains the durable recovery copy.

Version 1 files cannot recover formatting or cells that their exporter omitted.
The restore preview identifies older files. Version 2 exports are deliberately
rejected by old app clients that only understand version 1, preventing a restore
that silently discards new data.

List clipboard JSON also preserves rich text and the full-screen flag. It accepts
legacy exports without a version, as well as versions 1 and 2. Item IDs are
remapped on paste, named checkboxes match by name, and children can precede their
parents in the JSON. A parent outside the copied selection becomes a root item.
Malformed app exports are reported instead of being pasted as literal text.

When adding persistent features, update backup export, validation and restore
together, add a round-trip test, and update this coverage table and in-app help.
Change the format version whenever an older client could silently discard data.
