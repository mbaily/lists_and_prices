"""
nearby_errands.py
=================
Reference Python library implementing the formal mathematical specification
from `nearby-errands-math.md` (Revised 2026-10-14).

This module implements:
1. Notation, UTF-16/locale comparators, and input record normalization
2. Hashtag extraction, brand-alias normalization, and destination support sets
3. Hierarchy cycle repair, preorder traversal, and errand candidate collection
4. Stable JSON SHA-256 fingerprinting, pauses, and checklist membership
5. Starting-point resolution, haversine distance, and nearby stop calculation
6. Greedy set-cover stop selection, reverse pruning, and item assignment
7. Errand grouping, pill previews, coverage counts, and row explanations
8. Checklist, completion, and pause state transitions
9. Location, preference, custom place CRUD, and GPS generation transitions
10. Hashtag browser, hot-suburb editor, fuzzy suburb search, and navigation
11. Backup validation, export, and merge/replace import semantics
"""

from __future__ import annotations

import copy
import dataclasses
from dataclasses import dataclass, field
import datetime
import functools
import hashlib
import json
import math
import re
import unicodedata
import uuid
from typing import Any, Callable, Dict, Iterable, List, Optional, Sequence, Set, Tuple, Union


class ReadOnlyError(RuntimeError):
    """Raised when attempting a durable mutation while historical view (eta) is active."""


class ValidationError(ValueError):
    """Raised when input or backup validation fails."""


EARTH_RADIUS_KM: float = 6371.0088
VALID_RADII: Tuple[int, ...] = (1, 2, 5, 10, 25, 50)
DEFAULT_RADIUS: float = 5.0
OPTIONAL_TAGS: Set[str] = {"bank", "errand"}
NEARBY_CHECKLIST_MEMBERSHIP_ORIGIN: str = "NEARBY_CHECKLIST_MEMBERSHIP_ORIGIN"

DEFAULT_BRAND_ALIASES: Dict[str, str] = {
    "wooloworths": "woolworths",
    "woolworth": "woolworths",
    "woolies": "woolworths",
}

SUPERMARKET_BRANDS: Set[str] = {"coles", "woolworths", "aldi"}
HARDWARE_BRANDS: Set[str] = {"bunnings", "mitre10", "homehardware"}
PCPARTS_BRANDS: Set[str] = {"scorptec", "centrecom", "cpl", "msy"}

ACCURACY_CLASSES: Set[str] = {"store", "shopping-centre", "suburb"}
STARTING_SOURCES: Set[str] = {"gps", "suburb", "custom"}
HEX64_RE = re.compile(r"^[0-9a-f]{64}$")
HASHTAG_SCAN_RE = re.compile(r"(?:^|\s)#([A-Za-z0-9_]+)")
HASHTAG_CLEAN_RE = re.compile(r"(^|\s)#[A-Za-z0-9_]+")
OPTIONAL_HASH_WORD_RE = re.compile(r"^#?[A-Za-z0-9_]+$")
ASCII_WORD_RE = re.compile(r"^[A-Za-z0-9_]+$")


def utf16_code_units(text: str) -> bytes:
    """Return big-endian UTF-16 bytes representing exact UTF-16 code units."""
    return text.encode("utf-16-be")


def utf16_len(text: str) -> int:
    """Return string length measured in UTF-16 code units."""
    return len(text.encode("utf-16-be")) // 2


def compare_utf16(a: str, b: str) -> int:
    """Compare two strings under runtime UTF-16 code unit ordering (prec_u)."""
    ua, ub = utf16_code_units(a), utf16_code_units(b)
    return -1 if ua < ub else (1 if ua > ub else 0)


def default_locale_compare(a: str, b: str) -> int:
    """
    Default deterministic approximation of runtime localeCompare (prec_c).
    Compares case-insensitively first, then by case/code-unit tie-breaker.
    """
    if a == b:
        return 0
    ca, cb = a.casefold(), b.casefold()
    if ca != cb:
        return -1 if ca < cb else 1
    # In standard JS localeCompare, lowercase precedes uppercase for same letter
    sa, sb = a.swapcase(), b.swapcase()
    if sa != sb:
        return -1 if sa < sb else 1
    return compare_utf16(a, b)


def make_sort_key(cmp_func: Callable[[str, str], int]) -> Callable[[str], Any]:
    """Convert a string comparator into a Python sort key."""
    return functools.cmp_to_key(cmp_func)


LOCALE_KEY = make_sort_key(default_locale_compare)
UTF16_KEY = make_sort_key(compare_utf16)


def uniq(seq: Iterable[Any]) -> List[Any]:
    """Keep first occurrences in sequence order: uniq(q)."""
    seen: Set[Any] = set()
    out: List[Any] = []
    for x in seq:
        if x not in seen:
            seen.add(x)
            out.append(x)
    return out


def uniq_id(seq: Iterable[Any]) -> List[Any]:
    """Keep first occurrences by .id attribute or ['id'] key: uniq_id(q)."""
    seen: Set[str] = set()
    out: List[Any] = []
    for x in seq:
        item_id = x.id if hasattr(x, "id") else x["id"]
        if item_id not in seen:
            seen.add(item_id)
            out.append(x)
    return out


def ids(seq: Iterable[Any]) -> Set[str]:
    """Extract the set of item IDs from a sequence: ids(q)."""
    return {(x.id if hasattr(x, "id") else x["id"]) for x in seq}


def head(seq: Sequence[Any]) -> Optional[Any]:
    """Return first element of sequence or None (bot) if empty."""
    return seq[0] if len(seq) > 0 else None


@dataclass
class NamedCheckbox:
    id: str
    name: str = ""


@dataclass
class FolderRecord:
    id: str
    name: str = ""
    parentId: Optional[str] = None
    archived: bool = False
    checkboxes: List[NamedCheckbox] = field(default_factory=list)
    extra: Dict[str, Any] = field(default_factory=dict)


@dataclass
class ListRecord:
    id: str
    name: str = ""
    folderId: Optional[str] = None
    type: str = "list"
    archived: bool = False
    done: bool = False
    updatedAt: Optional[str] = None
    extra: Dict[str, Any] = field(default_factory=dict)


@dataclass
class ItemRecord:
    id: str
    listId: str
    name: str = ""
    parentId: Optional[str] = None
    order: float = 0.0
    checked: bool = False
    note: bool = False
    heading: bool = False
    checks: Dict[str, bool] = field(default_factory=dict)
    price: Optional[float] = None
    quantity: Optional[float] = None
    createdAt: Optional[str] = None
    updatedAt: Optional[str] = None
    yTextDelta: Optional[Any] = None
    extra: Dict[str, Any] = field(default_factory=dict)

    def to_raw_dict(self, omit_order: bool = False) -> Dict[str, Any]:
        """Convert resolved item record to dictionary for fingerprinting."""
        d: Dict[str, Any] = {
            "id": self.id,
            "listId": self.listId,
            "name": self.name,
            "parentId": self.parentId,
            "checked": self.checked,
            "note": self.note,
            "heading": self.heading,
            "checks": dict(self.checks),
            "price": self.price,
            "quantity": self.quantity,
            "createdAt": self.createdAt,
            "updatedAt": self.updatedAt,
        }
        if not omit_order:
            d["order"] = self.order
        for k, v in self.extra.items():
            if k not in d and (not omit_order or k != "order"):
                d[k] = copy.deepcopy(v)
        return d


@dataclass
class SuburbRecord:
    id: str
    name: str
    latitude: float
    longitude: float
    address: Optional[str] = None
    source: Optional[str] = None


@dataclass
class LocationRecord:
    id: str
    name: str
    latitude: float
    longitude: float
    tags: List[str] = field(default_factory=list)
    address: Optional[str] = None
    source: Optional[str] = None
    centre: Optional[str] = None
    startingPoint: bool = False
    accuracyClass: Optional[str] = None

    @property
    def lat(self) -> float:
        return self.latitude

    @property
    def lon(self) -> float:
        return self.longitude


@dataclass
class ChecklistStateRecord:
    phi: str  # 64-character lowercase hex fingerprint
    delta: bool  # dismissed flag


@dataclass
class StartingLocationRecord:
    latitude: float
    longitude: float
    source: str  # 'gps' | 'suburb' | 'custom'
    label: str
    timestamp: str
    accuracy: Optional[float] = None
    customId: Optional[str] = None

    @property
    def lat(self) -> float:
        return self.latitude

    @property
    def lon(self) -> float:
        return self.longitude


@dataclass
class ErrandCandidate:
    item: ItemRecord
    list_rec: ListRecord
    effective_tags: List[str]  # tau_i
    inherits_list_tags: bool  # j_i

    @property
    def id(self) -> str:
        return self.item.id


@dataclass
class StopMatch:
    location: LocationRecord
    distance: Optional[float]
    items: List[ErrandCandidate]


@dataclass
class ErrandGroup:
    id: Tuple[str, str]  # ('list', list_id) or ('item', item_id)
    list: ListRecord
    rows: List[ErrandCandidate]

    @property
    def string_key(self) -> str:
        return f"{self.id[0]}:{self.id[1]}"


@dataclass
class TaskPillEntry:
    item: ErrandCandidate
    clean_name: str
    tag: str


@dataclass
class PillGroup:
    id: Tuple[str, str]
    list: ListRecord
    rows: List[ErrandCandidate]
    preview: str
    tags: List[str]


@dataclass
class NavigationState:
    showNearby: bool = True
    openList: Optional[str] = None
    openItem: Optional[str] = None
    returnTarget: Optional[Tuple[str, Optional[str]]] = None
    returnLinkEnabled: bool = True


@dataclass
class NearbyState:
    """Represents Sigma = (I, L, F, X, Q, P_T, P_I, s, f, p, h; rho, eta, v, lambda, e, nu)."""
    I: List[ItemRecord] = field(default_factory=list)
    L: Dict[str, ListRecord] = field(default_factory=dict)
    F: Dict[str, FolderRecord] = field(default_factory=dict)
    B: List[LocationRecord] = field(default_factory=list)
    U: List[SuburbRecord] = field(default_factory=list)
    X: Dict[str, LocationRecord] = field(default_factory=dict)
    Q: Dict[str, ChecklistStateRecord] = field(default_factory=dict)
    P_T: Set[str] = field(default_factory=set)
    P_I: Set[str] = field(default_factory=set)
    s: Optional[StartingLocationRecord] = None
    f: bool = True
    p: int = 3
    h: List[str] = field(default_factory=list)
    # Local ephemeral UI state
    rho: float = DEFAULT_RADIUS
    eta: bool = False
    v: int = 0
    locating: bool = False  # lambda
    e: str = ""
    nu: NavigationState = field(default_factory=NavigationState)
    showLocations: bool = False
    showDetails: bool = False
    brand_aliases: Dict[str, str] = field(default_factory=lambda: dict(DEFAULT_BRAND_ALIASES))
    undo_stack: List[str] = field(default_factory=list)


def read_all_items(raw_items: Iterable[Dict[str, Any]]) -> List[ItemRecord]:
    """
    Normalize raw item dictionaries according to Section 1:
    - Absent booleans are False, absent order is 0, absent parent is None.
    - Legacy checkbox maps are overlaid by per-checkbox keys (`check:<id>`), only literal True counts.
    """
    result: List[ItemRecord] = []
    known_keys = {
        "id", "listId", "name", "parentId", "order", "checked", "note",
        "heading", "checks", "price", "quantity", "createdAt", "updatedAt", "yTextDelta"
    }
    for raw in raw_items:
        checks: Dict[str, bool] = {}
        if isinstance(raw.get("checks"), dict):
            for cid, cval in raw["checks"].items():
                checks[str(cid)] = (cval is True)
        # Overlay per-checkbox keys if present (e.g. "checks.<id>" or "check:<id>")
        extra: Dict[str, Any] = {}
        for k, v in raw.items():
            if k.startswith("check:") or k.startswith("checks."):
                cid = k.split(":", 1)[1] if ":" in k else k.split(".", 1)[1]
                checks[cid] = (v is True)
            elif k not in known_keys:
                extra[k] = copy.deepcopy(v)
        result.append(
            ItemRecord(
                id=str(raw["id"]),
                listId=str(raw["listId"]),
                name=str(raw.get("name", "")),
                parentId=raw.get("parentId") if raw.get("parentId") is not None else None,
                order=float(raw["order"]) if raw.get("order") is not None else 0.0,
                checked=(raw.get("checked") is True),
                note=(raw.get("note") is True),
                heading=(raw.get("heading") is True),
                checks=checks,
                price=raw.get("price", None),
                quantity=raw.get("quantity", None),
                createdAt=raw.get("createdAt", None),
                updatedAt=raw.get("updatedAt", None),
                yTextDelta=raw.get("yTextDelta", None),
                extra=extra,
            )
        )
    return result


def scan_hashtags(text: str) -> List[str]:
    """
    H(a): Scan a name from left to right for #word tokens preceded by
    start-of-string or runtime whitespace, lowercase captured words, retain duplicates.
    """
    return [match.group(1).lower() for match in HASHTAG_SCAN_RE.finditer(text)]


def normalize_tag(tag: str, aliases: Optional[Dict[str, str]] = None) -> str:
    """
    n(t): Trim whitespace, remove one leading '#', lowercase to t_0,
    and normalize by one lookup in brand aliases map A.
    """
    merged_aliases = dict(DEFAULT_BRAND_ALIASES)
    if aliases:
        merged_aliases.update(aliases)
        merged_aliases.update(DEFAULT_BRAND_ALIASES)  # Explicitly overridden by the 3 woolworths entries
    t0 = tag.strip()
    if t0.startswith("#"):
        t0 = t0[1:]
    t0 = t0.lower()
    return merged_aliases.get(t0, t0)


def suburb_tag(suburb: SuburbRecord) -> str:
    """
    suburbTag(u) = keep_{a..z,0..9}(lower(strip_{0300..036f}(NFKD(u.name)))).
    """
    decomposed = unicodedata.normalize("NFKD", suburb.name)
    stripped = "".join(
        ch for ch in decomposed if not (0x0300 <= ord(ch) <= 0x036F)
    )
    lowered = stripped.lower()
    return "".join(ch for ch in lowered if ("a" <= ch <= "z") or ("0" <= ch <= "9"))


def suburb_locations(suburbs: Sequence[SuburbRecord]) -> List[LocationRecord]:
    """Convert suburb catalogue records U into destination LocationRecords."""
    return [
        LocationRecord(
            id=f"suburb-{u.id}",
            name=f"{u.name} (suburb centre)",
            latitude=u.latitude,
            longitude=u.longitude,
            tags=[suburb_tag(u)],
            address=u.address,
            source=u.source,
            accuracyClass="suburb",
        )
        for u in suburbs
    ]


def build_destinations(
    bundled: Sequence[LocationRecord],
    suburbs: Sequence[SuburbRecord],
    custom_map: Dict[str, LocationRecord],
) -> List[LocationRecord]:
    """D = B || suburbLocations(U) || values(X)."""
    return list(bundled) + suburb_locations(suburbs) + list(custom_map.values())


def location_supported_tags(
    loc: LocationRecord, aliases: Optional[Dict[str, str]] = None
) -> Set[str]:
    """Compute S_0(d) and category expansions S(d) for a destination d."""
    s0 = {normalize_tag(t, aliases) for t in loc.tags}
    s = set(s0)
    if s0 & SUPERMARKET_BRANDS:
        s.add("supermarket")
    if s0 & HARDWARE_BRANDS:
        s.add("hardware")
    if s0 & PCPARTS_BRANDS:
        s.add("pcparts")
    return s


def compute_recognized_tags(
    destinations: Sequence[LocationRecord], aliases: Optional[Dict[str, str]] = None
) -> Tuple[Set[str], Set[str]]:
    """Return (K_D, K) where K_D = union_{d in D} S(d) and K = K_D union G."""
    k_d: Set[str] = set()
    for d in destinations:
        k_d.update(location_supported_tags(d, aliases))
    return k_d, (k_d | OPTIONAL_TAGS)


def matching_tags(
    tags: Sequence[str],
    loc: LocationRecord,
    aliases: Optional[Dict[str, str]] = None,
) -> List[str]:
    """M(t, d) = [a in uniq([n(x) : x in t]) : a in S(d)]."""
    supported = location_supported_tags(loc, aliases)
    normalized_uniq = uniq(normalize_tag(x, aliases) for x in tags)
    return [a for a in normalized_uniq if a in supported]


def resolve_parent_cycles(
    parent_map: Dict[str, Optional[str]]
) -> Dict[str, Optional[str]]:
    """
    Given a mapping of node_id -> parent_id within a single scope (list or folders):
    1. Missing parent becomes None (bot).
    2. In each parent cycle, the node with smallest ID under prec_u becomes a root (None).
    Returns a repaired copy of parent_map.
    """
    repaired: Dict[str, Optional[str]] = {
        nid: (pid if pid in parent_map else None)
        for nid, pid in parent_map.items()
    }
    visited_global: Set[str] = set()
    for start_id in list(repaired.keys()):
        if start_id in visited_global:
            continue
        trace: List[str] = []
        trace_index: Dict[str, int] = {}
        curr: Optional[str] = start_id
        while curr is not None and curr not in visited_global:
            if curr in trace_index:
                # Cycle detected! Extract cycle nodes
                cycle_nodes = trace[trace_index[curr]:]
                min_node = min(cycle_nodes, key=UTF16_KEY)
                repaired[min_node] = None
                break
            trace_index[curr] = len(trace)
            trace.append(curr)
            curr = repaired.get(curr)
        visited_global.update(trace)
    return repaired


def traverse_items_in_source_order(items: Sequence[ItemRecord]) -> List[ItemRecord]:
    """
    Compute T(I):
    - Group items by listId in first-occurrence order in I.
    - Repair missing parents and cycles per list.
    - Sort sibling sequences by (order, id_{prec_u}) and traverse roots in preorder.
    """
    list_order: List[str] = []
    by_list: Dict[str, List[ItemRecord]] = {}
    for item in items:
        if item.listId not in by_list:
            list_order.append(item.listId)
            by_list[item.listId] = []
        by_list[item.listId].append(item)

    ordered_result: List[ItemRecord] = []
    for list_id in list_order:
        list_items = by_list[list_id]
        # Keep first record if duplicate IDs exist, or map by ID
        item_map: Dict[str, ItemRecord] = {it.id: it for it in list_items}
        raw_parents: Dict[str, Optional[str]] = {it.id: it.parentId for it in list_items}
        repaired_parents = resolve_parent_cycles(raw_parents)

        children_map: Dict[Optional[str], List[ItemRecord]] = {None: []}
        for it in list_items:
            repaired_it = copy.copy(it)
            repaired_it.parentId = repaired_parents[it.id]
            item_map[it.id] = repaired_it
            children_map.setdefault(repaired_it.parentId, []).append(repaired_it)

        for siblings in children_map.values():
            siblings.sort(key=lambda x: (x.order, UTF16_KEY(x.id)))

        def _preorder(parent_id: Optional[str]) -> None:
            for child in children_map.get(parent_id, []):
                ordered_result.append(child)
                _preorder(child.id)

        _preorder(None)

    return ordered_result


def folder_ancestors(
    list_rec: ListRecord, folders: Dict[str, FolderRecord]
) -> List[FolderRecord]:
    """
    anc(ell): Direct folder and all existing ancestors, stopping at a missing
    parent or a repeated ID.
    """
    anc: List[FolderRecord] = []
    seen: Set[str] = set()
    curr_id = list_rec.folderId
    while curr_id is not None and curr_id in folders and curr_id not in seen:
        seen.add(curr_id)
        folder = folders[curr_id]
        anc.append(folder)
        curr_id = folder.parentId
    return anc


def is_list_effectively_archived(
    list_rec: ListRecord, folders: Dict[str, FolderRecord]
) -> bool:
    """arch(ell) = ell.archived or bigvee_{a in anc(ell)} a.archived."""
    if list_rec.archived:
        return True
    return any(a.archived for a in folder_ancestors(list_rec, folders))


def direct_folder_checkboxes(
    list_rec: ListRecord, folders: Dict[str, FolderRecord]
) -> List[NamedCheckbox]:
    """b(i): Named-checkbox sequence of the item's list's direct folder (empty if absent)."""
    if list_rec.folderId and list_rec.folderId in folders:
        return folders[list_rec.folderId].checkboxes
    return []


def is_item_checked(
    item: ItemRecord, list_rec: ListRecord, folders: Dict[str, FolderRecord]
) -> bool:
    """checked(i): checks[last(b(i)).id] == true if |b(i)| > 0 else i.checked."""
    b = direct_folder_checkboxes(list_rec, folders)
    if len(b) > 0:
        return item.checks.get(b[-1].id) is True
    return bool(item.checked)


def is_item_done(
    item: ItemRecord, list_rec: ListRecord, folders: Dict[str, FolderRecord]
) -> bool:
    """d_i = not i.note and checked(i)."""
    return (not item.note) and is_item_checked(item, list_rec, folders)


def collect_errands(
    items: Sequence[ItemRecord],
    lists: Dict[str, ListRecord],
    folders: Dict[str, FolderRecord],
    recognized_k: Set[str],
    include_done: bool = False,
    aliases: Optional[Dict[str, str]] = None,
) -> List[ErrandCandidate]:
    """
    Compute C_b (where b = include_done).
    Default `include_done=False` corresponds to `collectErrands` default;
    the Nearby screen uses C = C_True (`include_done=True`).
    """
    t_items = traverse_items_in_source_order(items)
    candidates: List[ErrandCandidate] = []

    for item in t_items:
        ell = lists.get(item.listId)
        if ell is None:
            continue
        if ell.type == "divider":
            continue
        if is_list_effectively_archived(ell, folders):
            continue
        if item.heading:
            continue

        d_i = is_item_done(item, ell, folders)
        if not (include_done or not d_i):
            continue

        item_tags = scan_hashtags(item.name)
        norm_item_tags = {normalize_tag(t, aliases) for t in item_tags}
        j_i = len(norm_item_tags & recognized_k) == 0

        if ell.done and j_i:
            continue

        if j_i:
            list_tags = scan_hashtags(ell.name)
            tau_i = uniq(item_tags + list_tags)
        else:
            tau_i = item_tags

        k_i = any(normalize_tag(t, aliases) in recognized_k for t in tau_i)
        if not k_i:
            continue

        candidates.append(
            ErrandCandidate(
                item=item,
                list_rec=ell,
                effective_tags=tau_i,
                inherits_list_tags=j_i,
            )
        )

    return candidates


def stable_json_structure(value: Any, locale_key: Callable[[str], Any] = LOCALE_KEY) -> Any:
    """
    stable(x): Recursively reconstruct objects (dicts) with keys sorted by prec_c
    and preserve array (list/tuple) order.
    """
    if isinstance(value, dict):
        sorted_keys = sorted(value.keys(), key=locale_key)
        return {k: stable_json_structure(value[k], locale_key) for k in sorted_keys}
    if isinstance(value, (list, tuple)):
        return [stable_json_structure(el, locale_key) for el in value]
    return value


def compute_item_fingerprint(
    item: ItemRecord,
    list_rec: ListRecord,
    folders: Dict[str, FolderRecord],
    locale_key: Callable[[str], Any] = LOCALE_KEY,
) -> str:
    """
    Compute phi_i = hex_lower(SHA256(UTF8(JSON(stable(payload(i)))))).
    Excludes item.order while retaining all other fields, listName, done, and text.
    """
    d_i = is_item_done(item, list_rec, folders)
    text_val = item.yTextDelta if item.yTextDelta is not None else item.name
    payload = {
        "item": item.to_raw_dict(omit_order=True),
        "listName": list_rec.name,
        "done": d_i,
        "text": text_val,
    }
    stabilized = stable_json_structure(payload, locale_key)
    serialized = json.dumps(stabilized, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(serialized.encode("utf-8")).hexdigest().lower()


def read_valid_checklist_entry(
    q_map: Dict[str, Any], item_id: str
) -> Optional[ChecklistStateRecord]:
    """
    Return q_i = Q[i.id] iff it has a 64-character lowercase hex fingerprint
    and a Boolean dismissed flag; otherwise None (bot).
    """
    raw = q_map.get(item_id)
    if raw is None:
        return None
    if isinstance(raw, ChecklistStateRecord):
        phi, delta = raw.phi, raw.delta
    elif isinstance(raw, dict):
        phi, delta = raw.get("phi"), raw.get("delta")
    elif isinstance(raw, (tuple, list)) and len(raw) == 2:
        phi, delta = raw[0], raw[1]
    else:
        return None

    if isinstance(phi, str) and HEX64_RE.match(phi) and isinstance(delta, bool):
        return ChecklistStateRecord(phi=phi, delta=delta)
    return None


@dataclass
class MembershipSnapshot:
    C: List[ErrandCandidate]
    A: List[ErrandCandidate]
    W: Set[str]
    E: List[ErrandCandidate]
    P: List[ErrandCandidate]
    E_plus: List[ErrandCandidate]
    fingerprints: Dict[str, str]
    optional_labels: Dict[str, Optional[str]]


def compute_membership(
    state: NearbyState,
    destinations: Sequence[LocationRecord],
    recognized_k: Set[str],
) -> MembershipSnapshot:
    """Evaluate Section 4 predicates z_i, a_i, o_i, omega_i and sets A, W, E, P, E^+."""
    candidates = collect_errands(
        state.I, state.L, state.F, recognized_k, include_done=True, aliases=state.brand_aliases
    )
    paused_tags_norm = {normalize_tag(x, state.brand_aliases) for x in state.P_T}

    fingerprints: Dict[str, str] = {}
    optional_labels: Dict[str, Optional[str]] = {}
    active_a: List[ErrandCandidate] = []
    paused_p: List[ErrandCandidate] = []
    meta_by_id: Dict[str, Tuple[bool, Optional[ChecklistStateRecord], bool, bool, bool]] = {}

    for cand in candidates:
        item = cand.item
        d_i = is_item_done(item, cand.list_rec, state.F)
        phi_i = compute_item_fingerprint(item, cand.list_rec, state.F)
        fingerprints[item.id] = phi_i

        q_i = read_valid_checklist_entry(state.Q, item.id)
        z_i = (q_i is not None) and q_i.delta and (d_i or q_i.phi == phi_i)
        a_i = (item.id in state.P_I) or any(
            normalize_tag(t, state.brand_aliases) in paused_tags_norm
            for t in cand.effective_tags
        )
        opt_seq = [
            normalize_tag(t, state.brand_aliases)
            for t in cand.effective_tags
            if normalize_tag(t, state.brand_aliases) in OPTIONAL_TAGS
        ]
        o_i = head(opt_seq)
        omega_i = o_i is not None
        optional_labels[item.id] = o_i
        meta_by_id[item.id] = (d_i, q_i, z_i, a_i, omega_i)

        if (not d_i) and (not z_i) and (not a_i):
            active_a.append(cand)
        if (not d_i) and (not z_i) and a_i:
            paused_p.append(cand)

    # W = {i.id : i in A, exists d in D : |M(tau_i, d)| > 0}
    w_set: Set[str] = set()
    for cand in active_a:
        if any(len(matching_tags(cand.effective_tags, d, state.brand_aliases)) > 0 for d in destinations):
            w_set.add(cand.id)

    checklist_e: List[ErrandCandidate] = []
    clearable_e_plus: List[ErrandCandidate] = []
    for cand in candidates:
        d_i, q_i, z_i, a_i, omega_i = meta_by_id[cand.id]
        if (not z_i) and (not a_i):
            qualifies = (d_i and q_i is not None) or (
                (not d_i) and (cand.id in w_set or omega_i or q_i is not None)
            )
            if qualifies:
                checklist_e.append(cand)
                if d_i:
                    clearable_e_plus.append(cand)

    return MembershipSnapshot(
        C=candidates,
        A=active_a,
        W=w_set,
        E=checklist_e,
        P=paused_p,
        E_plus=clearable_e_plus,
        fingerprints=fingerprints,
        optional_labels=optional_labels,
    )


def is_valid_coord(lat: Any, lon: Any) -> bool:
    """valid(x) <=> finite(x.lat) and finite(x.lon) and |x.lat| <= 90 and |x.lon| <= 180."""
    if not isinstance(lat, (int, float)) or not isinstance(lon, (int, float)):
        return False
    if isinstance(lat, bool) or isinstance(lon, bool):
        return False
    if not (math.isfinite(lat) and math.isfinite(lon)):
        return False
    return abs(float(lat)) <= 90.0 and abs(float(lon)) <= 180.0


def is_valid_starting_record(rec: Optional[StartingLocationRecord]) -> bool:
    """Validate structural rules for stored starting record s (Section 9)."""
    if rec is None:
        return False
    if not is_valid_coord(rec.latitude, rec.longitude):
        return False
    if rec.source not in STARTING_SOURCES:
        return False
    if not isinstance(rec.label, str) or not rec.label.strip():
        return False
    if not isinstance(rec.timestamp, str) or not rec.timestamp.strip():
        return False
    if rec.accuracy is not None:
        if (
            isinstance(rec.accuracy, bool)
            or not isinstance(rec.accuracy, (int, float))
            or not math.isfinite(rec.accuracy)
            or rec.accuracy < 0
        ):
            return False
    if rec.source == "custom":
        if (
            not isinstance(rec.customId, str)
            or not rec.customId.startswith("custom-")
            or len(rec.customId) <= len("custom-")
        ):
            return False
    return True


def resolve_starting_point(
    s: Optional[StartingLocationRecord], custom_map: Dict[str, LocationRecord]
) -> Optional[StartingLocationRecord]:
    """
    Resolve stored starting point s -> bar_s:
    - Invalid/absent records yield None.
    - GPS/suburb records yield themselves.
    - Custom records yield themselves with label/coordinates replaced by X[id]
      iff it exists and has startingPoint=True; otherwise None.
    """
    if not is_valid_starting_record(s) or s is None:
        return None
    if s.source in ("gps", "suburb"):
        return copy.copy(s)
    if s.source == "custom" and s.customId is not None:
        x_rec = custom_map.get(s.customId)
        if x_rec is not None and x_rec.startingPoint is True and is_valid_coord(x_rec.lat, x_rec.lon):
            resolved = copy.copy(s)
            resolved.label = x_rec.name
            resolved.latitude = x_rec.latitude
            resolved.longitude = x_rec.longitude
            return resolved
    return None


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """
    Compute Delta(x, y) in kilometres using the specification's exact formula:
    2 * 6371.0088 * arcsin(sqrt(min(1, max(0, u(x, y))))).
    """
    r_lat1 = math.radians(lat1)
    r_lat2 = math.radians(lat2)
    d_lat = math.radians(lat2 - lat1)
    d_lon = math.radians(lon2 - lon1)
    u = (
        math.sin(d_lat / 2.0) ** 2
        + math.cos(r_lat1) * math.cos(r_lat2) * (math.sin(d_lon / 2.0) ** 2)
    )
    clamped = min(1.0, max(0.0, u))
    return 2.0 * EARTH_RADIUS_KM * math.asin(math.sqrt(clamped))


def compare_stops(a: StopMatch, b: StopMatch) -> int:
    """
    prec_s comparator:
    - When either distance is present (absent is +inf), compare distance then location ID under prec_c.
    - When both distances are absent, compare location name then ID under prec_c.
    - Remaining ties retain input order (Python's Timsort is stable).
    """
    if a.distance is not None or b.distance is not None:
        da = a.distance if a.distance is not None else float("inf")
        db = b.distance if b.distance is not None else float("inf")
        if da != db:
            return -1 if da < db else 1
        return default_locale_compare(a.location.id, b.location.id)
    name_cmp = default_locale_compare(a.location.name, b.location.name)
    if name_cmp != 0:
        return name_cmp
    return default_locale_compare(a.location.id, b.location.id)


STOP_SORT_KEY = functools.cmp_to_key(compare_stops)


def find_nearby_stops(
    destinations: Sequence[LocationRecord],
    origin: Optional[Tuple[float, float]],
    radius: float,
    active_errands: Sequence[ErrandCandidate],
    aliases: Optional[Dict[str, str]] = None,
) -> List[StopMatch]:
    """
    Library function N(D, o, rho, A):
    Returns sorted StopMatch sequence for valid destinations matching >= 1 active errand within radius.
    """
    if origin is not None:
        if (
            not is_valid_coord(origin[0], origin[1])
            or not isinstance(radius, (int, float))
            or isinstance(radius, bool)
            or not math.isfinite(radius)
            or radius <= 0
        ):
            return []

    matches: List[StopMatch] = []
    for d in destinations:
        if not is_valid_coord(d.lat, d.lon):
            continue
        m_d = [
            cand
            for cand in active_errands
            if len(matching_tags(cand.effective_tags, d, aliases)) > 0
        ]
        if len(m_d) == 0:
            continue
        dist: Optional[float] = None
        if origin is not None:
            dist = haversine_km(origin[0], origin[1], d.lat, d.lon)
            if dist > radius:
                continue
        matches.append(StopMatch(location=d, distance=dist, items=m_d))

    return sorted(matches, key=STOP_SORT_KEY)


@dataclass
class PlannerResult:
    suggested: List[StopMatch]
    alternatives: List[StopMatch]
    unavailable: List[ErrandCandidate]


def plan_errand_stops(
    stops_z: Sequence[StopMatch],
    location_coverage_errands: Sequence[ErrandCandidate],
) -> PlannerResult:
    """
    Section 6: Greedy set-cover selection, reverse pruning, and unique assignment.
    """
    reachable_r: Set[str] = set()
    for z in stops_z:
        reachable_r.update(ids(z.items))

    unavailable = [i for i in location_coverage_errands if i.id not in reachable_r]

    # Greedy selection
    u_k: Set[str] = set(reachable_r)
    v_seq: List[StopMatch] = []
    while len(u_k) > 0:
        best_count = 0
        candidates_k: List[StopMatch] = []
        for z in stops_z:
            c_k = len(ids(z.items) & u_k)
            if c_k > best_count:
                best_count = c_k
                candidates_k = [z]
            elif c_k == best_count and c_k > 0:
                candidates_k.append(z)
        if best_count == 0 or not candidates_k:
            break
        candidates_k.sort(key=STOP_SORT_KEY)
        z_k = candidates_k[0]
        v_seq.append(z_k)
        u_k -= ids(z_k.items)

    # Reverse pruning: j = m, m-1, ..., 1
    retained: List[StopMatch] = list(v_seq)
    for j in range(len(retained) - 1, -1, -1):
        v_j = retained[j]
        other_covered: Set[str] = set()
        for idx, w in enumerate(retained):
            if idx != j:
                other_covered.update(ids(w.items))
        if ids(v_j.items).issubset(other_covered):
            del retained[j]

    # Sort retained stops and assign items once in display order
    sorted_retained = sorted(retained, key=STOP_SORT_KEY)
    assigned_b: Set[str] = set()
    suggested: List[StopMatch] = []
    for s_j in sorted_retained:
        e_j = uniq_id([i for i in s_j.items if i.id not in assigned_b])
        assigned_b.update(ids(e_j))
        suggested.append(
            StopMatch(location=s_j.location, distance=s_j.distance, items=e_j)
        )

    retained_loc_ids = {v.location.id for v in retained}
    alternatives = sorted(
        [z for z in stops_z if z.location.id not in retained_loc_ids],
        key=STOP_SORT_KEY,
    )

    return PlannerResult(
        suggested=suggested,
        alternatives=alternatives,
        unavailable=unavailable,
    )


def group_identity(cand: ErrandCandidate) -> Tuple[str, str]:
    """g(i) = ('list', ell.id) if j_i else ('item', i.id)."""
    if cand.inherits_list_tags:
        return ("list", cand.list_rec.id)
    return ("item", cand.item.id)


def group_errands(seq: Sequence[ErrandCandidate]) -> List[ErrandGroup]:
    """Gamma(q): Gather rows by g(i), retaining first group occurrence and row order."""
    groups_map: Dict[Tuple[str, str], ErrandGroup] = {}
    order: List[Tuple[str, str]] = []
    for cand in seq:
        gid = group_identity(cand)
        if gid not in groups_map:
            order.append(gid)
            groups_map[gid] = ErrandGroup(id=gid, list=cand.list_rec, rows=[])
        groups_map[gid].rows.append(cand)
    return [groups_map[gid] for gid in order]


def clean_item_name(name: str) -> str:
    """
    clean(name): Remove every start/whitespace-prefixed #word token while preserving
    preceding whitespace, collapse whitespace runs to one space, and trim.
    """
    without_tags = HASHTAG_CLEAN_RE.sub(r"\1", name)
    collapsed = re.sub(r"\s+", " ", without_tags)
    return collapsed.strip()


def format_preview(rows: Sequence[ErrandCandidate], limit_p: int) -> str:
    """
    preview(q, p): Join non-empty cleaned names of first min(p, |q|) rows with ' · ',
    and append ' · +(|q| - min(p, |q|)) more' when |q| > p.
    """
    take = min(limit_p, len(rows))
    head_rows = rows[:take]
    cleaned = [clean_item_name(r.item.name) for r in head_rows]
    non_empty = [c for c in cleaned if c != ""]
    base = " · ".join(non_empty)
    if len(rows) > limit_p:
        return f"{base} · +{len(rows) - take} more"
    return base


def build_task_pills(
    stops_z: Sequence[StopMatch],
    active_a: Sequence[ErrandCandidate],
    optional_labels: Dict[str, Optional[str]],
    limit_p: int,
    aliases: Optional[Dict[str, str]] = None,
) -> Tuple[Dict[str, TaskPillEntry], Set[str], List[PillGroup]]:
    """
    Compute insertion-ordered map Pi, nearby/optional set N, and PillGroups.
    """
    pi_map: Dict[str, TaskPillEntry] = {}
    for z in stops_z:
        for cand in z.items:
            if cand.id not in pi_map:
                m_tags = matching_tags(cand.effective_tags, z.location, aliases)
                if len(m_tags) > 0:
                    pi_map[cand.id] = TaskPillEntry(
                        item=cand,
                        clean_name=clean_item_name(cand.item.name),
                        tag=m_tags[0],
                    )

    for cand in active_a:
        o_i = optional_labels.get(cand.id)
        if o_i is not None:
            # Preserves existing key position in Python 3.7+ dict when overwriting
            pi_map[cand.id] = TaskPillEntry(
                item=cand,
                clean_name=clean_item_name(cand.item.name),
                tag=o_i,
            )

    n_set: Set[str] = set(pi_map.keys())

    # T_a = uniq([pi.tag : pi in values(Pi), g(pi.item) == a])
    tags_by_group: Dict[Tuple[str, str], List[str]] = {}
    for entry in pi_map.values():
        gid = group_identity(entry.item)
        tags_by_group.setdefault(gid, []).append(entry.tag)
    for gid in list(tags_by_group.keys()):
        tags_by_group[gid] = uniq(tags_by_group[gid])

    qualifying_active = [
        cand for cand in active_a if len(tags_by_group.get(group_identity(cand), [])) > 0
    ]
    grouped_active = group_errands(qualifying_active)
    pills: List[PillGroup] = [
        PillGroup(
            id=grp.id,
            list=grp.list,
            rows=grp.rows,
            preview=format_preview(grp.rows, limit_p),
            tags=tags_by_group[grp.id],
        )
        for grp in grouped_active
    ]
    return pi_map, n_set, pills


def checklist_row_reason(
    cand: ErrandCandidate,
    is_done: bool,
    omega_i: bool,
    r_set: Set[str],
    n_set: Set[str],
    w_set: Set[str],
    origin: Optional[Tuple[float, float]],
    filter_enabled: bool,
) -> str:
    """Compute reason(i) for a checklist row (Section 7)."""
    if is_done:
        return ""
    if omega_i and (cand.id not in r_set):
        return "choose bank/ATM or location yourself"
    if (origin is not None or not filter_enabled) and (cand.id not in n_set) and filter_enabled and (cand.id in w_set):
        return "no match within radius"
    if (origin is not None or not filter_enabled) and (cand.id not in n_set):
        return "no matching location in database"
    return ""


@dataclass
class NearbyViewModel:
    destinations: List[LocationRecord]
    recognized_k_d: Set[str]
    recognized_k: Set[str]
    membership: MembershipSnapshot
    resolved_start: Optional[StartingLocationRecord]
    origin: Optional[Tuple[float, float]]
    stops_z: List[StopMatch]
    reachable_r: Set[str]
    planner: PlannerResult
    pills: List[PillGroup]
    checklist_groups: List[ErrandGroup]
    paused_groups: List[ErrandGroup]
    location_groups: List[ErrandGroup]
    covered_count: int
    coverage_denominator: int
    stop_count: int
    row_reasons: Dict[str, str]


def evaluate_nearby_view(state: NearbyState) -> NearbyViewModel:
    """Recompute all predicates and presentation structures from current live/historical snapshot."""
    destinations = build_destinations(state.B, state.U, state.X)
    k_d, k_all = compute_recognized_tags(destinations, state.brand_aliases)
    membership = compute_membership(state, destinations, k_all)

    bar_s = resolve_starting_point(state.s, state.X)
    origin: Optional[Tuple[float, float]] = (
        (bar_s.lat, bar_s.lon) if (state.f and bar_s is not None) else None
    )

    if (not state.f) or (origin is not None):
        stops_z = find_nearby_stops(
            destinations, origin, state.rho, membership.A, state.brand_aliases
        )
    else:
        stops_z = []

    reachable_r: Set[str] = set()
    for z in stops_z:
        reachable_r.update(ids(z.items))

    # A_L = [i in A : not omega_i or i.id in R]
    a_l = [
        cand
        for cand in membership.A
        if (membership.optional_labels.get(cand.id) is None) or (cand.id in reachable_r)
    ]
    planner = plan_errand_stops(stops_z, a_l)

    _, n_set, pills = build_task_pills(
        stops_z, membership.A, membership.optional_labels, state.p, state.brand_aliases
    )

    raw_checklist_groups = group_errands(membership.E)
    checklist_groups = sorted(
        raw_checklist_groups,
        key=lambda grp: -1 if any(r.id in n_set for r in grp.rows) else 0,
    )
    paused_groups = group_errands(membership.P)
    location_groups = group_errands(a_l)
    covered_count = sum(
        1 for grp in location_groups if all(r.id in reachable_r for r in grp.rows)
    )

    row_reasons: Dict[str, str] = {}
    for cand in membership.E:
        d_i = is_item_done(cand.item, cand.list_rec, state.F)
        omega_i = membership.optional_labels.get(cand.id) is not None
        row_reasons[cand.id] = checklist_row_reason(
            cand, d_i, omega_i, reachable_r, n_set, membership.W, origin, state.f
        )

    return NearbyViewModel(
        destinations=destinations,
        recognized_k_d=k_d,
        recognized_k=k_all,
        membership=membership,
        resolved_start=bar_s,
        origin=origin,
        stops_z=stops_z,
        reachable_r=reachable_r,
        planner=planner,
        pills=pills,
        checklist_groups=checklist_groups,
        paused_groups=paused_groups,
        location_groups=location_groups,
        covered_count=covered_count,
        coverage_denominator=len(location_groups),
        stop_count=len(planner.suggested),
        row_reasons=row_reasons,
    )


def _guard_mutable(state: NearbyState) -> None:
    if state.eta:
        raise ReadOnlyError("Cannot mutate durable state while historical view (eta) is active.")


def remember_entries(
    state: NearbyState,
    entries: Sequence[Tuple[str, str]],
    origin_tag: str = NEARBY_CHECKLIST_MEMBERSHIP_ORIGIN,
) -> None:
    """
    remember(Q, id, phi): Updates absent entries or dismissed entries whose saved
    fingerprint differs. Automatic membership uses NEARBY_CHECKLIST_MEMBERSHIP_ORIGIN
    and creates no undo entry.
    """
    _guard_mutable(state)
    changed = False
    for item_id, phi in entries:
        q_curr = read_valid_checklist_entry(state.Q, item_id)
        if q_curr is None or (q_curr.delta and q_curr.phi != phi):
            state.Q[item_id] = ChecklistStateRecord(phi=phi, delta=False)
            changed = True
    if changed and origin_tag != NEARBY_CHECKLIST_MEMBERSHIP_ORIGIN:
        state.undo_stack.append("remember")


def sync_live_checklist_membership(state: NearbyState) -> NearbyViewModel:
    """
    Evaluate view and fold `remember` over [i in E : not d_i] when in live view (not eta).
    """
    vm = evaluate_nearby_view(state)
    if not state.eta:
        to_remember: List[Tuple[str, str]] = []
        for cand in vm.membership.E:
            if not is_item_done(cand.item, cand.list_rec, state.F):
                to_remember.append((cand.id, vm.membership.fingerprints[cand.id]))
        remember_entries(state, to_remember, origin_tag=NEARBY_CHECKLIST_MEMBERSHIP_ORIGIN)
    return vm


def dismiss_checklist_row(state: NearbyState, item_id: str) -> None:
    """Dismissal sets Q[i.id] <- (phi_i, True) for the selected current checklist row."""
    _guard_mutable(state)
    vm = evaluate_nearby_view(state)
    if any(c.id == item_id for c in vm.membership.E):
        phi_i = vm.membership.fingerprints[item_id]
        state.Q[item_id] = ChecklistStateRecord(phi=phi_i, delta=True)
        state.undo_stack.append(f"dismiss:{item_id}")


def clear_completed_checklist(state: NearbyState) -> None:
    """Clear completed applies dismissal to every i in E^+."""
    _guard_mutable(state)
    vm = evaluate_nearby_view(state)
    for cand in vm.membership.E_plus:
        phi_i = vm.membership.fingerprints[cand.id]
        state.Q[cand.id] = ChecklistStateRecord(phi=phi_i, delta=True)
    if vm.membership.E_plus:
        state.undo_stack.append("clear_completed")


def set_done(
    state: NearbyState, item_id: str, beta: bool, timestamp: Optional[str] = None
) -> None:
    """
    setDone(id, beta):
    - Rejects missing items, notes, and headings.
    - If item's list exists and original completion is False, remembers current fingerprint first.
    - Updates last direct-folder checkbox if |b(i)| > 0, else item.checked if changed.
    """
    _guard_mutable(state)
    t_now = timestamp or datetime.datetime.now(datetime.timezone.utc).isoformat()
    target = next((it for it in state.I if it.id == item_id), None)
    if target is None or target.note or target.heading:
        return

    ell = state.L.get(target.listId)
    if ell is not None and not is_item_done(target, ell, state.F):
        phi_i = compute_item_fingerprint(target, ell, state.F)
        remember_entries(state, [(target.id, phi_i)], origin_tag="user")

    b = direct_folder_checkboxes(ell, state.F) if ell is not None else []
    if len(b) > 0:
        target.checks[b[-1].id] = bool(beta)
        target.updatedAt = t_now
        state.undo_stack.append(f"set_done:{item_id}")
    elif target.checked != bool(beta):
        target.checked = bool(beta)
        target.updatedAt = t_now
        state.undo_stack.append(f"set_done:{item_id}")


def set_group_done(
    state: NearbyState, list_id: str, beta: bool, timestamp: Optional[str] = None
) -> None:
    """Setting group completion changes ell.done and ell.updatedAt only."""
    _guard_mutable(state)
    ell = state.L.get(list_id)
    if ell is not None:
        ell.done = bool(beta)
        ell.updatedAt = timestamp or datetime.datetime.now(datetime.timezone.utc).isoformat()
        state.undo_stack.append(f"set_group_done:{list_id}")


def pause_tag(state: NearbyState, raw_tag: str, pause: bool) -> None:
    """pauseTag(x, b): Tag inputs must normalize to nonempty ASCII word strings."""
    _guard_mutable(state)
    norm = normalize_tag(raw_tag, state.brand_aliases)
    if not norm or not ASCII_WORD_RE.match(norm):
        return
    if pause:
        state.P_T.add(norm)
    else:
        state.P_T.discard(norm)
    state.undo_stack.append(f"pause_tag:{norm}:{pause}")


def pause_item(state: NearbyState, item_id: str, pause: bool) -> None:
    """pauseItem(id, b): Item IDs must be nonblank strings; pausing requires item to exist."""
    _guard_mutable(state)
    if not isinstance(item_id, str) or not item_id.strip():
        return
    exists = any(it.id == item_id for it in state.I)
    if pause:
        if exists:
            state.P_I.add(item_id)
            state.undo_stack.append(f"pause_item:{item_id}:True")
    else:
        state.P_I.discard(item_id)
        state.undo_stack.append(f"pause_item:{item_id}:False")


def save_start(
    state: NearbyState,
    coords: Tuple[float, float],
    source: str,
    label: str,
    accuracy: Optional[float],
    timestamp: str,
    custom_id: Optional[str] = None,
) -> None:
    """Atomically validate and save starting point s and enable location filtering f."""
    _guard_mutable(state)
    lat, lon = coords
    if source == "custom":
        if not custom_id or custom_id not in state.X:
            raise ValidationError("Referenced custom starting location does not exist.")
        x_rec = state.X[custom_id]
        if not x_rec.startingPoint:
            raise ValidationError("Referenced custom location is not enabled as a starting point.")
        lat, lon = x_rec.latitude, x_rec.longitude
        label = x_rec.name
        accuracy = None

    candidate = StartingLocationRecord(
        latitude=float(lat),
        longitude=float(lon),
        source=source,
        label=label,
        timestamp=timestamp,
        accuracy=accuracy,
        customId=custom_id if source == "custom" else None,
    )
    if not is_valid_starting_record(candidate):
        raise ValidationError("Invalid starting location record fields.")
    state.s = candidate
    state.f = True


def select_no_filter(state: NearbyState) -> None:
    """noFilter transition."""
    _guard_mutable(state)
    state.v += 1
    state.locating = False
    state.e = ""
    state.f = False
    state.showLocations = False
    state.showDetails = False


def select_suburb_origin(state: NearbyState, suburb: SuburbRecord, timestamp: str) -> None:
    """suburb(u) origin selection transition."""
    _guard_mutable(state)
    state.v += 1
    state.locating = False
    state.e = ""
    save_start(state, (suburb.latitude, suburb.longitude), "suburb", suburb.name, None, timestamp)


def select_custom_origin(state: NearbyState, custom_id: str, timestamp: str) -> None:
    """custom(id) origin selection transition."""
    _guard_mutable(state)
    x_rec = state.X.get(custom_id)
    if x_rec is None or not x_rec.startingPoint:
        state.e = "unavailable starting point"
        return
    state.v += 1
    state.locating = False
    state.e = ""
    save_start(
        state,
        (x_rec.latitude, x_rec.longitude),
        "custom",
        x_rec.name,
        None,
        timestamp,
        custom_id=custom_id,
    )
    state.showLocations = False
    state.showDetails = True


def clear_start(state: NearbyState) -> None:
    """Clear-start deletes s without changing f."""
    _guard_mutable(state)
    state.s = None
    state.v += 1
    state.locating = False


def gps_press(state: NearbyState, geolocation_available: bool = True) -> Optional[int]:
    """Start a GPS fix request and return captured request generation w = v."""
    if not geolocation_available:
        state.e = "geolocation unsupported"
        return None
    state.v += 1
    state.locating = True
    state.e = ""
    return state.v


def gps_success(
    state: NearbyState,
    w: int,
    coords: Tuple[float, float],
    accuracy: Optional[float],
    timestamp: str,
) -> None:
    """gpsSuccess(w, c, a) transition."""
    if w == state.v and not state.eta:
        save_start(state, coords, "gps", "Last GPS location", accuracy, timestamp)
        state.locating = False


def gps_error(state: NearbyState, w: int, error_code: int) -> None:
    """gpsError(w, k) transition."""
    if w == state.v:
        state.locating = False
        state.e = "permission denied" if error_code == 1 else "could not get location"


def save_custom_location(
    state: NearbyState,
    name: str,
    latitude: float,
    longitude: float,
    raw_tags: Sequence[str],
    location_id: Optional[str] = None,
    address: Optional[str] = None,
    source: Optional[str] = None,
    centre: Optional[str] = None,
    starting_point: bool = False,
    accuracy_class: Optional[str] = None,
    timestamp: Optional[str] = None,
) -> LocationRecord:
    """Validate and save a new or existing custom location in X."""
    _guard_mutable(state)
    cid = location_id if location_id is not None else f"custom-{uuid.uuid4()}"
    if not isinstance(cid, str) or not cid.startswith("custom-") or len(cid) <= len("custom-"):
        raise ValidationError("Custom location ID must start with 'custom-'.")
    trimmed_name = name.strip() if isinstance(name, str) else ""
    if not trimmed_name:
        raise ValidationError("Custom location name must be nonblank.")
    if not is_valid_coord(latitude, longitude):
        raise ValidationError("Custom location coordinates are invalid.")
    if accuracy_class is not None and accuracy_class not in ACCURACY_CLASSES:
        raise ValidationError("Invalid accuracy class.")

    if not raw_tags:
        raise ValidationError("Custom location requires a nonempty tag sequence.")
    for t in raw_tags:
        if not isinstance(t, str) or not OPTIONAL_HASH_WORD_RE.match(t.strip()):
            raise ValidationError(f"Invalid tag token: {t!r}")
    norm_tags = uniq(normalize_tag(t, state.brand_aliases) for t in raw_tags)
    if not norm_tags:
        raise ValidationError("Normalized tags cannot be empty.")

    old_rec = state.X.get(cid)
    new_rec = LocationRecord(
        id=cid,
        name=trimmed_name,
        latitude=float(latitude),
        longitude=float(longitude),
        tags=norm_tags,
        address=address.strip() if isinstance(address, str) else None,
        source=source,
        centre=centre,
        startingPoint=bool(starting_point),
        accuracyClass=accuracy_class,
    )
    state.X[cid] = new_rec

    # If saving a selected custom location, update or delete s accordingly
    if state.s is not None and state.s.source == "custom" and state.s.customId == cid:
        if old_rec is not None and old_rec.startingPoint and new_rec.startingPoint:
            state.s.label = new_rec.name
            state.s.latitude = new_rec.latitude
            state.s.longitude = new_rec.longitude
            state.s.timestamp = timestamp or datetime.datetime.now(datetime.timezone.utc).isoformat()
        else:
            state.s = None
    return new_rec


def delete_custom_location(state: NearbyState, custom_id: str) -> None:
    """Atomically remove custom location from X and clear s if s references it (f unchanged)."""
    _guard_mutable(state)
    if custom_id in state.X:
        del state.X[custom_id]
        if state.s is not None and state.s.source == "custom" and state.s.customId == custom_id:
            state.s = None


def read_preferences(
    raw_f: Any,
    raw_p: Any,
    raw_h: Any,
    suburbs: Sequence[SuburbRecord],
) -> Tuple[bool, int, List[str]]:
    """Apply Section 9 preference read/default equations for (f, p, h)."""
    f_val = (raw_f is not False)
    if isinstance(raw_p, int) and not isinstance(raw_p, bool) and 1 <= raw_p <= 50:
        p_val = min(raw_p, 9)
    else:
        p_val = 3

    known_ids = {u.id for u in suburbs}
    if (
        isinstance(raw_h, (list, tuple))
        and all(isinstance(x, str) and x in known_ids for x in raw_h)
        and len(set(raw_h)) == len(raw_h)
    ):
        h_val = list(raw_h)
    else:
        default_names = ("Melbourne", "Brunswick", "Richmond")
        by_name = {u.name: u.id for u in suburbs}
        h_val = [by_name[n] for n in default_names if n in by_name]

    return f_val, p_val, h_val


def save_filter_preference(state: NearbyState, f_new: bool) -> None:
    _guard_mutable(state)
    if not isinstance(f_new, bool):
        raise ValidationError("Filter preference requires a Boolean.")
    state.f = f_new


def save_preview_limit(state: NearbyState, p_new: int) -> None:
    _guard_mutable(state)
    if isinstance(p_new, bool) or not isinstance(p_new, int) or not (1 <= p_new <= 9):
        raise ValidationError("Preview limit save requires an integer in 1..9.")
    state.p = p_new


def save_hot_suburbs(state: NearbyState, h_new: Sequence[str]) -> None:
    _guard_mutable(state)
    known_ids = {u.id for u in state.U}
    if (
        not isinstance(h_new, (list, tuple))
        or len(set(h_new)) != len(h_new)
        or any(not isinstance(x, str) or x not in known_ids for x in h_new)
    ):
        raise ValidationError("Hot suburbs must be a unique sequence of known suburb IDs.")
    state.h = list(h_new)


@dataclass
class HashtagBrowserResult:
    counts: Dict[str, int]
    displayed_tags: List[str]
    selected_tag_locations: List[LocationRecord]


def query_hashtag_browser(
    destinations: Sequence[LocationRecord],
    raw_query: str = "",
    show_all: bool = False,
    selected_tag: Optional[str] = None,
    aliases: Optional[Dict[str, str]] = None,
) -> HashtagBrowserResult:
    """Section 10 Hashtag browser search, counts, and destination listing."""
    _, k_all = compute_recognized_tags(destinations, aliases)
    support_by_id: Dict[str, Set[str]] = {}
    for d in destinations:
        support_by_id.setdefault(d.id, set()).update(location_supported_tags(d, aliases))

    counts: Dict[str, int] = {
        a: sum(1 for s_tags in support_by_id.values() if a in s_tags)
        for a in k_all
    }
    complete_tags = sorted(k_all, key=LOCALE_KEY)

    norm_q = normalize_tag(raw_query, aliases)
    clean_q = "".join(ch for ch in norm_q if ASCII_WORD_RE.match(ch))
    matches = [a for a in complete_tags if clean_q in a]

    if raw_query.strip() != "" or show_all:
        displayed = matches
    else:
        displayed = sorted(matches, key=lambda a: (-counts[a], LOCALE_KEY(a)))[:12]

    selected_locs: List[LocationRecord] = []
    if selected_tag is not None:
        norm_sel = normalize_tag(selected_tag, aliases)
        matching_locs = [
            d for d in destinations if norm_sel in location_supported_tags(d, aliases)
        ]
        selected_locs = sorted(
            matching_locs,
            key=lambda d: (LOCALE_KEY(d.name), LOCALE_KEY(d.address or "")),
        )

    return HashtagBrowserResult(
        counts=counts,
        displayed_tags=displayed,
        selected_tag_locations=selected_locs,
    )


def normalize_suburb_search(text: str) -> str:
    """
    alpha(input): Apply NFKD, strip 0300..036f, lowercase, expand word-boundary 'mt'
    with optional period and following whitespace to 'mount ', replace non-ASCII-alnum
    runs with a space, then trim.
    """
    decomposed = unicodedata.normalize("NFKD", text)
    stripped = "".join(
        ch for ch in decomposed if not (0x0300 <= ord(ch) <= 0x036F)
    ).lower()
    expanded = re.sub(r"\bmt\.?\s+", "mount ", stripped)
    alnum_spaced = re.sub(r"[^a-z0-9]+", " ", expanded)
    return alnum_spaced.strip()


def fuzzy_substring_distance(q: str, a: str) -> int:
    """
    Compute fd(q, a) using the substring/transposition recurrence in Section 10.
    """
    m, n = len(q), len(a)
    if m == 0:
        return 0
    dp = [[0] * (n + 1) for _ in range(m + 1)]
    for i in range(1, m + 1):
        dp[i][0] = i

    for i in range(1, m + 1):
        for j in range(1, n + 1):
            cost = 0 if q[i - 1] == a[j - 1] else 1
            best = min(
                dp[i][j - 1] + 1,
                dp[i - 1][j] + 1,
                dp[i - 1][j - 1] + cost,
            )
            if i > 1 and j > 1 and q[i - 1] == a[j - 2] and q[i - 2] == a[j - 1]:
                best = min(best, dp[i - 2][j - 2] + 1)
            dp[i][j] = best

    return min(dp[m][j] for j in range(n + 1))


def search_suburbs(
    suburbs: Sequence[SuburbRecord], raw_input: str, limit: int = 8
) -> List[SuburbRecord]:
    """Score and rank suburbs using Section 10 exact/prefix/substring/fuzzy rules."""
    q = normalize_suburb_search(raw_input)
    if not q or limit <= 0:
        return []
    q_len = len(q)
    theta = 0 if q_len < 3 else min(3, max(1, q_len // 4))

    scored: List[Tuple[int, int, Any, Any, SuburbRecord]] = []
    for u in suburbs:
        a = normalize_suburb_search(u.name)
        if q == a:
            score = 0
        elif a.startswith(q):
            score = 1
        elif q in a:
            score = 2
        else:
            fd = fuzzy_substring_distance(q, a)
            if theta > 0 and fd <= theta:
                score = 3 + fd
            else:
                continue
        scored.append((score, utf16_len(u.name), LOCALE_KEY(u.name), LOCALE_KEY(u.id), u))

    scored.sort(key=lambda item: item[:4])
    return [item[4] for item in scored[:limit]]


def navigate_pill(state: NearbyState, pill: PillGroup) -> None:
    """Update navigation state nu when clicking a task pill."""
    kind, target_id = pill.id
    if kind == "list":
        state.nu.showNearby = False
        state.nu.openList = pill.list.id
        state.nu.openItem = None
        state.nu.returnTarget = (pill.list.id, None)
    else:
        state.nu.showNearby = False
        state.nu.openList = pill.list.id
        state.nu.openItem = target_id
        state.nu.returnTarget = (pill.list.id, target_id)


def return_nearby(state: NearbyState) -> None:
    """returnNearby transition."""
    state.nu.showNearby = True
    state.nu.openList = None
    state.nu.openItem = None
    state.nu.returnTarget = None


def google_maps_directions_url(loc: LocationRecord) -> str:
    """Build Google Maps directions URL according to Section 10."""
    import urllib.parse

    if loc.accuracyClass == "suburb" and loc.address and loc.address.strip():
        dest = loc.address
    else:
        dest = f"{loc.latitude},{loc.longitude}"
    encoded = urllib.parse.quote(dest, safe="")
    return f"https://www.google.com/maps/dir/?api=1&destination={encoded}"


def format_distance_label(distance_km: float) -> str:
    """Format distance in rounded metres for Delta < 1, else 1 decimal km."""
    if distance_km < 1.0:
        return f"{round(1000.0 * distance_km)} m"
    return f"{distance_km:.1f} km"


def export_nearby_backup(state: NearbyState) -> Dict[str, Any]:
    """Export (X, bar_s, f, h, p, Q, P_T, P_I) using their read functions."""
    bar_s = resolve_starting_point(state.s, state.X)
    f_val, p_val, h_val = read_preferences(state.f, state.p, state.h, state.U)
    valid_q: Dict[str, Dict[str, Any]] = {}
    for k in state.Q:
        rec = read_valid_checklist_entry(state.Q, k)
        if rec is not None:
            valid_q[k] = {"phi": rec.phi, "delta": rec.delta}

    return {
        "X": {k: dataclasses.asdict(v) for k, v in state.X.items()},
        "s": dataclasses.asdict(bar_s) if bar_s is not None else None,
        "f": f_val,
        "h": list(h_val),
        "p": p_val,
        "Q": valid_q,
        "P_T": sorted(state.P_T, key=UTF16_KEY),
        "P_I": sorted(state.P_I, key=UTF16_KEY),
    }


def import_nearby_backup(
    state: NearbyState, backup: Dict[str, Any], mode: str = "merge"
) -> None:
    """
    Validate the entire backup before any mutation, then apply Section 11
    merge or replace equations.
    """
    _guard_mutable(state)
    if mode not in ("merge", "replace"):
        raise ValidationError("Import mode must be 'merge' or 'replace'.")

    # 1. Validate X_b
    x_b: Dict[str, LocationRecord] = {}
    if "X" in backup and backup["X"] is not None:
        if not isinstance(backup["X"], dict):
            raise ValidationError("Backup field X must be a map.")
        for cid, raw_loc in backup["X"].items():
            if not isinstance(cid, str) or not cid.startswith("custom-") or len(cid) <= len("custom-"):
                raise ValidationError(f"Invalid custom ID in backup: {cid!r}")
            loc = LocationRecord(**raw_loc) if isinstance(raw_loc, dict) else raw_loc
            if (
                loc.id != cid
                or not loc.name.strip()
                or not is_valid_coord(loc.lat, loc.lon)
                or not loc.tags
                or any(not OPTIONAL_HASH_WORD_RE.match(t.strip()) for t in loc.tags)
                or (loc.accuracyClass is not None and loc.accuracyClass not in ACCURACY_CLASSES)
            ):
                raise ValidationError(f"Invalid custom location record for {cid!r}")
            x_b[cid] = copy.deepcopy(loc)

    # 2. Validate Q_b
    q_b: Dict[str, ChecklistStateRecord] = {}
    if "Q" in backup and backup["Q"] is not None:
        if not isinstance(backup["Q"], dict):
            raise ValidationError("Backup field Q must be a map.")
        for k in backup["Q"]:
            if not isinstance(k, str) or not k.strip():
                raise ValidationError("Checklist key must be nonempty.")
            rec = read_valid_checklist_entry(backup["Q"], k)
            if rec is None:
                raise ValidationError(f"Invalid checklist record for key {k!r}")
            q_b[k] = rec

    # 3. Validate P_T and P_I
    pt_b: Set[str] = set()
    if "P_T" in backup and backup["P_T"] is not None:
        if not isinstance(backup["P_T"], (list, tuple, set)):
            raise ValidationError("P_T must be a collection.")
        for t in backup["P_T"]:
            if not isinstance(t, str) or not OPTIONAL_HASH_WORD_RE.match(t.strip()):
                raise ValidationError(f"Invalid paused tag in backup: {t!r}")
            pt_b.add(normalize_tag(t, state.brand_aliases))

    pi_b: Set[str] = set()
    if "P_I" in backup and backup["P_I"] is not None:
        if not isinstance(backup["P_I"], (list, tuple, set)):
            raise ValidationError("P_I must be a collection.")
        for iid in backup["P_I"]:
            if not isinstance(iid, str) or not iid.strip():
                raise ValidationError("Paused item ID must be nonblank.")
            pi_b.add(iid)

    # 4. Validate s, f, h, p if supplied
    s_supplied = "s" in backup
    s_b: Optional[StartingLocationRecord] = None
    if s_supplied and backup["s"] is not None:
        raw_s = backup["s"]
        s_b = StartingLocationRecord(**raw_s) if isinstance(raw_s, dict) else copy.copy(raw_s)
        if not is_valid_starting_record(s_b):
            raise ValidationError("Invalid starting location in backup.")

    f_supplied = "f" in backup and backup["f"] is not None
    if f_supplied and not isinstance(backup["f"], bool):
        raise ValidationError("Backup filter f must be a Boolean.")

    p_supplied = "p" in backup and backup["p"] is not None
    if p_supplied:
        raw_p = backup["p"]
        if isinstance(raw_p, bool) or not isinstance(raw_p, int) or not (1 <= raw_p <= 50):
            raise ValidationError("Backup preview limit p must be an integer in 1..50.")

    h_supplied = "h" in backup and backup["h"] is not None
    if h_supplied:
        raw_h = backup["h"]
        known_ids = {u.id for u in state.U}
        if (
            not isinstance(raw_h, (list, tuple))
            or len(set(raw_h)) != len(raw_h)
            or any(not isinstance(x, str) or x not in known_ids for x in raw_h)
        ):
            raise ValidationError("Backup hot suburbs h must be unique known suburb IDs.")

    # Apply atomic updates
    if mode == "replace":
        state.X = dict(x_b)
        state.Q = dict(q_b)
        state.P_T = set(pt_b)
        state.P_I = set(pi_b)
    else:
        state.X.update(x_b)
        state.Q.update(q_b)
        state.P_T.update(pt_b)
        state.P_I.update(pi_b)

    if s_supplied and s_b is not None:
        state.s = s_b
    elif mode == "replace" or (s_supplied and backup["s"] is None):
        state.s = None

    raw_f_final = backup["f"] if f_supplied else (None if mode == "replace" else state.f)
    raw_p_final = backup["p"] if p_supplied else (None if mode == "replace" else state.p)
    raw_h_final = backup["h"] if h_supplied else (None if mode == "replace" else state.h)
    state.f, state.p, state.h = read_preferences(raw_f_final, raw_p_final, raw_h_final, state.U)
    state.undo_stack.append(f"import_backup:{mode}")


if __name__ == "__main__":
    # Self-contained verification of the mathematical specification
    suburbs = [
        SuburbRecord(id="melb", name="Melbourne", latitude=-37.8136, longitude=144.9631),
        SuburbRecord(id="brun", name="Brunswick", latitude=-37.7667, longitude=144.9603),
        SuburbRecord(id="rich", name="Richmond", latitude=-37.8183, longitude=145.0018),
        SuburbRecord(id="mtwav", name="Mt. Waverley", latitude=-37.8770, longitude=145.1280),
    ]
    bundled = [
        LocationRecord(
            id="coles-brunswick",
            name="Coles Brunswick",
            latitude=-37.7680,
            longitude=144.9610,
            tags=["#coles"],
            accuracyClass="store",
        ),
        LocationRecord(
            id="bunnings-brunswick",
            name="Bunnings Brunswick",
            latitude=-37.7695,
            longitude=144.9590,
            tags=["#bunnings", "#coles"],
            accuracyClass="store",
        ),
    ]
    lists_map = {
        "list-shop": ListRecord(id="list-shop", name="Weekly Shopping #supermarket"),
        "list-errands": ListRecord(id="list-errands", name="General Tasks"),
    }
    items_seq = read_all_items([
        {"id": "item-milk", "listId": "list-shop", "name": "Buy milk #woolies", "order": 2},
        {"id": "item-bread", "listId": "list-shop", "name": "Sourdough bread", "order": 1},
        {"id": "item-drill", "listId": "list-errands", "name": "Hammer drill #hardware", "order": 1},
        {"id": "item-atm", "listId": "list-errands", "name": "Deposit cash #bank", "order": 2},
    ])

    state = NearbyState(
        I=items_seq,
        L=lists_map,
        B=bundled,
        U=suburbs,
        h=["melb", "brun", "rich"],
    )
    select_suburb_origin(state, suburbs[1], "2026-10-14T09:00:00Z")
    vm = sync_live_checklist_membership(state)

    assert len(vm.membership.C) == 4, "All 4 items should be valid candidates"
    assert len(vm.planner.suggested) == 1, "Bunnings Brunswick covers both #coles and #bunnings!"
    assert vm.planner.suggested[0].location.id == "bunnings-brunswick"
    assert search_suburbs(suburbs, "mount waverly")[0].id == "mtwav"
    print("All mathematical specification assertions passed successfully!")