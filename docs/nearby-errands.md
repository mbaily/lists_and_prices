# Nearby errands and the location catalogue

Melbourne's 549 suburb centres are available as location hashtags, such as
`#brunswick`, `#richmond`, `#brunswickeast`, `#stkilda` and `#mountwaverley`.
Use the suburb name in lowercase without spaces or punctuation. These hashtags
match approximate suburb centres, and work on lists, todos and notes. Distances
and directions use the centre rather than a particular address or every store
within the suburb. Find them under **Available location hashtags**.

Open **📍 Nearby errands** from the home header. Add a hashtag to a todo, for
example `Milk #supermarket`, `Coffee #coles`, `Bread #woolworths` or `Socks #kmart`.
Press the **location icon** and allow browser location access, or tap a hot suburb
pill to start at its centre. Use the **edit icon** to open **Hot suburbs**, where
you can add, remove and drag suburb shortcuts into order, then Save (or Cancel to
discard). The drag handles also support the keyboard's up and down arrow keys.
The initial shortcuts are Melbourne, Brunswick and Richmond; your saved list syncs
across devices and is included in backups. Search in the editor accepts
partial names and spelling mistakes; use the arrow keys and Enter or tap a result.
Distances start from the suburb's approximate centre. Choose a radius from 1 to 50 km.
The **Clear** button beside the editor's suburb field clears the search text.
Editing shortcuts leaves the current starting location unchanged.

Expand **Available location hashtags**, below the suggestions, to browse hashtags supported by the whole
retail catalogue and your saved locations, with the number of matching places.
It updates automatically when custom locations are added, changed, deleted or synced,
and includes the derived `#supermarket` tag for Coles and Woolworths. Add a listed
hashtag to a list name, for example `Shopping #supermarket`, to apply it to that
list's todos and notes. You can also tag individual items, for example `Buy milk #coles`.
Search the hashtag field to find a brand (for example `jb hi-fi`, `muji` or `bunnings`),
or use **Show all hashtags** to browse the full catalogue. The initial view shows
the twelve hashtags with the most locations.
Select a hashtag button to browse its matching locations, addresses and directions
in a scrollable panel. Selecting another hashtag replaces the list; × closes it.

**Matched tasks**, above the radius selector, is a persistent checklist of items
with a location match in the database, `#bank` errands, plus previously seen tasks still active.
Todos have checkboxes linked to their original completion state; notes are plain
listings. With named folder checkboxes, the nearby checkbox controls the last
completion checkbox and preserves the other checks. Each item appears once.
Tasks outside the selected radius remain listed with an explanation.

Use `Withdraw cash #bank` or name a list `Banking #bank` for bank and ATM
reminders. These appear without a saved location or starting point, labelled
**Choose a bank or ATM yourself**. Tick, dismiss, pause and resume them like other
errands. They do not count as missing nearby matches or toward location coverage
unless a saved matching location is inside the radius. You can optionally save a
favourite bank with the `bank` tag. `#bank` is always available in the hashtag browser;
no bank or ATM catalogue is required.
Bank errands also appear as `#bank` pills in **Nearby**, and sort with nearby
matches at the top of **Matched tasks**, even without a saved bank or ATM location.

Use `#errand` for general tasks with no set location, such as `Post a letter #errand`,
or put it on a list to apply to its untagged todos and notes. Like `#bank`, it
appears in **Nearby** and at the top of **Matched tasks** without a starting point
or a saved destination. You can complete, dismiss or pause it, and it does not
count as an item missing a nearby match. The pill retains the `#errand` label.

Use the **pause icon** immediately left of a task’s dismiss × to defer occasional
errands. It pauses only that individual todo or note. Other tasks using the same
hashtag stay active. The paused task disappears from Nearby pills, Matched tasks,
suggested stops, alternatives and unmatched-item counts; the original stays unchanged.

Expand **Paused errands** and press **Resume** beside a task to bring it back.
Pauses remain until resumed, including after edits and reloads. They sync across
devices and support undo, backups and history. Pause/resume is disabled in history.
To defer an entire destination, select its hashtag under **Available location
hashtags** and choose **Pause all #ikea errands**, or **Resume all** to undo that
tag pause. Tag pauses also apply to new tasks using that tag. If a task is paused
both individually and by hashtag, both pauses must be resumed to bring it back.
Existing hashtag pauses are preserved.

Completing a todo removes it from the suggested stops but leaves its checked row
in the checklist. **Clear completed** removes these rows without unchecking or
deleting the original todos. The × beside a task dismisses it from errands only.
Dismissed notes and unchecked items return when their text, rich-text formatting,
metadata or inherited list name changes. A cleared todo stays hidden while checked,
even if edited; unchecking it makes it eligible again. Deleted, archived, completed-list,
heading and untagged items are excluded. Already completed todos that have never
appeared in this checklist are not added automatically.

Checklist membership and dismissals are stored per item in Yjs, survive navigation,
reloads and cross-device sync, and are included in backups and history. There is no
time-based expiry. Automatic membership tracking adds no undo action; dismissing,
clearing and ticking remain undoable. Historical views cannot change the checklist.

**Suggested stops** shows a short set of individual shops covering every tagged
unchecked todo or note with a match inside the selected radius. Specialist errands,
such as `#officeworks`, are included alongside common supermarket errands. Each
item appears once, and the summary counts distinct items covered inside the radius.
Items without a nearby match are listed above the stops, distinguishing locations
outside the radius from hashtags with no matching location in the database.

Selection favours the shop covering the most remaining items, breaks ties by
distance, and removes redundant stops. The chosen shops are displayed nearest
first. This is a practical coverage heuristic; it does not compute a minimum-stop
solution or optimise a driving route. Shopping-centre membership does not affect
selection. **Alternatives** is collapsed by default and shows other matching shops
nearest first when expanded. Alternative cards are rendered only while expanded.

Tap a todo or note to open its list and highlight it. Directions opens Google Maps
using the destination coordinates; the app does not send your GPS coordinates in
that link. Distances are straight-line distances, not travel times or road distances.

Items with their own hashtags use those tags; otherwise they inherit hashtags
from their list's name. For example, `Bread #coles` in `Shopping #supermarket`
stays specific to Coles. Folder hashtags are not inherited. Headings, completed lists, archived
lists/folders and completed todos are excluded. Tagged notes in active lists are included.
Named folder checkboxes use the
last checkbox to decide completion, just like the rest of the app.

Matching is case-insensitive and any matching tag is enough:

| Todo hashtag | Compatible locations |
| --- | --- |
| `#supermarket` | Coles, Woolworths and Woolworths Metro |
| `#coles` | Coles |
| `#woolworths` | Woolworths and Woolworths Metro |
| `#wooloworths`, `#woolworth`, `#woolies` | Aliases for Woolworths |
| `#kmart` | Kmart |
| `#hardware` | Bunnings and Mitre 10 (also custom Home Hardware locations) |
| `#bunnings`, `#mitre10` | That hardware chain |
| `#northland`, `#emporium` | Businesses in that shopping centre |
| `#jbhifi`, `#muji`, `#uniqlo`, etc. | Recorded branches of that brand |
| Any other hashtag | Locations explicitly supporting that tag |

A location supporting `coles` or `woolworths` also supports `supermarket`
automatically. Other supermarkets can support `supermarket` explicitly. Kmart
supports `kmart`; it is not a supermarket.

## Database format and initial coverage

The pre-recorded catalogue is **`src/lib/locations/melbourne.json`**, formatted JSON
that can be edited by hand. It is bundled with the frontend, so lookups work offline
and do not need a running map API or an API key. Edit this file and rebuild/deploy to
update the catalogue on every device. The original seed had 421 locations:
43 Kmart, 177 Coles and 201 Woolworths/Metro in the original supermarket catalogue.
The catalogue now has **4,766 locations**. The chain expansion checks all 323 original
brand tags, consolidating aliases into 316 brand identities. Officeworks was subsequently added as a new brand,
with 44 active locations inside the metropolitan boundaries. The catalogue also includes
16 Scorptec/Centre Com/CPL/MSY branches matching `#pcparts`, four MUJI branches
and eight DAISO branches. MUJI Highpoint/Knox use labelled shopping-centre pins;
PC retailers use verified street addresses with labelled suburb fallbacks where needed.
MSY Dandenong South is excluded while its official locator lists it closed for renovation.
It uses AllThePlaces
chain exports, official retailer locators and public directories at 14 Melbourne
shopping centres. Per-brand sources, counts and unresolved coverage are recorded
in `docs/retail-chain-coverage.json`. This report distinguishes brands with
additional sources from brands still limited to directory listings. Neither status
is a guarantee that every current branch is included or still open.

Every imported point is checked against the official boundaries of Melbourne's
31 metropolitan councils, including Mornington Peninsula and Yarra Ranges.
Regional branches outside these boundaries are excluded. Verified suburb addresses
can supply a labelled approximate point when a source coordinate is missing or
incorrect. Store points may not be parking or entrance locations.

The Svelte screen imports this JSON as a module. Vite parses the JSON during the
build and bundles the resulting data into frontend JavaScript; the browser does
not separately fetch or call `JSON.parse` on the catalogue. Updating the file updates
the development app; deployed clients need a rebuilt release.

Each entry looks like this (illustrative, not an extra store):

```json
{
  "id": "my-chain-my-branch",
  "name": "My Chain — My Branch",
  "tags": ["mychain", "supermarket"],
  "latitude": -37.8136,
  "longitude": 144.9631,
  "address": "Street, suburb, postcode",
  "source": "https://example.com/store-locator"
}
```

Use unique stable IDs, numeric coordinates and lowercase tags without `#`.
`address` and `source` are optional. The app accepts arbitrary tags, so pharmacies,
post offices, other chains and locations outside Melbourne can use the same format.
The location validation regression test checks the actual catalogue.
An optional `coordinateAccuracy` is `store`, `shopping-centre` or `suburb`.
Shopping-centre records also have a `centre` name. The screen labels centre points
and approximate suburb points. For a suburb fallback, directions use the store's
address when supplied, so Google Maps can resolve the destination.

Refresh directory and hardware records using `scripts/update-melbourne-retail.py`
with Python 3, `requests` and `shapely` installed. It preserves the original records
and manual additions, replaces its previously collected records, and writes only
after all sources have succeeded and IDs are validated. `--source-cache <directory>`
can reuse downloaded directory HTML and hardware GeoJSON snapshots.

Refresh chain snapshots with Python 3, `requests` and `shapely`:

```sh
python3 scripts/update-melbourne-chains.py --source-cache /path/to/source-cache
```

`scripts/retail-chain-sources.json` records the original inventory, source URLs and
search attempts. `scripts/retail-chain-facts.json` preserves the selected public
locator and directory facts used by this import; `--additional-facts` can replace
that supplementary snapshot. The collector preserves manual records, replaces its
own records, merges aliases and nearby duplicate branches, and regenerates the
coverage report. Source failures appear in the report; inspect it before publishing
a refreshed catalogue. Directory-only brands need further verified locator data.

Officeworks comes directly from its official active-store locator API, filtered by
Victorian addresses and the same metropolitan boundaries. Its catalogue tag is
`officeworks`; all 44 imported branches have store coordinates. The collector saves
`officeworks-official.json` in the source cache. Remove that cached file to fetch
a fresh active-store list on the next run.

## Sources and collection

Northland and Emporium entries come from their public
[Northland directory](https://www.northlandsc.com.au/shopping) and
[Emporium directory](https://www.emporiummelbourne.com.au/shopping), retrieved
on 2026-09-30. Only currently linked directory entries are included: embedded
website data also contains unpublished entries, which are excluded. Only business
names, addresses, source links and the centres' published coordinate facts are
recorded; no descriptions, images or opening hours are copied. The centre coordinate
is shared by its businesses and is not an individual shop or entrance pin.

Bunnings and Mitre 10 entries come from the
[AllThePlaces downloads](https://alltheplaces.xyz/), using store-locator point
coordinates and retaining official branch source URLs. These downloads are CC0;
this licence does not apply to separately sourced shopping-centre directory facts.
No suburb-centre fallback or Google Maps API was needed for these additions.

The separate starting-point catalogue, **`src/lib/locations/melbourne-suburbs.json`**,
contains 549 official bounded suburbs/localities with land inside Melbourne's 31
metropolitan councils, including the Mornington Peninsula and Yarra Ranges. It is
independent of retail coverage and works offline. Names and approximate centres
are derived from [Vicmap Admin locality boundaries](https://discover.data.vic.gov.au/dataset/vicmap-admin-locality-polygon-aligned-to-property)
and local government boundaries, retrieved on 2026-09-30. This is official bounded
locality coverage; informal neighbourhood names are not included. Coordinates are
polygon centres, falling back to an interior point for irregular boundaries.
Derived from Vicmap Admin, © State of Victoria (Department of Transport and Planning),
licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).

To refresh suburb data, run `scripts/update-melbourne-suburbs.py` with Python 3,
`requests` and `shapely` installed (collection tools only; not app dependencies).
The script fetches all matching official boundaries, excludes shared boundary lines,
and writes the compact name/coordinate catalogue. No boundary polygons are bundled.

The catalogue was collected on 2026-09-30. Kmart and Woolworths entries come from
[AllThePlaces](https://alltheplaces.xyz/), whose downloadable data is released under
[CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/). Dataset URLs are in the
JSON metadata. Their locations originate from retailer store locators. A Kmart
redirect produced two identical Chirnside Park entries; the duplicate was removed.

The initial AllThePlaces Coles export had incomplete supermarket coverage because
its nearby-store queries included liquor stores. Coles entries were supplemented
from the public [Coles store locator](https://www.coles.com.au/find-stores) API with
82 supermarket-only queries across Melbourne, collecting by stable store ID and
filtering to the stated coverage. Every record retains a source URL. These Coles
location facts are separately sourced from Coles; the CC0 notice applies to the
AllThePlaces source data. Liquorland, First Choice and petrol stations are excluded.

Collection was a one-off research task. The app does not scrape or update store
locations automatically. Periodically check new stores, closures and changed
coordinates against the retailers' own locators. Retrieval date does not imply
that every AllThePlaces record was individually verified on that date.

## Personal locations, backups and privacy

**Locations** lets you add, edit and delete custom places with a name, coordinates,
optional address and one or more matching hashtags. You can copy coordinates from
the selected starting point. Custom locations use `custom-` IDs and are stored per
entry in the user's Yjs document. They sync across devices, support application
Undo, and are included in commits and JSON backups as `customLocations`.

The bundled public catalogue is not duplicated into each user's backup. Merge
imports retain existing custom locations; replace imports restore the custom
locations in the backup. Replacing with an older backup without `customLocations`
clears existing custom locations (and can be undone). Use updated clients for
export/import: older app versions do not preserve this new backup field.

The last starting location (GPS or suburb) is saved in your Yjs document, persisted
offline, and synced to your other signed-in devices. Returning to the screen restores
it, including updates synced while the screen is open. Coordinates, source, label,
GPS accuracy and update time are stored together. The screen displays when it was
last updated; a saved GPS point is labelled **Last GPS location**.

GPS is requested only on a button press. It is a one-time fix with an update button;
choosing a suburb also replaces the saved starting point. A denied or failed GPS
request keeps the previous location. Starting locations are included in JSON backups,
commits and Undo. Historical views cannot update the saved point. A replace import
of an older backup without a starting location clears it; a merge preserves it.
Browser GPS
usually requires HTTPS or localhost. Permission denial and timeout leave the manual
starting-location option available. The app makes no background location requests.
