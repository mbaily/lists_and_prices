/** Static user guide, bundled with the app so it is also available offline. */
export interface HelpSection {
	title: string;
	paragraphs: string[];
	steps?: string[];
	bullets?: string[];
}

export interface HelpTopic {
	id: string;
	title: string;
	icon: string;
	summary: string;
	sections: HelpSection[];
	related: string[];
}

export const helpTopics: HelpTopic[] = [
	{
		id: 'getting-started',
		title: 'Getting started, folders & lists',
		icon: '📁',
		summary: 'Create your first list, organise folders, navigate and archive older work.',
		sections: [
			{
				title: 'A place for your tasks and notes',
				paragraphs: [
					'Lists & Prices keeps tasks, quick notes and shopping prices together. Folders organise your lists; each list contains individual items. A plain list is useful for todos and notes, while a priced list adds prices, quantities and a running total. You can use both kinds within the same folder.',
					'Sign in while connected before using the app on a new device. Once your data and the app have loaded, you can keep working offline. Use the same account on your other devices to sync your lists when connected. The sync indicator in the home header shows the current connection state.'
				]
			},
			{
				title: 'Create your first folder and list',
				paragraphs: ['Lists live inside folders. Start with a simple folder such as Personal, Work or Shopping, then add more folders as you need them.'],
				steps: [
					'Use the home screen’s add controls to create a folder. Give it a name and choose a colour, then select Create.',
					'Open that folder and create a new list. Choose Plain or Priced. A Divider creates a visual separator among the lists rather than a task list.',
					'Enter a list name, or leave it blank to use an automatically generated date and time. The date shortcuts and calendar help when naming a dated list.',
					'Open the list, type your first item in the input bar and confirm with ✓ or Enter. Repeat to add more items.'
				]
			},
			{
				title: 'Find your way around',
				paragraphs: [
					'Tap a folder or list name to open it. The breadcrumb at the top shows where you are; select an earlier part to return there. Inside a list, select its folder in the breadcrumb to return there, or the home control to return to the root. Previous and next list arrows let you step through the available lists.',
					'Folders can contain subfolders, so you can build a hierarchy such as Work › Projects › Website. Folder settings include Local navigation, which changes the scope used when stepping through lists. Choose Global navigation again when you want broader navigation.',
					'Use the ⋮ menu beside a folder or list for actions such as Rename and Info. Renaming also lets you change colours. Drag handles change the order of folders and lists; this order is separate from the order of shortcuts in your favourites bar.'
				]
			},
			{
				title: 'Keep the home screen useful',
				paragraphs: [
					'Star the folders or lists you open often to give them shortcuts in the favourites bar. Search helps you locate names and item text without opening each folder. Quick Add lets you capture a task or note into a chosen list from the home header.',
					'Archive a list or folder from its row menu when you want to keep it but remove it from normal views. The 📦 control at the root opens archived content, and Unarchive brings it back. Archiving a folder also hides its contents from active views, Smart Reports and nearby errands.',
					'Delete removes content rather than putting it in the archive. Deleting a folder also deletes its contained folders, lists and items, so read the confirmation before proceeding. Download a backup from Settings when you want a separate copy before reorganising a large amount of work.'
				]
			}
		],
		related: ['tasks-notes', 'favourites', 'sync-backups']
	},
	{
		id: 'tasks-notes',
		title: 'Tasks, notes & checkboxes',
		icon: '☑',
		summary: 'Add and edit items, use subtasks, notes, headings and named completion steps.',
		sections: [
			{
				title: 'Add tasks and notes',
				paragraphs: [
					'Open a list and type in the input bar. Confirm with the green ✓ button or Enter. The small note/todo toggle in the input switches between a task with a completion checkbox and a note without one. Each list remembers its default input type for new top-level items.',
					'Tap an item’s text to edit it, then confirm the new text. Use the cancel control to abandon an edit. On a physical keyboard, Shift+Enter inserts a line break in the input. The + button brings you back to adding an item. Settings controls whether new items appear at the top or bottom.',
					'The item’s ⋮ menu contains Info & Pin, including Note/Task to change an existing item’s type. Pin gives an important item a shortcut in the pinned bar. Notes can also use Full Screen for a larger editor; use its save control when finished.'
				]
			},
			{
				title: 'Break work into smaller pieces',
				paragraphs: [
					'Use Add Subtask or Add Subnote from an item’s menu to add a child beneath it. The input shows which parent you are adding to. Cancel that parent selection when you want to add a top-level item again. Child items are indented so their relationship is visible.',
					'Parent here makes an item the destination for repeated additions. The Parent bar shows the active destination, and Cancel ends that mode. Its insertion order has a separate setting, so you can choose whether new children appear at the top or bottom.',
					'Make Heading turns a top-level task into a section heading. Headings organise the list and do not count as todos or contribute to a price total. Use Unheading to change it back. Drag handles reorder items, and selection actions can move items under a different parent.'
				]
			},
			{
				title: 'Complete and filter work',
				paragraphs: [
					'Tick a task when finished. Checked tasks stay in the list with a strikethrough until you remove them or change the filter. The filter control cycles through all, unchecked only and checked only. A hidden task may simply be excluded by the current filter.',
					'The list header has a separate checkbox for marking the whole list complete. Completed lists are excluded from Smart Reports. In nearby errands, their items stop inheriting the list’s hashtags, but incomplete items with their own location hashtags can still appear. Mark the list incomplete to include its remaining work normally again.',
					'Use Uncheck all to reset a reusable checklist, or the delete-checked action to remove completed tasks. If you have selected items, these actions apply to the selection. Otherwise they apply across the list. Read the confirmation, especially when deleting a task that has children.'
				]
			},
			{
				title: 'Named checkboxes for a workflow',
				paragraphs: [
					'Open a folder’s ⋮ menu, then Folder settings → Checkboxes to define stages such as Bought, Packed and Done. Tasks in lists directly inside that folder get one toggle for each stage. Add, rename or reorder the names in the dialog.',
					'The last name in the configured order decides whether a task is fully done. Earlier checks track progress independently. With Bought followed by Packed, a task is complete when Packed is checked. This rule also controls counts, filters, Smart Reports and nearby errands.',
					'Reordering names can therefore change which tasks count as complete. Removing a name removes its per-item state; removing all names returns the folder’s lists to a single checkbox. Notes and headings remain separate from todo completion.'
				]
			}
		],
		related: ['moving-links', 'smart-reports', 'prices']
	},
	{
		id: 'prices',
		title: 'Prices, quantities & totals',
		icon: '💰',
		summary: 'Use priced lists and the numeric keypad, and understand the running total.',
		sections: [
			{
				title: 'Choose a priced list',
				paragraphs: [
					'A priced list works like a normal task list with extra controls for each item’s price and quantity. It suits shopping lists, estimates and simple cost tracking. Create a new list with Priced selected, or open an existing list’s header ⋮ menu and choose Switch to priced list.',
					'You can switch back with Switch to plain list. This changes which controls are displayed without requiring a new list. Tasks, notes and headings still have their usual roles. Use task rows for things that should contribute to the total, and notes for explanations.'
				]
			},
			{
				title: 'Enter or change a price',
				paragraphs: ['Tap an item’s price to open the numeric keypad. The keypad header shows the value being entered so you can check it before saving.'],
				steps: [
					'Enter digits and use the decimal point for cents, for example 3.50. Prices support two decimal places.',
					'Use backspace to correct the entry. The minus control changes its sign, which is useful for a discount or credit.',
					'Choose Enter or Done to save the price and close the keypad. The running total updates automatically.',
					'On a physical keyboard, digits, decimal point, backspace, minus and Enter work while the keypad is open. Escape cancels the entry without saving it.'
				]
			},
			{
				title: 'Set quantities and read the total',
				paragraphs: [
					'Tap the quantity control to use the keypad for the number of units. Quantities use positive whole numbers. If no quantity is set, the calculation uses one unit. Enter the price for one unit and the quantity separately rather than multiplying the price yourself.',
					'Each task contributes price × quantity. Two items at 3.50 contribute 7.00; another at 4.00 makes a total of 11.00. An item without a price contributes zero until you set its price. Notes and headings are excluded from the total, while task items at child levels also contribute.',
					'Checking a task does not subtract its price. The total covers the whole list, including checked tasks, so ticking purchases as you shop keeps the full shopping total visible. Filters affect what you see, rather than turning the total into an unchecked-items total. Delete a task if its cost should be removed.',
					'If a total seems unexpected, check quantities, negative prices and any tasks hidden by the filter or nested under another item. Switching a task to a note also removes that row from the calculation.'
				]
			},
			{
				title: 'Currency and sharing',
				paragraphs: [
					'Choose the displayed currency symbol under Settings → Currency. Changing the symbol does not convert stored prices or apply an exchange rate. Treat the amounts as using one consistent currency and choose the symbol that describes them. Prices display with two decimal places.',
					'For a spreadsheet, open the list’s header ⋮ menu and choose Copy as spreadsheet, then paste into your spreadsheet application. Export to clipboard (JSON) is useful when copying app item data with its attributes. Import from clipboard can bring supported JSON or plain-text items into a list.',
					'Smart Reports summarise outstanding task text rather than providing a cost breakdown. Use the priced list itself for its total and quantities. Use Download backup in Settings when you want a file containing your lists and item prices, rather than a text summary.'
				]
			}
		],
		related: ['tasks-notes', 'moving-links', 'sync-backups']
	},
	{
		id: 'favourites',
		title: 'Favourites & the favourites report',
		icon: '⭐',
		summary: 'Star folders and lists, rearrange shortcuts and review outstanding favourite tasks.',
		sections: [
			{
				title: 'Keep useful places close',
				paragraphs: [
					'Favourites are shortcuts to folders and lists you use often. Tap the star on a folder or list row on the home screen to add it. A list also has a star in its own header. Tap the star again to remove it from favourites; the original folder or list stays where it is.',
					'Your favourites appear in a bar on the home and list screens. Choose a folder shortcut to open that folder or a list shortcut to open its list. Favourites can come from different parts of your folder tree, so the bar is useful for keeping work, shopping and personal lists within reach.',
					'The expand/collapse control changes the bar’s presentation. Expanded entries show their folder paths; collapsed entries use shorter names. If two lists share a name, expand the bar to see their locations. Archiving a favourite or an ancestor folder hides it from the active favourites bar.'
				]
			},
			{
				title: 'Rearrange your shortcuts',
				paragraphs: ['Use Rearrange favourites in the bar to open the dedicated ordering screen. Changes take effect as you make them.'],
				steps: [
					'Drag a row by its handle to a new position, or use its up and down buttons for small changes.',
					'Use the star beside an entry to remove or restore its favourite status. An entry you unstar can remain dimmed and labelled Unmarked during that visit, so you can star it again easily.',
					'Select an entry’s name to navigate to it, or use Back to return to the screen you came from.'
				]
			},
			{
				title: 'Open the favourites report',
				paragraphs: [
					'Open 📋 Smart Folder Reports in the home header and choose ⭐ Favourites. This is a built-in report: you do not need to create a named Smart Folder or assign folders to it first. It collects outstanding todos from your starred places.',
					'Use the left half of the Favourites row, marked ⟳, for a live report in a separate tab. It updates as the app’s data changes. Use the right half, marked 📤, for a generated snapshot. Generate another snapshot after changing tasks if you want an updated copy.',
					'Starring a folder includes the active, incomplete lists directly inside that folder. Starring an individual list includes that list even when its folder is not starred. Lists in nested subfolders need their own favourite status or a starred containing folder; starring an ancestor does not recursively include every descendant.'
				]
			},
			{
				title: 'Understand what appears',
				paragraphs: [
					'The report groups tasks by folder and list, using their regular order. Rearranging the favourites shortcuts does not rearrange the report. Only lists with an outstanding top-level todo produce a report block. Archived folders and lists, completed lists, completed todos and headings are excluded.',
					'Subtasks appear indented beneath an included todo. Subnotes attached to that todo can appear too, marked with ↳. Standalone top-level notes are excluded. If a parent todo is complete, its branch is excluded even if a child is still incomplete. Named checkboxes use the last configured checkbox to decide completion.',
					'In the live report, select a folder, list or task to open its source in the app. Use the copy control for a plain-text summary. Settings → Report font size changes the report’s text size. If the report is empty, check that your favourites contain active lists with incomplete top-level tasks.'
				]
			}
		],
		related: ['smart-reports', 'tasks-notes', 'getting-started']
	},
	{
		id: 'smart-reports',
		title: 'Smart Report / Smart Folders',
		icon: '📋',
		summary: 'Build named reports across folders, open live reports or snapshots, and copy summaries.',
		sections: [
			{
				title: 'Review outstanding work across folders',
				paragraphs: [
					'A Smart Report brings together outstanding todos from chosen folders. The app calls these report groups Smart Folders. They let you review work spread across several places without moving or duplicating the original lists. For example, a Weekly review report could include both your Work and Personal folders.',
					'You choose the folders that belong to a report. A folder can belong to more than one report, and a report can include several folders. Assignments sync with your account’s data, so the same named reports are available on your other connected devices.'
				]
			},
			{
				title: 'Create a report and choose its folders',
				paragraphs: ['Report setup starts from a folder’s menu on the home screen.'],
				steps: [
					'Open the ⋮ menu beside a folder and select 📋 Smart Folder.',
					'Enter a name under New report name and choose Add. This creates the report and assigns the current folder to it.',
					'For another folder, open the same dialog and tick the existing report under Assign to report. Repeat for each folder you want to include.',
					'Untick a report to remove just the current folder from it. The delete-report control removes the report group’s assignments; it does not delete the folders or tasks.',
					'Choose Done, then open 📋 Smart Folder Reports in the home header to find your report by name.'
				]
			},
			{
				title: 'Choose a live report or a snapshot',
				paragraphs: [
					'Each report menu row has two halves. The left half, marked ⟳, opens a live report in a separate tab. It follows changes to the data while open, including updates received through sync. The right half, marked 📤, generates a snapshot of the report at that moment in a separate tab.',
					'The generated report includes its generation time and stays as it was when created. Generate it again after making changes for a fresh summary. If nothing opens, check whether your browser blocked the new tab. Report tabs use your signed-in account.',
					'Tasks are grouped under folder and list names. In the live report, select a heading or task to open its source in the app. Use Copy as text to put the summary on the clipboard for pasting elsewhere. Settings → Report font size adjusts readability; the report view uses its own dark presentation.'
				]
			},
			{
				title: 'Inclusion rules and missing tasks',
				paragraphs: [
					'A report includes lists directly inside its assigned folders. Assign subfolders separately if you want their lists as well. Archived folders or ancestors, archived lists and lists marked complete are excluded. A list appears only when it has an incomplete top-level todo.',
					'Completed todos and headings are excluded. Top-level notes are excluded too. Under an included todo, incomplete subtasks and attached subnotes are shown with indentation. A completed parent removes its branch from the report, so an incomplete child under that parent will not appear on its own.',
					'For a folder with named checkboxes, the last checkbox decides completion. If a task disappears earlier than expected, check that final stage and the list’s completion checkbox. The report follows regular folder, list and item order; it does not use the favourites bar’s shortcut order.',
					'The built-in ⭐ Favourites report appears in the same menu. It uses starred folders and lists instead of named report assignments and has the same task inclusion rules. Use it for a quick overview, or create named reports when you want a separate selection of folders.'
				]
			}
		],
		related: ['favourites', 'tasks-notes', 'sync-backups']
	},
	{
		id: 'moving-links',
		title: 'Search, links, copying & moving',
		icon: '🔎',
		summary: 'Find items, use hashtags and references, copy data and move work between lists.',
		sections: [
			{
				title: 'Find names and hashtags',
				paragraphs: [
					'Open search on the home screen and type part of a folder, list or item name. Select a result to open its location. When you open a result, the saved-search breadcrumb lets you return to the results without entering the search again. Check the unchecked-only search filter if completed tasks seem to be missing.',
					'Add hashtags within names, such as Buy milk #shopping or Weekend #home. Hashtags appear as pills and can help you find related work across lists. Selecting a tag in a list opens a search for that tag. Suggestions appear while entering hashtags you have used before.',
					'For nearby errands, hashtags also match locations. An item with its own recognised errand hashtags uses those; otherwise it keeps its item hashtags and inherits hashtags from its list’s name. Unrelated tags such as #urgent still inherit the list’s errand location. Folder hashtags are not inherited for errands. Tag (to move) in a row menu is a separate action for moving a folder or list.'
				]
			},
			{
				title: 'Link to an item, list or folder',
				paragraphs: [
					'Use Tag as Link in the source item, list or folder’s menu to copy an internal reference. Paste it into another item’s text to create a shortcut to that source. The app displays the referenced name as a pill, so you can connect a task to supporting notes or another list.',
					'A reference points to the original content; it does not copy it. If the source is renamed, the displayed reference can follow its current name. If the source is deleted, its reference cannot open that missing content. Ordinary web addresses in item text appear as links, with Copy Link actions available from the item menu.'
				]
			},
			{
				title: 'Copy or import list content',
				paragraphs: [
					'An item’s Copy & Link submenu offers Copy for its plain-text name and Copy JSON for its attributes. A list’s header ⋮ menu offers Export to clipboard (JSON), Copy as spreadsheet and Copy as journal. Use spreadsheet output for tabular pasting, or journal output when you want a text record.',
					'Import from clipboard accepts supported app JSON or plain text. Plain-text import adds each non-empty line as an item and skips names already present in the destination list. JSON can carry attributes such as price, quantity, note status and parent relationships. Clipboard access may require browser permission; if it fails, check the browser’s clipboard settings.'
				]
			},
			{
				title: 'Move existing work',
				paragraphs: [
					'To move a folder or list, choose Tag (to move) from its row menu. Navigate to the destination and choose Move Tagged Here. Use the root destination control when moving a folder back to the top level. Clear Tag cancels the pending move. A folder cannot be moved inside itself or its descendants.',
					'To move tasks, mark a destination list using its row menu, then open the source list and choose Select items from the header menu. Select the items, open View list in the selection bar, choose a compatible destination mark and use Move to mark. Marks are saved for your account on the current device.',
					'Within a list, select items and use Reparent selected here from a suitable target item’s menu to put them underneath it. Move selected to root returns them to the top level. The app prevents moves that would create invalid parent relationships. Check the destination and selected items before confirming any move.'
				]
			}
		],
		related: ['tasks-notes', 'nearby-errands', 'settings']
	},
	{
		id: 'nearby-errands',
		title: 'Nearby errands & locations',
		icon: '🚗',
		summary: 'Match tagged tasks to places, choose a starting point and pause or complete errands.',
		sections: [
			{
				title: 'Give your errands a location hashtag',
				paragraphs: [
					'Nearby errands matches tasks and notes to places using hashtags. Try Milk #supermarket, Paper #officeworks or Screws #hardware. A hashtag on a list name applies to items without their own recognised errand hashtags. Milk #urgent still inherits Shopping #supermarket; Bread #coles uses its own destination. Recognition uses the whole catalogue, suburbs and saved places, plus #bank and #errand, regardless of distance. Folder tags are not inherited.',
					'Open 🚗 in the home header. Expand Available location hashtags to discover supported brands, shopping centres and suburbs. Search for a brand or choose Show all hashtags, then select a hashtag to browse matching locations and addresses. Suburb tags such as #brunswick use approximate suburb centres.',
					'Use #bank for a bank or ATM reminder and #errand for a general task without a fixed destination. These can appear without a starting point or saved place. Bank reminders ask you to choose the bank or ATM yourself.'
				]
			},
			{
				title: 'Choose where to start',
				paragraphs: [
					'Use GPS or a starting-point pill. Under Locations, add or edit a place anywhere with a name, latitude, longitude and hashtags. Turn on Available as a starting point and save to show its pill beside the suburbs. The toggle defaults to off. It remains a destination either way. Editing the selected place updates it; disabling or deleting it clears the selection.',
					'The edit icon opens Hot suburbs to add, remove and rearrange Melbourne suburb shortcuts, then Save. Saved custom locations work worldwide without GPS or a suburb catalogue. The starting point’s hashtags do not restrict results: your tasks’ hashtags determine which destinations match.',
					'The app saves your last starting point and syncs it across your devices. Check its label and update time before relying on the distance shown, particularly when it says Last GPS location. GPS is requested when you press the button, rather than tracked in the background.',
					'The No filter pill always appears first. It shows hashtag-matched errands at any distance without needing a starting point, and hides the radius and distances. This choice syncs and is included in backups. Choose GPS or a starting-point pill to restore the distance filter.',
					'Choose a radius from 1 to 50 km when filtering by location. Distances are straight-line distances from the starting point, rather than driving distances or travel times. Directions opens Google Maps for the destination. Some locations are approximate centre or suburb points, so read the location labels.'
				]
			},
			{
				title: 'Use the checklist and suggested stops',
				paragraphs: [
					'Errands inheriting hashtags from the same parent list are grouped together. Tasks with their own recognised errand hashtags stay separate. Expand a group to see and control its individual tasks. Items per pill sets how many task names appear in a preview; it does not limit which tasks are considered. Matched tasks can include reminders outside the current radius with an explanation.',
					'Suggested stops chooses places covering your active matched errands, and Alternatives shows other matching places. Stops are nearest first when using a starting point, or alphabetical with No filter. The suggestions help cover your tasks but do not optimise a driving route. Increase the radius, choose No filter or add a matching personal location if a task has no nearby match.',
					'Tick a todo to complete the original task. With named checkboxes, this controls the final completion checkbox and preserves earlier checks. Notes have no completion checkbox. Tap task text to open its source list; the 🚗 return icon on the highlighted item takes you back to Nearby errands.'
				]
			},
			{
				title: 'Pause, dismiss and add places',
				paragraphs: [
					'The pause icon defers an individual errand without changing its original item. Find it under Paused errands and use Resume when ready. You can also pause all errands for a hashtag from the hashtag browser. If both an item and its tag are paused, resume both for it to return.',
					'The × dismisses an item from errands without deleting it. Clear completed removes checked rows from the errands checklist without unchecking their original tasks. Edited dismissed notes or incomplete tasks can return; cleared completed todos become eligible again when unchecked.',
					'Use Locations to add a personal place with coordinates and matching hashtags. Personal locations, starting points, hot suburbs and errand pauses sync and are included in backups. Archived content, headings and completed todos are excluded from active suggestions. Items in completed lists need their own recognised errand hashtags to participate. Adding or deleting a personal place can change whether its hashtag overrides the list. The bundled catalogue is available offline, while opening map directions needs the map service.'
				]
			}
		],
		related: ['moving-links', 'tasks-notes', 'sync-backups']
	},
	{
		id: 'settings',
		title: 'Settings, Quick Add & shortcuts',
		icon: '⚙',
		summary: 'Adjust appearance, input behaviour, your capture list and keyboard controls.',
		sections: [
			{
				title: 'Make the app comfortable to use',
				paragraphs: [
					'Open ⚙ Settings from the home header. Changes to appearance and input preferences take effect as you choose them. These preferences are saved for your signed-in user in the current browser, so you can use different arrangements on a phone and a desktop.',
					'Theme chooses Light or Dark. Item spacing adjusts the space between rows: reduce it to fit more work on screen, or increase it for easier reading and tapping. Handedness changes the placement of floating input controls. Report font size controls Smart Reports and the favourites report separately from normal list text.',
					'Currency selects the symbol shown with prices. It changes presentation, not the numeric values or their currency conversion. Select a symbol that matches the amounts you entered in your priced lists.'
				]
			},
			{
				title: 'Choose where additions appear',
				paragraphs: [
					'Add items to chooses Top or Bottom for normal additions to a list. Add lists & folders to controls new entries within the current folder. Parent here: add items to controls repeated additions beneath the parent selected with Parent here.',
					'These settings determine insertion positions. They do not sort or rearrange existing entries. Use drag handles when you want to change the current order. Different settings can suit different workflows: put quick tasks at the top while adding dated lists at the bottom.'
				]
			},
			{
				title: 'Set up Quick Add',
				paragraphs: ['Quick Add captures a task or note from the home header without opening its destination list first. Configure the destination under Settings → Quick Add.'],
				steps: [
					'Choose the Top Level Folder that should contain your capture list. The selector shows active top-level folders.',
					'Enter the Quick List Name, such as Inbox. A blank name falls back to Quick List.',
					'Return to the home screen, open Quick Add, enter your text and choose whether it is a todo or note.',
					'Confirm the entry. The app uses an active list with that name in the chosen folder, or creates a plain list if needed. Open the destination later to review and organise your captures.'
				],
				bullets: ['If the chosen folder no longer exists, Quick Add uses the first active top-level folder. If there is no active top-level folder, it creates General. Check the destination setting after reorganising folders.']
			},
			{
				title: 'Keyboard controls and nearby return',
				paragraphs: [
					'Configure Shortcuts opens bindings for Up one level, Up, Down and Open. Select a binding button, then press the key combination you want to use. You can include modifiers such as Ctrl, Alt, Shift or Meta. Reset to Default restores the supplied bindings.',
					'Up and Down move the active selection through rows, and Open opens or edits the selected entry. Shortcut handling gives text entry priority, so ordinary typing in an input does not navigate away. Use the visible back and breadcrumb controls whenever you prefer touch navigation.',
					'Settings → Nearby errands controls the return icon shown on items opened from that screen. Leave it enabled for a quick return to your errand suggestions, or turn it off to hide the icon. The highlighted item still opens in its source list.',
					'The same Settings screen provides Download backup, restore options, Tidy local cache, Sign out and the app version. Read the Sync, backups & history help before restoring data. Use Back from help to return to these settings without changing your preferences.'
				]
			}
		],
		related: ['getting-started', 'nearby-errands', 'sync-backups']
	},
	{
		id: 'sync-backups',
		title: 'Sync, backups & history',
		icon: '🕒',
		summary: 'Work offline, download and restore backups, undo changes and view saved versions.',
		sections: [
			{
				title: 'Local work and multi-device sync',
				paragraphs: [
					'The app stores your working data locally in the browser so lists can open quickly and remain usable offline. Sign in and let your data load while connected before relying on offline access. Changes sync to your account when the server is reachable; other devices must use the same account.',
					'Check the sync indicator when moving between devices. If a recent change is missing, let both devices reconnect and finish syncing. A local browser preference, such as theme or a destination mark, can differ between devices because it is stored on that device rather than synced with lists.',
					'The app can be used in a browser or installed as a home-screen web app using the browser’s install controls. This help text is included in the app, so it does not need a separate help service once the app is available offline.'
				]
			},
			{
				title: 'Download a separate backup',
				paragraphs: [
					'Open Settings → Backup & Restore and choose Download backup. Save the JSON file somewhere you can find later. Its filename includes the download date. A downloaded file gives you a separate copy outside the browser’s working cache.',
					'Backups include folders, lists, item text and attributes, favourite status and ordering, Smart Folder assignments, personal locations, your starting point, hot suburbs and saved errand state. They do not include browser settings, destination marks or the Version History collection. Rich-text note formatting is not preserved in this JSON export.',
					'Spreadsheet records are backed up as names and metadata only; spreadsheet cell content is not included. The app’s spreadsheet screen directs you to an external spreadsheet application. The bundled public location catalogue is part of the app itself and is not duplicated into your backup.'
				]
			},
			{
				title: 'Restore a backup deliberately',
				paragraphs: ['Choose the restore mode before selecting Restore from file, then read the confirmation showing what will be imported. Download a fresh backup first if you may need your current data later.'],
				bullets: [
					'Merge updates records with matching IDs and adds records with new IDs, while keeping other existing records. This is not a merge by visible name: two differently identified lists with the same name can both remain.',
					'Replace all deletes existing data and restores the selected file. Optional data absent from an older backup can be cleared, including personal locations and saved errand information.',
					'Restored changes affect the account’s shared data and can sync to other devices. Do not treat a restore as a private preview. Restore is disabled while viewing history.'
				]
			},
			{
				title: 'Undo and saved versions',
				paragraphs: [
					'Use Undo last action from the home header or a list’s header menu to reverse an available recent action. The confirmation tells you how many actions are available. Undo is for recent editing; a downloaded backup is a separate recovery copy.',
					'Open 🕒 Version History to save a named commit of your data. Give the version a meaningful name, such as Before reorganising, and select Commit. Select View beside a saved version to browse its historical contents.',
					'Historical views are read-only. A banner identifies the view, and its Exit button returns to current data. Viewing a version does not roll back the live document. Help remains available from Settings while you are browsing history.',
					'Tidy local cache compacts stored local updates while keeping offline changes and saved history. It also runs automatically. Use the button in Settings if needed, and check any displayed error. If local data is still loading, wait before attempting cache maintenance.'
				]
			}
		],
		related: ['settings', 'smart-reports', 'favourites']
	}
];
