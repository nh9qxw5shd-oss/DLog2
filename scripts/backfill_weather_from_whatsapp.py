#!/usr/bin/env python3
"""Parse EM State of the Route WhatsApp export into weather_lookahead rows.

One message per day (~05:30) contains a "Weather Forecast Summary" section
stating each region's level (Normal/Green, Aware, Adverse, Extreme) and the
named risks. The message is sent on the morning of the day it describes, so
weather_date = message date.
"""
import json, re, sys, unicodedata
from collections import defaultdict

CHAT = sys.argv[1] if len(sys.argv) > 1 else "_chat.txt"

HDR = re.compile(r"^‎?\[(\d{2})/(\d{2})/(\d{4}), (\d{2}):(\d{2}):(\d{2})\] ([^:]+): (.*)$")

# ── split into messages ──────────────────────────────────────────────────────
messages = []  # (date, time, sender, text)
cur = None
with open(CHAT, encoding="utf-8") as f:
    for raw in f:
        line = raw.rstrip("\n").rstrip("\r")
        m = HDR.match(line)
        if m:
            if cur:
                messages.append(cur)
            d, mo, y, hh, mm, ss = m.groups()[:6]
            cur = {
                "date": f"{y}-{mo}-{d}",
                "time": f"{hh}:{mm}",
                "sender": m.group(7),
                "lines": [m.group(8)],
            }
        elif cur:
            cur["lines"].append(line)
    if cur:
        messages.append(cur)

# ── pick the weather section out of each message ─────────────────────────────
STOP = re.compile(r"^\s*[*_]*\s*(Max Temperatures|Forecast\s*[-–]|Engineering|Critical Works)", re.I)

def weather_section(lines):
    for i, ln in enumerate(lines):
        if "Weather Forecast Summary" in ln:
            out = []
            for ln2 in lines[i + 1 : i + 12]:
                if STOP.search(ln2):
                    break
                out.append(ln2)
            return out
    return None

# ── level + risk extraction ──────────────────────────────────────────────────
LEVEL_WORDS = [
    ("EXTREME", "EXTREME"),
    ("RED", "EXTREME"),
    ("ADVERSE", "ADVERSE"),
    ("AMBER", "ADVERSE"),
    ("AWARE", "AWARE"),
    ("YELLOW", "AWARE"),
    ("NORMAL", "GREEN"),
    ("GREEN", "GREEN"),
]
LEVEL_WORD_RE = re.compile(r"\b(EXTREME|RED|ADVERSE|AMBER|AWARE|YELLOW|NORMAL|GREEN)\b", re.I)
EMOJI_LEVEL = {"\U0001F7E2": "GREEN", "\U0001F7E1": "AWARE", "\U0001F7E0": "ADVERSE", "\U0001F534": "EXTREME"}

RISK_PATTERNS = [
    (r"convective", "Convective Rainfall"),
    (r"light?ning|lighning|lighting", "Lightning"),
    (r"heavy rain|rain accum|rainfall accum", "Heavy Rain"),
    (r"\bwind", "Wind"),
    (r"\bsnow", "Snow"),
    (r"frost", "Frost"),
    (r"min(imum)?\s*temp|low\s*temp", "Min Temp"),
    (r"max(imum)?\s*temp|high\s*temp", "Max Temp"),
    (r"temp(erature)?\s*range", "Temp Range"),
    (r"\bice\b", "Ice Day"),
]

RANK = {"GREEN": 0, "AWARE": 1, "ADVERSE": 2, "EXTREME": 3}

def find_risks(text):
    found = []
    low = text.lower()
    for pat, name in RISK_PATTERNS:
        if re.search(pat, low) and name not in found:
            found.append(name)
    return found

NO_HAZARD_RE = re.compile(r"no\s+(expected\s+|predicted\s+|elevated\s+)?(hazards?|risks?)", re.I)

def parse_line_level(text):
    """Explicit level word wins; emoji is the fallback (compilers sometimes
    forget to change the circle but do change the word). Exception: a green
    circle plus an explicit 'No hazards' beats a stray level word."""
    if "🟢" in text and NO_HAZARD_RE.search(text):
        return "GREEN"
    m = LEVEL_WORD_RE.search(text)
    if m:
        return dict(LEVEL_WORDS)[m.group(1).upper()]
    for ch, lvl in EMOJI_LEVEL.items():
        if ch in text:
            return lvl
    return None

def parse_risk_levels(text, line_level):
    """Assign a level to each named risk. Text segments following an embedded
    level word (e.g. 'EXTREME Max Temp, ADVERSE for Convective Rainfall &
    AWARE for Temp Range') take that word's level; anything before the first
    embedded word takes the line's level."""
    tokens = LEVEL_WORD_RE.split(text)
    risks = {}
    level = line_level
    for tok in tokens:
        up = tok.upper()
        matched = next((lvl for w, lvl in LEVEL_WORDS if w == up), None)
        if matched:
            level = matched
            continue
        for r in find_risks(tok):
            if level in ("AWARE", "ADVERSE", "EXTREME"):
                # keep the worst if a risk is named twice
                if r not in risks or RANK[level] > RANK[risks[r]]:
                    risks[r] = level
    return risks

def clean(s):
    s = unicodedata.normalize("NFKC", s)
    return s.replace("‎", "").replace("‏", "").replace("*", "").replace("_", " ").strip()

def parse_section(section):
    """Return {'eastMidlands': {risk: lvl}, 'londonNorth': {...},
    'emLevel', 'lnLevel', 'raw'} or None."""
    em_level = ln_level = None
    em_risks, ln_risks = {}, {}
    raw_lines = []
    anon = []   # short region-less level lines, in EM-then-LN order
    # a single prose line can rate the two regions differently in consecutive
    # sentences ("A Yellow/Aware day … East Midlands. An Amber/Adverse day …
    # London North …") — split those so each sentence carries its own level
    expanded = []
    for ln in section:
        low = ln.lower()
        both = ("east mid" in low or "east mids" in low) and ("london north" in low or "north london" in low)
        levels_in_line = {dict(LEVEL_WORDS)[w.upper()] for w in LEVEL_WORD_RE.findall(ln)}
        if both and len(levels_in_line) > 1 and ". " in ln:
            expanded.extend(re.split(r"(?<=[.!?])\s+", ln))
        else:
            expanded.append(ln)
    EM_RE = re.compile(r"east midlands|east mids|\bem\b")
    LN_RE = re.compile(r"london north|north london|\bln\b")

    def bump(region, lvl, risks):
        nonlocal em_level, ln_level
        if region == "em":
            if em_level is None or RANK[lvl] > RANK[em_level]:
                em_level = lvl
            for r, l in risks.items():
                if r not in em_risks or RANK[l] > RANK[em_risks[r]]:
                    em_risks[r] = l
        else:
            if ln_level is None or RANK[lvl] > RANK[ln_level]:
                ln_level = lvl
            for r, l in risks.items():
                if r not in ln_risks or RANK[l] > RANK[ln_risks[r]]:
                    ln_risks[r] = l

    for ln in expanded:
        c = clean(ln)
        if not c:
            continue
        low = c.lower()
        mentions_em = bool(EM_RE.search(low))
        mentions_ln = bool(LN_RE.search(low))
        # one line rating the two regions differently ("ADVERSE day on the
        # East Midlands and EXTREME for London North due to High Temps"):
        # associate each level word with the text that follows it
        levels_here = {dict(LEVEL_WORDS)[w.upper()] for w in LEVEL_WORD_RE.findall(c)}
        if mentions_em and mentions_ln and len(levels_here) > 1:
            raw_lines.append(c)
            tokens = LEVEL_WORD_RE.split(c)
            for i in range(1, len(tokens), 2):
                lvl = dict(LEVEL_WORDS)[tokens[i].upper()]
                seg = tokens[i + 1] if i + 1 < len(tokens) else ""
                segl = seg.lower()
                risks = {r: lvl for r in find_risks(segl)} if RANK[lvl] > 0 else {}
                if EM_RE.search(segl):
                    bump("em", lvl, risks)
                if LN_RE.search(segl):
                    bump("ln", lvl, risks)
            continue
        if not (mentions_em or mentions_ln):
            # prose line that names neither region explicitly but talks about
            # the route ("A GREEN day is forecast on the Route") — apply both
            if re.search(r"\b(day|route)\b", low) and parse_line_level(ln):
                mentions_em = mentions_ln = True
            elif len(c) < 80 and parse_line_level(ln):
                # bare summary line ("🟡 AWARE Max Temp") — some editions list
                # the two regions positionally, EM first then LN
                anon.append((parse_line_level(ln), parse_risk_levels(c, parse_line_level(ln)), c))
                continue
            else:
                continue
        raw_lines.append(c)
        lvl = parse_line_level(ln)
        if lvl is None:
            continue
        # strip region names so 'North'/'Midlands' don't confuse risk parsing
        body = re.sub(r"east midlands|east mids|london north|north london", " ", c, flags=re.I)
        risks = parse_risk_levels(body, lvl)
        # 'the East Midlands Route' alone = the whole route → both regions
        whole_route = mentions_em and not mentions_ln and "route" in low and "london" not in low and (
            "day" in low or "forecast" in low)
        if mentions_em or whole_route:
            if em_level is None or RANK[lvl] > RANK[em_level]:
                em_level = lvl
            for r, l in risks.items():
                if r not in em_risks or RANK[l] > RANK[em_risks[r]]:
                    em_risks[r] = l
        if mentions_ln or whole_route:
            if ln_level is None or RANK[lvl] > RANK[ln_level]:
                ln_level = lvl
            for r, l in risks.items():
                if r not in ln_risks or RANK[l] > RANK[ln_risks[r]]:
                    ln_risks[r] = l
    if em_level is None and ln_level is None and anon:
        em_level, em_risks, em_raw = anon[0]
        ln_level, ln_risks, ln_raw = anon[1] if len(anon) > 1 else anon[0]
        raw_lines = [f"EM: {em_raw}", f"LN: {ln_raw}"]
    if em_level is None and ln_level is None:
        return None
    # a single-region statement covers the route unless the other was stated
    if em_level is None:
        em_level, em_risks = ln_level, dict(ln_risks)
    if ln_level is None:
        ln_level, ln_risks = em_level, dict(em_risks)
    # an elevated region whose own sentence named no risks shares the day's
    # named hazards at its own severity ("due to …" trailing one sentence)
    if RANK[em_level] > 0 and not em_risks and ln_risks:
        em_risks = {r: em_level for r in ln_risks}
    if RANK[ln_level] > 0 and not ln_risks and em_risks:
        ln_risks = {r: ln_level for r in em_risks}
    # a region rated X whose own clause named no X-level risk shares the other
    # region's X-level hazards (the "due to …" clause covers both regions)
    if RANK[em_level] > 0 and not any(RANK[l] == RANK[em_level] for l in em_risks.values()):
        for r, l in ln_risks.items():
            if RANK[l] == RANK[em_level] and r not in em_risks:
                em_risks[r] = l
    if RANK[ln_level] > 0 and not any(RANK[l] == RANK[ln_level] for l in ln_risks.values()):
        for r, l in em_risks.items():
            if RANK[l] == RANK[ln_level] and r not in ln_risks:
                ln_risks[r] = l
    # a region is at least as severe as its worst named risk
    for lvl_risks in (em_risks, ln_risks):
        for l in lvl_risks.values():
            if lvl_risks is em_risks and RANK[l] > RANK[em_level]:
                em_level = l
            if lvl_risks is ln_risks and RANK[l] > RANK[ln_level]:
                ln_level = l
    return {
        "emLevel": em_level, "lnLevel": ln_level,
        "emRisks": em_risks, "lnRisks": ln_risks,
        "raw": " | ".join(raw_lines)[:500],
    }

# ── walk messages, keep the last morning statement per date ──────────────────
by_date = {}
unparsed = []
for msg in messages:
    section = weather_section(msg["lines"])
    if section is None:
        continue
    parsed = parse_section(section)
    if parsed is None:
        unparsed.append((msg["date"], msg["time"], " / ".join(section)[:200]))
        continue
    morning = "04:00" <= msg["time"] <= "10:00"
    prev = by_date.get(msg["date"])
    # prefer morning statements; among equals, the later one (corrections win)
    if prev is None or (morning and not prev["morning"]) or morning == prev["morning"]:
        by_date[msg["date"]] = {**parsed, "time": msg["time"], "morning": morning}

rows = []
for date in sorted(by_date):
    p = by_date[date]
    overall = max((p["emLevel"], p["lnLevel"]), key=lambda l: RANK[l])
    risk_types = sorted(set(p["emRisks"]) | set(p["lnRisks"]))
    rows.append({
        "weather_date": date,
        "em_level": p["emLevel"], "ln_level": p["lnLevel"], "overall": overall,
        "em_risks": p["emRisks"], "ln_risks": p["lnRisks"],
        "risk_types": risk_types,
        "raw": p["raw"], "time": p["time"],
    })

with open("weather_rows.json", "w", encoding="utf-8") as f:
    json.dump(rows, f, ensure_ascii=False, indent=1)

levels = defaultdict(int)
for r in rows:
    levels[r["overall"]] += 1
print(f"messages: {len(messages)}, weather sections: {sum(1 for m in messages if weather_section(m['lines']))}")
print(f"dates parsed: {len(rows)}  range: {rows[0]['weather_date']} → {rows[-1]['weather_date']}")
print("overall level distribution:", dict(levels))
print(f"unparsed sections: {len(unparsed)}")
for u in unparsed[:15]:
    print("  UNPARSED", u)
