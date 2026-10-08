# Nearby errands: mathematical specification

Source transcription, 2026-10-08. This specifies the current feature's decisions and state transitions, including its ordering and presentation rules. Catalogue records are input data; shared Yjs, rich-text, JSON, hashing, browser and generic CRUD semantics are named primitives. It is not a formal equivalence proof. The companion `.tex` file typesets this document.

## 1. Notation and inputs

$\bot$ means absent; $\epsilon$ is the empty sequence. $q\mathbin{\Vert}r$ concatenates sequences. $[x\in q:P(x)]$ filters without reordering. $\operatorname{uniq}(q)$ keeps first occurrences; $\operatorname{uniq}_{id}$ does so by item ID. $\operatorname{ids}(q)$ is a set. $\operatorname{head}(\epsilon)=\bot$. Sorting is stable, so comparison equality preserves input order. $\prec_c$ is the runtime's `localeCompare` ordering; $\prec_u$ is its UTF-16 string ordering, and string lengths count UTF-16 code units. $\mathbf1_P$ is $1$ when $P$ holds, otherwise $0$. Write $x.lat,x.lon$ for the record fields `latitude,longitude`.

Let $I$ be the stored item sequence, $L,F$ the list/folder maps, $B$ the bundled retail sequence, $U$ the suburb sequence, and $X$ the insertion-ordered custom-location map. Let

$$
\begin{aligned}
D&=B\mathbin{\Vert}\operatorname{suburbLocations}(U)\mathbin{\Vert}\operatorname{values}(X),\\
\Sigma&=(I,L,F,X,Q,P_T,P_I,s,f,p,h;\rho,\eta,v,\lambda,e,\nu).
\end{aligned}
$$

$Q$ maps item IDs to checklist records $(\phi,\delta)$: saved fingerprint and dismissed flag. $P_T,P_I$ are paused tags and item IDs. $s$ is the stored starting-location record; $f$ enables location filtering; $p$ is the pill preview limit; $h$ is the hot-suburb sequence. Local state: radius $\rho$, historical-view flag $\eta$, GPS request generation $v$, locating flag $\lambda$, location error $e$, navigation state $\nu$. All predicates below are recomputed from the current live or historical snapshot.

The input records are those produced by `readAllItems`, `readLists` and `readFolders`: absent item booleans are false, absent item order is $0$, absent parent is $\bot$, price/quantity/timestamps default to $\bot$, and legacy checkbox maps are overlaid by per-checkbox keys (only literal `true` counts). Record identity and remaining fields are retained. Folder parent links are resolved by the same cycle rule as item links below.

## 2. Tags and destinations

$H(a)$ scans a name from left to right for `#word` tokens preceded by start-of-string or runtime whitespace, lowercases the captured words, and retains duplicates. Here `word` is one or more ASCII letters, digits or underscores, matching the source's `\w`; punctuation terminates it.

For a tag $t$, trim whitespace, remove one leading `#`, and lowercase to obtain $t_0$. With $\mathcal A$ the map in `src/lib/locations/brand-aliases.json`, overridden by the following three entries, normalize by one lookup:

$$
\begin{gathered}
\mathcal A[\mathrm{wooloworths}]=\mathcal A[\mathrm{woolworth}]
=\mathcal A[\mathrm{woolies}]=\mathrm{woolworths},\\
n(t)=\begin{cases}\mathcal A[t_0],&t_0\in\operatorname{dom}\mathcal A,\\t_0,&\text{otherwise}.\end{cases}
\end{gathered}
$$

Location support, recognized errand tags, and ordered matching tags are

$$
\begin{aligned}
S_0(d)&=\{n(t):t\in d.tags\},\\
S(d)&=S_0(d)
\cup\{\mathrm{supermarket}:S_0(d)\cap\{\mathrm{coles},\mathrm{woolworths},\mathrm{aldi}\}\ne\varnothing\}\\
&\quad\cup\{\mathrm{hardware}:S_0(d)\cap\{\mathrm{bunnings},\mathrm{mitre10},\mathrm{homehardware}\}\ne\varnothing\}\\
&\quad\cup\{\mathrm{pcparts}:S_0(d)\cap\{\mathrm{scorptec},\mathrm{centrecom},\mathrm{cpl},\mathrm{msy}\}\ne\varnothing\},\\
G&=\{\mathrm{bank},\mathrm{errand}\},\qquad K=G\cup\bigcup_{d\in D}S(d),\\
M(t,d)&=[a\in\operatorname{uniq}([n(x):x\in t]):a\in S(d)].
\end{aligned}
$$

Conditional singleton sets are empty when their condition is false. Recognition uses all destinations, independent of radius, starting-point status or pauses. Matching needs any supported tag. No shopping-centre, brand-frequency or route preference is added.

For each suburb $u$, its destination has ID `suburb-` concatenated with $u.id$, name $u.name$ followed by ` (suburb centre)`, its catalogue coordinates/source, accuracy class `suburb`, and the single tag

$$
\operatorname{suburbTag}(u)=\operatorname{keep}_{a\ldots z,0\ldots9}
\bigl(\operatorname{lower}(\operatorname{strip}_{0300\ldots036f}(\operatorname{NFKD}(u.name)))\bigr).
$$

## 3. Source order, completion and candidates

Within each list, a missing parent becomes $\bot$. In each parent cycle, the node with smallest ID under $\prec_u$ becomes a root. Sort every sibling sequence by $(order,id_{\prec_u})$ and traverse roots in preorder, visiting a parent before its children. Concatenate lists in their first-occurrence order in $I$; call the resulting sequence $T(I)$. Resolve/order the full tree before filtering. These repairs affect the read snapshot, not stored parent links.

Discard missing-list items. For an item $i$ whose list exists, let $\ell=L[i.listId]$, $b(i)$ be the named-checkbox sequence of its list's direct folder (empty if absent), and $\operatorname{anc}(\ell)$ be that folder and all existing ancestors, stopping at a missing parent or a repeated ID. Define

$$
\begin{aligned}
\operatorname{arch}(\ell)&=\ell.archived\lor\bigvee_{a\in\operatorname{anc}(\ell)}a.archived,\\
\operatorname{checked}(i)&=
\begin{cases}i.checks[\operatorname{last}(b(i)).id]=\mathrm{true},&|b(i)|>0,\\i.checked,&|b(i)|=0,\end{cases}\\
d_i&=\neg i.note\land\operatorname{checked}(i),\\
j_i&\iff\{n(t):t\in H(i.name)\}\cap K=\varnothing,\\
\tau_i&=\begin{cases}
\operatorname{uniq}\bigl(H(i.name)\mathbin{\Vert}H(\ell.name)\bigr),&j_i,\\
H(i.name),&\neg j_i,
\end{cases}\\
C_b&=[i\in T(I):\ell\ne\bot\land\ell.type\ne\mathrm{divider}\land\neg\operatorname{arch}(\ell)
\land\neg i.heading\\
&\hspace{35mm}\land(b\lor\neg d_i)\land\neg(\ell.done\land j_i)\land|\tau_i|>0],\\
C&=C_{\mathrm{true}}.
\end{aligned}
$$

Each candidate carries $(i,\ell,\tau_i,j_i)$. $C_{\mathrm{false}}$ is `collectErrands`' default result; the screen uses $C$. Notes ignore checked state. Folder names and parent-item tags contribute no inherited tags. Unrecognized item tags are retained alongside list tags; even an unmatched, unrecognized hashtag can produce a candidate. Completing a list excludes its inherited candidates, including notes, while explicitly recognized item errands remain eligible.

## 4. Fingerprints, pauses and checklist membership

Let $i\setminus order$ mean all fields of the resolved item record except `order`. Let $\operatorname{text}(i)$ be its current Yjs rich-text delta when a `Y.Text` exists, otherwise its name. Define

$$
\phi_i=\operatorname{hex}_{\mathrm{lower}}\!\left(
\operatorname{SHA256}\!\left(\operatorname{UTF8}\!\left(\operatorname{JSON}\!\left(
\operatorname{stable}\{item:i\setminus order,\ listName:\ell.name,\ done:d_i,\ text:\operatorname{text}(i)\}
\right)\right)\right)\right).
$$

$\operatorname{stable}$ recursively reconstructs objects with keys sorted by $\prec_c$ and preserves array order; $\operatorname{JSON}$ retains the runtime's property-enumeration/serialization semantics. Equality is actual digest equality. List name is included for every item, including explicit errands; metadata, checkbox state, timestamps, resolved parent and rich-text formatting are included. Item `order` alone is excluded.

Only $Q$ entries with a 64-character lowercase hexadecimal fingerprint and a Boolean dismissed flag are read as checklist states. Write $q_i=Q[i.id]$ for a valid record; missing/invalid records give $q_i=\bot$. Define

$$
\begin{aligned}
z_i&\iff q_i\ne\bot\land q_i.\delta\land(d_i\lor q_i.\phi=\phi_i),\\
a_i&\iff i.id\in P_I\lor\exists t\in\tau_i:n(t)\in\{n(x):x\in P_T\},\\
o_i&=\operatorname{head}([n(t):t\in\tau_i,\ n(t)\in G]),\qquad \omega_i\iff o_i\ne\bot,\\
A&=[i\in C:\neg d_i\land\neg z_i\land\neg a_i],\\
W&=\{i.id:i\in A,\ \exists d\in D:|M(\tau_i,d)|>0\},\\
E&=[i\in C:\neg z_i\land\neg a_i\land
\bigl((d_i\land q_i\ne\bot)\lor(\neg d_i\land(i.id\in W\lor\omega_i\lor q_i\ne\bot))\bigr)],\\
P&=[i\in C:\neg d_i\land\neg z_i\land a_i],\qquad E^+=[i\in E:d_i].
\end{aligned}
$$

$A$ are active errands; $W$ are active tasks supported anywhere in the database; $E$ is the persistent checklist; $P$ is the paused list; $E^+$ are clearable completed rows. Computing $W$ does not validate coordinates or impose a radius. A previously remembered task can remain in $E$ after losing all location matches. An already-completed task without a remembered state is excluded from $E$. Optional tags apply to the whole task even if it also has other tags; the first optional tag in tag order supplies its label.

## 5. Starting point, distance and nearby stops

Resolve the stored starting point $s$ as follows. Invalid/absent records yield $\bar s=\bot$; GPS/suburb records yield themselves; custom records yield themselves with label/coordinates replaced by the referenced $X$ record exactly when it exists and has `startingPoint = true`, otherwise $\bot$.

$$
\begin{aligned}
\operatorname{valid}(x)&\iff\operatorname{finite}(x.lat)\land\operatorname{finite}(x.lon)
\land|x.lat|\le90\land|x.lon|\le180,\\
o&=\begin{cases}(\bar s.lat,\bar s.lon),&f\land\bar s\ne\bot,\\\bot,&\text{otherwise},\end{cases}\\
r(t)&=t\pi/180,\\
u(x,y)&=\sin^2\!\frac{r(y.lat-x.lat)}2
+\cos(r(x.lat))\cos(r(y.lat))\sin^2\!\frac{r(y.lon-x.lon)}2,\\
\Delta(x,y)&=2(6371.0088)\arcsin\sqrt{\min(1,\max(0,u(x,y)))},\\
m_d&=[i\in A:|M(\tau_i,d)|>0],\qquad
\Delta_o(d)=\begin{cases}\Delta(o,d),&o\ne\bot,\\\bot,&o=\bot.\end{cases}
\end{aligned}
$$

Distances are kilometres; arithmetic is evaluated with the source runtime's floating-point operations. Define the library function

$$
\begin{aligned}
D_o&=[d\in D:\operatorname{valid}(d)\land|m_d|>0\land(o=\bot\lor\Delta(o,d)\le\rho)],\\
\mathcal N(D,o,\rho,A)&=\begin{cases}
\epsilon,&o\ne\bot\land(\neg\operatorname{valid}(o)\lor\neg\operatorname{finite}(\rho)\lor\rho\le0),\\
\operatorname{sort}_{\prec_s}([(d,\Delta_o(d),m_d):d\in D_o]),&\text{otherwise}.
\end{cases}
\end{aligned}
$$

The screen's stops and reachable item IDs are

$$
Z=\begin{cases}\mathcal N(D,o,\rho,A),&\neg f\lor o\ne\bot,\\\epsilon,&f\land o=\bot,\end{cases}
\qquad R=\bigcup_{z\in Z}\operatorname{ids}(z.items).
$$

$\prec_s$ compares distance then location ID under $\prec_c$ when either distance is present (absent distance is $+\infty$); when both are absent, it compares location name then ID under $\prec_c$. Remaining ties retain input order. Thus a null library origin bypasses radius validation/filtering, but the screen with filtering enabled and no saved origin has no stops. The radius boundary is inclusive; destination coordinates are always validated. The screen starts with $\rho=5$ and offers $\{1,2,5,10,25,50\}$; it keeps the local radius when switching filter mode and resets it on remount.

## 6. Greedy selection, reverse pruning and assignment

Location-coverage errands and unavailable errands are

$$
A_L=[i\in A:\neg\omega_i\lor i.id\in R],\qquad A_\varnothing=[i\in A_L:i.id\notin R].
$$

For each stop, $J(z)=\operatorname{ids}(z.items)$. Starting with $U_0=R$ and $V_0=\epsilon$, repeat while $U_k\ne\varnothing$:

$$
\begin{aligned}
c_k(z)&=|J(z)\cap U_k|,\\
z_k&=\operatorname{first}_{Z}\left(\operatorname*{arg\,min}_{\prec_s}
\{z\in Z:c_k(z)=\max_{w\in Z}c_k(w)>0\}\right),\\
V_{k+1}&=V_k\mathbin{\Vert}[z_k],\qquad U_{k+1}=U_k\setminus J(z_k).
\end{aligned}
$$

Stop if no positive-coverage choice exists. Let the resulting sequence be $V=[v_1,\ldots,v_m]$. Put $V^{(m+1)}=V$; for $j=m,m-1,\ldots,1$:

$$
V^{(j)}=\begin{cases}
\operatorname{delete}_j(V^{(j+1)}),&J(v_j)\subseteq\displaystyle\bigcup_{w\in\operatorname{delete}_j(V^{(j+1)})}J(w),\\
V^{(j+1)},&\text{otherwise}.
\end{cases}
$$

Higher-index deletions leave the next tested position unchanged. Sort the retained stops: $[s_1,\ldots,s_t]=\operatorname{sort}_{\prec_s}(V^{(1)})$. With $B_0=\varnothing$, assign

$$
\begin{aligned}
e_j&=\operatorname{uniq}_{id}([i\in s_j.items:i.id\notin B_{j-1}]),\qquad B_j=B_{j-1}\cup\operatorname{ids}(e_j),\\
\mathrm{Suggested}&=[(s_j.location,s_j.distance,e_j):j=1,\ldots,t],\\
\mathrm{Alternatives}&=\operatorname{sort}_{\prec_s}([z\in Z:z.location.id\notin\{v.location.id:v\in V^{(1)}\}]),\\
\mathrm{Unavailable}&=A_\varnothing.
\end{aligned}
$$

Selection counts distinct item IDs, not groups. Pruning uses the current retained stops, in reverse selection order. Assignment uses final display order, keeps source item order within each stop, and assigns each item once. Alternatives retain their full matching item sequences. Input stops are unmodified. This specifies the implemented heuristic, with no global minimum-stop or driving-route objective. The exported planner accepts any supplied errand sequence in place of $A_L$ when computing unavailable items.

## 7. Groups, pills, previews and counts

For collected errands, group identity is

$$
g(i)=\begin{cases}(\mathrm{list},\ell.id),&j_i,\\(\mathrm{item},i.id),&\neg j_i.\end{cases}
$$

For externally supplied errands without `inheritsListTags`, its fallback is $j_i\iff|H(i.name)|=0$. Grouping $\Gamma(q)$ gathers rows by $g$, retaining first group occurrence and row order; distinct list IDs remain distinct even when names agree. Each group has fields `id`, `list`, `rows`, keeping its first row's list record. Group ID pairs encode the source's `list:` and `item:` keys. In group lists, a list group expands and shows a parent-list checkbox iff it has more than one row; otherwise its rows render directly. Inherited pill navigation still opens the list when its group has one row.

Task pills form an insertion-ordered map $\Pi$. Scan $Z$ and each stop's item sequence in order: on the first occurrence of an item ID with nonempty $M(\tau_i,d)$, insert $(i,\operatorname{clean}(i.name),\operatorname{head}(M(\tau_i,d)))$. Then scan $A$: for each optional task insert/overwrite $(i,\operatorname{clean}(i.name),o_i)$, preserving an existing key's position. Thus optional labels overwrite location-derived labels, and unmatched optional tasks append in $A$ order.

$$
\begin{aligned}
N&=\operatorname{ids}(\operatorname{values}(\Pi))=R\cup\{i.id:i\in A,\ \omega_i\},\\
T_a&=\operatorname{uniq}([\pi.tag:\pi\in\operatorname{values}(\Pi),\ g(\pi.item)=a]),\\
\mathrm{Pills}&=[(a.id,a.list,a.rows,\operatorname{preview}(a.rows,p),T_{a.id}):\\
&\hspace{18mm}a\in\Gamma([i\in A:|T_{g(i)}|>0])].
\end{aligned}
$$

Here $a.rows$ are all active rows in the retained group, including any sibling that has no individual match. Pill groups follow $A$ order, not stop order; pill tags follow first occurrence in $\Pi$.

$\operatorname{clean}$ removes every start/whitespace-prefixed `#word` token while preserving the preceding whitespace, collapses whitespace runs to one space, and trims. With $q_{:p}$ its first $\min(p,|q|)$ rows, string concatenation also written $\Vert$,

$$
\begin{aligned}
\operatorname{preview}(q,p)&=\operatorname{join}_{\text{ · }}([\operatorname{clean}(i.name):i\in q_{:p},\ \operatorname{clean}(i.name)\ne\text{empty}])\\
&\quad\mathbin{\Vert}\begin{cases}\text{ · +}(|q|-\min(p,|q|))\text{ more},&|q|>p,\\\text{empty},&|q|\le p.\end{cases}\\
\mathrm{ChecklistGroups}&=\operatorname{stableSort}_{-\mathbf1_{\exists i\in a.rows:i.id\in N}}(\Gamma(E)),\\
\mathrm{PausedGroups}&=\Gamma(P),\qquad \mathrm{LocationGroups}=\Gamma(A_L),\\
\mathrm{CoveredCount}&=|\{a\in\Gamma(A_L):\forall i\in a.rows,\ i.id\in R\}|.
\end{aligned}
$$

The preview consumes $p$ rows before excluding empty cleaned names; the remainder counts rows, not visible names. It never limits matching/planning. Checklist groups with any nearby/optional active task sort first; other group and row order is preserved. Counts for checklist, paused, missing-location lists and coverage are group counts. Stop cards show both $|\Gamma(stop.items)|$ errands and $|stop.items|$ tasks; alternatives count locations. The coverage denominator is $|\Gamma(A_L)|$, and the stop count is $|\mathrm{Suggested}|$.

For an unchecked checklist row, its explanation is selected in this order:

$$
\operatorname{reason}(i)=\begin{cases}
\text{choose bank/ATM or location yourself},&\omega_i\land i.id\notin R,\\
\text{no match within radius},&(o\ne\bot\lor\neg f)\land i.id\notin N\land f\land i.id\in W,\\
\text{no matching location in database},&(o\ne\bot\lor\neg f)\land i.id\notin N,\\
\text{empty},&\text{otherwise}.
\end{cases}
$$

Completed rows have no such explanation. Missing-location rows use the radius explanation iff $f\land i.id\in W$, otherwise the database explanation. Notes show a note mark and no completion checkbox. Only unchecked checklist rows have pause controls; all checklist rows can be dismissed.

## 8. Checklist and pause transitions

Every durable transition is disabled by the screen when $\eta$ is true; calling a data mutator directly in history raises the shared read-only error. Read-only local controls remain usable. Unmentioned state components remain unchanged. $t$ denotes the current timestamp.

For a supplied sequence of $(id,\phi)$ entries, `remember` updates exactly the absent entries or dismissed entries whose saved fingerprint differs:

$$
\operatorname{remember}(Q,id,\phi)=\begin{cases}
Q[id\mapsto(\phi,\mathrm{false})],&Q[id]=\bot\lor(Q[id].\delta\land Q[id].\phi\ne\phi),\\
Q,&\text{otherwise}.
\end{cases}
$$

After reactive recomputation in a live view, fold `remember` over $[i\in E:\neg d_i]$ using their current fingerprints. Ordinary remembered records are not refreshed on every edit. Automatic membership transactions use `NEARBY_CHECKLIST_MEMBERSHIP_ORIGIN` and create no undo entry. Dismissal sets $Q[i.id]\gets(\phi_i,\mathrm{true})$ for the selected current checklist row. Clear completed applies that assignment to every $i\in E^+$. Neither operation changes original item completion.

`setDone`$(id,\beta)$ first rejects missing items, notes and headings. If the item's list exists and its original completion is false, remember its current fingerprint before changing the checkbox. Then

$$
\begin{cases}
i.checks[\operatorname{last}(b(i)).id]\gets\beta,\quad i.updatedAt\gets t,&|b(i)|>0,\\
i.checked\gets\beta,\quad i.updatedAt\gets t,&|b(i)|=0\land i.checked\ne\beta,\\
\text{no item change},&|b(i)|=0\land i.checked=\beta.
\end{cases}
$$

Other checkbox values are retained. Setting group completion changes $\ell.done$ and $\ell.updatedAt$ only. Editing records/formatting changes the inputs to $\phi,C,A,E$; no explicit undismiss transition is required. A completed dismissed task remains hidden for any fingerprint; an unchecked/note task returns only when the saved and current fingerprints differ and the other eligibility predicates hold.

$$
\begin{aligned}
\operatorname{pauseTag}(x,b):\quad&P_T\gets\begin{cases}P_T\cup\{n(x)\},&b,\\P_T\setminus\{n(x)\},&\neg b,\end{cases}\\
\operatorname{pauseItem}(id,b):\quad&P_I\gets\begin{cases}P_I\cup\{id\},&b\land id\text{ exists},\\P_I,&b\land id\text{ is missing},\\P_I\setminus\{id\},&\neg b.\end{cases}
\end{aligned}
$$

Tag inputs must normalize to nonempty ASCII word strings; item IDs must be nonblank strings. Pauses are separate Yjs map keys with value `true`; reads retain valid true-valued entries and sort keys by $\prec_u$. Resuming an item removes only its individual pause; resuming a tag removes only that tag. Pauses have no expiry and survive edits. No completion/list/original item change is implied.

## 9. Location, preference and GPS transitions

Starting records require valid numeric coordinates; source in $\{gps,suburb,custom\}$; nonblank label; parseable timestamp string; a present accuracy field that is null (written $\bot$) or finite numeric $\ge0$. Custom sources additionally require a string reference beginning `custom-` with a nonempty suffix. Saving a custom starting point requires the referenced location to exist and be enabled, substitutes its current label/coordinates and sets accuracy to $\bot$. Saving any starting point atomically sets $(s,f)\gets(s_{new},\mathrm{true})$.

$$
\begin{aligned}
\operatorname{noFilter}:&(v,\lambda,e,f,\mathrm{showLocations},\mathrm{showDetails})
\gets(v+1,\mathrm{false},\text{empty},\mathrm{false},\mathrm{false},\mathrm{false}),\\
\operatorname{suburb}(u):&(v,\lambda,e)\gets(v+1,\mathrm{false},\text{empty});\quad
\operatorname{saveStart}(u.coords,suburb,u.name,\bot,t),\\
\operatorname{custom}(id):&(v,\lambda,e)\gets(v+1,\mathrm{false},\text{empty});\quad
\operatorname{saveStart}(X[id].coords,custom,X[id].name,\bot,t,id),\\
&\mathrm{showLocations}\gets\mathrm{false},\quad\mathrm{showDetails}\gets\mathrm{true}.
\end{aligned}
$$

Custom selection with a missing/disabled reference instead sets the unavailable-starting-point error and performs no cancellation/save. Clear-start deletes $s$ without changing $f$. No filter keeps $s$ and $\rho$. Starting-point tags never filter destinations. The starting-point shortcut sequence is No filter, GPS, $h$, then enabled custom locations in $X$ order; the editor button follows. Shortcut selection indicators require $f$ and matching source plus suburb label or custom ID. Origin label distinguishes saved GPS, approximate suburb centre and saved custom location; accuracy and update time are display metadata only.

The screen initially has $v=0$, $\lambda=\mathrm{false}$ and empty $e$. With geolocation available, GPS press increments $v$, captures $w=v$, sets $(\lambda,e)=(\mathrm{true},\text{empty})$, and requests one fix with `(enableHighAccuracy=true, timeout=15000 ms, maximumAge=60000 ms)`.

$$
\begin{aligned}
\operatorname{gpsSuccess}(w,c,a):\quad&w=v\land\neg\eta\Longrightarrow
\operatorname{saveStart}(c,gps,\text{Last GPS location},a,t);\ \lambda\gets\mathrm{false},\\
\operatorname{gpsError}(w,k):\quad&w=v\Longrightarrow
\lambda\gets\mathrm{false};\ e\gets\begin{cases}\text{permission denied},&k=1,\\\text{could not get location},&k\ne1.\end{cases}
\end{aligned}
$$

Rejected callbacks do nothing. Unsupported geolocation sets the unsupported-browser error and preserves the saved point. Failures preserve the saved point. Whenever the resolved starting-record/filter pair changes, a reactive effect increments $v$ and clears $\lambda$; unmount increments $v$. There is no background GPS request. The success guard also checks history; the error callback checks generation only.

Custom locations require unique nonblank IDs/names, valid coordinates, nonempty tag sequences whose strings match optional-`#` ASCII words, optional string address/source/centre, optional Boolean starting-point flag, and optional accuracy class in $\{store,shopping\text{-}centre,suburb\}$. Custom save additionally requires ID prefix `custom-`, trims name and stores normalized first-occurrence-unique tags. The form requires nonblank coordinate fields, uses runtime numeric conversion, splits tags on whitespace/commas, trims address and creates `custom-` plus a UUID for a new location; validation failure leaves stored state unchanged, success clears the form. Copy-coordinates uses $o$ only when present; cancel-edit clears the form.

On saving a selected custom location, atomically update its record and refresh $s$'s label, coordinates and timestamp iff both its old and new starting-point flags are true; otherwise delete $s$. Deleting a location atomically removes it and deletes $s$ iff $s$ references it; $f$ is unchanged. Reading $s$ also resolves the custom reference, so remote changes immediately affect origin availability. Enabling a previously disabled location cannot resurrect an old selection. Delete is committed only by the confirm control; cancellation clears the delete target.

Preference reads/defaults and accepted saves are

$$
\begin{aligned}
f&=(\text{stored filter value}\ne\mathrm{false}),\quad \text{saves require a Boolean},\\
p&=\begin{cases}\min(p_0,9),&p_0\in\mathbb Z\cap[1,50],\\3,&\text{otherwise},\end{cases}
\quad\text{saves require }p_0\in\mathbb Z\cap[1,9],\\
h&=\begin{cases}h_0,&h_0\text{ is a unique sequence of known suburb IDs},\\
[id(\mathrm{Melbourne}),id(\mathrm{Brunswick}),id(\mathrm{Richmond})],&\text{otherwise}.
\end{cases}
\end{aligned}
$$

Saving $h$ validates uniqueness and known IDs and leaves $s,f$ unchanged. Legacy imported preview limits $10\ldots50$ are accepted but read/export as $9$.

## 10. Hashtag browser, suburb editor and navigation

For every $a\in K$, the hashtag count is $c_a=|\{d.id:d\in D,a\in S(d)\}|$; only optional tags may be added with zero count. The complete tag sequence sorts by $\prec_c$. Search reduces the normalized query $n(q)$ to ASCII word characters, then retains tags containing that substring. With nonblank raw query or Show all enabled, display all search matches; otherwise display the first twelve under $(-c_a,a_{\prec_c})$. Selected-tag locations are all matching destinations, sorted by $(name_{\prec_c},address_{\prec_c})$, absent address treated as empty, with stable remaining ties. Selecting a tag replaces the panel; close clears selection; pause-all toggles only that tag. No origin/radius/coordinate validation is applied to this browser.

The hot-suburb editor takes a local copy $h^*$ of $h$. Add appends only an absent known ID and clears query; remove filters out the ID; keyboard move swaps with the adjacent entry if in bounds. Drag starts only for the primary pointer's left button, remembers pointer/source/target IDs, accepts only that pointer, and on release moves the source to the target's original index if both exist and differ. Cancel/lost capture clears drag state. Save validates/stores $h^*$; Cancel/back discards it. The main starting point is unchanged.

Suburb search normalization $\alpha$ applies NFKD, removes combining characters $0300\ldots036f$, lowercases, expands word-boundary `mt` with optional period and following whitespace to `mount `, replaces runs outside ASCII letters/digits with a space, then trims. Let $q=\alpha(input)$ and $a=\alpha(suburb.name)$. Fuzzy distance is the following substring/transposition recurrence:

$$
\begin{aligned}
D_{0,j}&=0,\qquad D_{i,0}=i,\\
D_{i,j}&=\min\left\{D_{i,j-1}+1,D_{i-1,j}+1,D_{i-1,j-1}+\mathbf1_{q_i\ne a_j},
\begin{cases}D_{i-2,j-2}+1,&i,j>1\land q_i=a_{j-1}\land q_{i-1}=a_j,\\+\infty,&\text{otherwise}\end{cases}\right\},\\
\operatorname{fd}(q,a)&=\min_{0\le j\le|a|}D_{|q|,j},\qquad
\theta(q)=\begin{cases}0,&|q|<3,\\\min(3,\max(1,\lfloor|q|/4\rfloor)),&|q|\ge3,\end{cases}\\
\operatorname{score}(q,a)&=\begin{cases}0,&q=a,\\1,&a\text{ starts with }q,\\2,&a\text{ contains }q,\\3+\operatorname{fd}(q,a),&\theta(q)>0\land\operatorname{fd}(q,a)\le\theta(q),\\+\infty,&\text{otherwise}.\end{cases}
\end{aligned}
$$

Empty $q$ or nonpositive result limit gives no results; otherwise retain finite scores, sort by $(score,|name|,name_{\prec_c},id_{\prec_c})$, and take the result limit (default $8$). The picker opens and resets active index on focus/input; blur/Escape close it. An arrow opens a closed picker at index $0$, otherwise wraps the active index modulo result count. Enter chooses the active result only when the picker is expanded (open with nonblank raw input); a result click also chooses. Choosing sets query to the suburb name, closes, resets index and invokes the consumer; editor add then clears the query. Clear empties query, closes, resets index, invokes its clear callback and focuses input; focus can reopen it but the empty query keeps results unexpanded.

Navigation for a pill with group $a$ sets

$$
\begin{aligned}
(\mathrm{showNearby},\mathrm{openList},\mathrm{openItem},\mathrm{returnTarget})
&\gets\begin{cases}(\mathrm{false},\ell.id,\bot,(\ell.id,\bot)),&a\text{ is a list group},\\
(\mathrm{false},\ell.id,i.id,(\ell.id,i.id)),&a\text{ is an item group},\end{cases}\\
\operatorname{returnNearby}:\quad
(\mathrm{showNearby},\mathrm{openList},\mathrm{openItem},\mathrm{returnTarget})
&\gets(\mathrm{true},\bot,\bot,\bot).
\end{aligned}
$$

Clicking any individual row opens its list and highlights its item. The return action is supplied only while the open list/item equals the saved target; navigating elsewhere clears that target. The return-link preference defaults true and is stored per user in local storage. If enabled, the return icon is in the list header for a list target and on the highlighted row for an item target. This preference does not sync through the nearby Yjs state.

Directions use $d.address$ iff its accuracy class is `suburb` and its address is nonempty; otherwise use the numeric `latitude,longitude` string. Append its runtime URI-encoded value to `https://www.google.com/maps/dir/?api=1&destination=`. The origin is not included. Distance labels use rounded $1000\Delta$ metres for $\Delta<1$, otherwise one decimal kilometre. Shopping-centre/suburb accuracy labels affect explanations/directions only. Alternative cards render only while their initially collapsed panel is expanded. Suggestions/alternatives are hidden when $f\land o=\bot$ or the location editor is open; the pill strip remains available. With an empty checklist/active sequence, the empty-state message distinguishes remaining paused rows from no eligible tasks.

## 11. Persistence, history, undo and backups

$X,Q,P_T,P_I,s,f,p,h$ live in the user's Yjs document: `custom-locations`, `nearby-checklist`, `paused-errand-tags`, `paused-errand-items`, and `nearby-preferences`. Reload/remote updates change the snapshot and recompute the equations. Custom places, pause keys and checklist entries are independent map entries; a starting record is one value so its coordinates/metadata stay together. Concurrent conflict resolution is exactly Yjs's shared map/sequence semantics, not wall-clock timestamp comparison. Undo follows the shared Yjs undo manager; automatic checklist membership is explicitly excluded, while user mutations participate. Historical reads use the selected historical document, and durable mutations are prohibited. The bundled catalogue is shared input data, not copied into user backups.

Nearby backup export is $(X,\bar s,f,h,p,Q,P_T,P_I)$ using their read functions. Validate the entire backup before any mutation, including generic records. Nearby validation uses the location/starting/checklist/preview/hot-suburb constraints above; imported paused tags must match optional-`#` ASCII words, paused IDs must be nonblank, filter must be Boolean, checklist keys must be nonempty, and custom IDs must have the required prefix. Invalid import leaves existing state unchanged. A structurally valid custom starting reference need not exist/be enabled at import; subsequent read resolution may yield $\bot$.

For merge/replace mode $m$, let $Y_b$ denote a supplied backup field. Import custom/checklist maps and pause sets by

$$
\begin{aligned}
X'&=(\mathbf1_{m=merge}X)\mathbin{\oplus}X_b,\qquad
Q'=(\mathbf1_{m=merge}Q)\mathbin{\oplus}Q_b,\\
P_T'&=(\mathbf1_{m=merge}P_T)\cup\{n(t):t\in P_{T,b}\},\qquad
P_I'=(\mathbf1_{m=merge}P_I)\cup P_{I,b},\\
s'&=\begin{cases}s_b,&s_b\text{ is non-null and supplied},\\\bot,&m=replace\lor s_b\text{ is explicitly null},\\s,&\text{otherwise},\end{cases}\\
y'&=\begin{cases}y_b,&y_b\text{ supplied},\\\bot,&m=replace,\\y,&\text{otherwise},\end{cases}\qquad y\in\{f,h,p\}.
\end{aligned}
$$

$\mathbf1_{m=merge}Y$ means keep $Y$ in merge mode, otherwise start empty; $\oplus$ upserts entries with backup values winning. Missing map/set fields contribute empty collections. Imported custom records/tags are stored as supplied; normalization applies when reading/matching or explicitly saving. Missing preferences in replace mode are deleted, so read defaults apply. Importing a starting point does not implicitly enable filtering; $s,f$ are independent import fields. Merge of a legacy backup preserves absent nearby fields; replace clears them. These mutations share the import transaction and are undoable through the existing application mechanism.

## 12. Source correspondence

Definitions 2 and 5: `tags.ts`, `retailLocations.ts`, `suburbLocations.ts`, `startingLocation.ts`. Definitions 3 and 6: `hierarchy.ts`, `nearbyErrands.ts`, `data.ts` (`isItemDone`, effective archiving). Definition 4 and transitions 8: `nearbyChecklist.ts`, `data.ts` (fingerprint, membership, dismissal, pauses, completion). Definition 7: `errandGroups.ts`, `nearbyPills.ts`, `NearbyErrandsScreen.svelte`. Transitions 9: `data.ts`, `hotSuburbs.ts`, GPS/selection handlers in the screen. Definition 10: screen, `HotSuburbsScreen.svelte`, `SuburbPicker.svelte`, `suburbSearch.ts`, nearby navigation in `HomeScreen.svelte`/`ListScreen.svelte`, `settings.svelte.ts`. Definition 11: nearby backup handlers in `data.ts` and shared `yjsStore.svelte.ts`.
