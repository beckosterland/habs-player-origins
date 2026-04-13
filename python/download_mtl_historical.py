"""
MTL Historical Roster CSV Exporter with Geocoding & Per-Season Stats
Fetches every Montreal Canadiens roster from the 1917-18 season through the
current season using the official NHL API, geocodes each birth city using the
free Photon / Nominatim APIs, and exports to CSV.

One row is written per player-season appearance. Stats are pulled from the
seasonTotals field already returned by the player landing endpoint (no extra
API calls). Skater stats (goals, assists, etc.) and goalie stats (wins, GAA,
etc.) are stored in separate columns; non-applicable columns are left empty.

Columns: player_id, full_name, position, season, jersey_number,
         birth_city, birth_state_province, birth_country_code, birth_country,
         birthdate, nationality, height, weight_lbs, birth_lat, birth_lon,
         headshot_url,
         games_played, goals, assists, points, plus_minus, pim,
         wins, losses, goals_against_avg, save_pct, shutouts

Requirements:
    pip install requests pycountry
"""

import requests
import csv
import time
import pycountry
import os
from datetime import date

BASE_URL = "https://api-web.nhle.com/v1"
TEAM = "MTL"

# Photon (primary geocoder — no strict rate limit, no key needed)
PHOTON_URL = "https://photon.komoot.io/api/"
# Nominatim (fallback — requires >=1 req/sec and a descriptive User-Agent)
NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"

HEADERS = {"User-Agent": "NHL-Player-Geocoder/1.0 (educational/research use)"}

# Season range: 1917-18 is the first NHL season; determine end from today's date.
FIRST_YEAR = 1917
current_year = date.today().year
# If we're past June the new season has started; otherwise use prior year as start
LAST_YEAR = current_year if date.today().month >= 7 else current_year - 1


# ── Country code helpers ───────────────────────────────────────────────────────

def alpha3_to_name(code: str) -> str:
    """Convert a 3-letter ISO country code to its full name (e.g. 'SVK' -> 'Slovakia').
    Returns the original code unchanged if not found."""
    if not code:
        return code
    _overrides = {
        "RUS": "Russia",
        "CZE": "Czech Republic",
        "KOR": "South Korea",
        "PRK": "North Korea",
    }
    if code.upper() in _overrides:
        return _overrides[code.upper()]
    country = pycountry.countries.get(alpha_3=code.upper())
    return country.name if country else code


# ── Geocoding ─────────────────────────────────────────────────────────────────

# Cache so each unique city is only looked up once across all seasons
_geocache: dict[str, tuple[str, str]] = {}


def _geocode_photon(city: str, province: str, country_name: str) -> tuple[str, str]:
    """Try Photon (komoot) geocoder. Returns ("", "") on failure."""
    if city and province and country_name:
        query = f"{city}, {province}, {country_name}"
    elif city and country_name:
        query = f"{city}, {country_name}"
    else:
        query = city

    try:
        r = requests.get(
            PHOTON_URL,
            params={"q": query, "limit": 1, "lang": "en"},
            headers=HEADERS,
            timeout=10,
        )
        if r.status_code == 429:
            print("(Photon rate-limited, waiting 5s...)", end=" ", flush=True)
            time.sleep(5)
            return "", ""
        r.raise_for_status()
        data = r.json()
        features = data.get("features", [])
        if features:
            lon, lat = features[0]["geometry"]["coordinates"]
            return str(lat), str(lon)
    except requests.RequestException:
        pass
    return "", ""


def _geocode_nominatim(city: str, province: str, country_name: str, country_code: str) -> tuple[str, str]:
    """Try Nominatim with structured params, falling back to looser queries."""
    country = country_name or country_code
    attempts = []
    if city and province and country:
        attempts.append({"city": city, "state": province, "country": country})
    if city and country:
        attempts.append({"city": city, "country": country})
    if city and province:
        attempts.append({"city": city, "state": province})
    if city:
        attempts.append({"city": city})

    for structured in attempts:
        params = {**structured, "format": "json", "limit": 1, "addressdetails": 0}
        try:
            r = requests.get(NOMINATIM_URL, params=params, headers=HEADERS, timeout=10)
            if r.status_code == 429:
                print("(Nominatim rate-limited, waiting 10s...)", end=" ", flush=True)
                time.sleep(10)
                return "", ""
            r.raise_for_status()
            results = r.json()
            if results:
                return results[0]["lat"], results[0]["lon"]
        except requests.RequestException:
            pass
        time.sleep(1.1)  # Nominatim requires >=1 req/sec
    return "", ""


def geocode_city(city: str, province: str, country_code: str, country_name: str) -> tuple[str, str]:
    """
    Return (latitude, longitude) strings for a birth location.
    Tries Photon first, then falls back to Nominatim.
    Results are cached so each unique city is only looked up once.
    Returns ("", "") if neither service finds a result.
    """
    cache_key = f"{city}|{province}|{country_code}"
    if cache_key in _geocache:
        return _geocache[cache_key]

    lat, lon = _geocode_photon(city, province, country_name)

    if not lat:
        lat, lon = _geocode_nominatim(city, province, country_name, country_code)

    if not lat:
        time.sleep(1.1)

    _geocache[cache_key] = (lat, lon)
    return lat, lon


# ── NHL API helpers ────────────────────────────────────────────────────────────

def season_code(start_year: int) -> str:
    """Convert a season start year to the NHL API season code (e.g. 1917 -> '19171918')."""
    return f"{start_year}{start_year + 1}"


def get_roster(team: str, season: str) -> list[dict]:
    """Fetch roster for a team and season code (e.g. '19171918')."""
    url = f"{BASE_URL}/roster/{team}/{season}"
    try:
        r = requests.get(url, timeout=10)
        if r.status_code == 404:
            return []  # Season doesn't exist for this team
        r.raise_for_status()
        data = r.json()
    except requests.RequestException as e:
        print(f"  Warning: Could not fetch roster for {team} {season}: {e}")
        return []

    players = []
    for group in ("forwards", "defensemen", "goalies"):
        for p in data.get(group, []):
            p["_season"] = season
            players.append(p)
    return players


# Cache player landing responses — same player can appear across many seasons
_details_cache: dict[int, dict] = {}


def get_player_details(player_id: int) -> dict:
    """Fetch full player profile including birthplace and seasonTotals. Cached."""
    if player_id in _details_cache:
        return _details_cache[player_id]
    url = f"{BASE_URL}/player/{player_id}/landing"
    try:
        r = requests.get(url, timeout=10)
        r.raise_for_status()
        data = r.json()
    except requests.RequestException as e:
        print(f"  Warning: Could not fetch details for player {player_id}: {e}")
        data = {}
    _details_cache[player_id] = data
    return data


def get_season_stats(season_totals: list[dict], season: str, position: str) -> dict:
    """
    Extract NHL stats for a specific season from the seasonTotals array.
    If the player was traded mid-season, numeric stats are summed across
    all NHL entries for that season. Averages (GAA, SV%) are weighted by
    games played.

    Returns a flat dict with all stat columns; non-applicable fields are "".
    """
    # seasonTotals season field is an integer in the API (e.g. 20242025)
    nhl_entries = [
        s for s in season_totals
        if str(s.get("season", "")) == season and s.get("leagueAbbrev") == "NHL"
    ]

    # Empty template — all stat columns present so CSV columns stay consistent
    empty = {
        "games_played": "", "goals": "", "assists": "", "points": "",
        "plus_minus": "", "pim": "",
        "wins": "", "losses": "", "goals_against_avg": "", "save_pct": "", "shutouts": "",
    }

    if not nhl_entries:
        return empty

    gp = sum(e.get("gamesPlayed", 0) for e in nhl_entries)

    if position == "G":
        wins     = sum(e.get("wins", 0)     for e in nhl_entries)
        losses   = sum(e.get("losses", 0)   for e in nhl_entries)
        shutouts = sum(e.get("shutouts", 0) for e in nhl_entries)
        # Weight averages by games played to handle mid-season trades
        gaa = (
            round(sum(e.get("goalsAgainstAvg", 0) * e.get("gamesPlayed", 0) for e in nhl_entries) / gp, 3)
            if gp else ""
        )
        sv_pct = (
            round(sum(e.get("savePctg", 0) * e.get("gamesPlayed", 0) for e in nhl_entries) / gp, 3)
            if gp else ""
        )
        return {**empty, "games_played": gp, "wins": wins, "losses": losses,
                "goals_against_avg": gaa, "save_pct": sv_pct, "shutouts": shutouts}
    else:
        goals      = sum(e.get("goals", 0)      for e in nhl_entries)
        assists    = sum(e.get("assists", 0)     for e in nhl_entries)
        points     = sum(e.get("points", 0)      for e in nhl_entries)
        plus_minus = sum(e.get("plusMinus", 0)   for e in nhl_entries)
        pim        = sum(e.get("pim", 0)         for e in nhl_entries)
        return {**empty, "games_played": gp, "goals": goals, "assists": assists,
                "points": points, "plus_minus": plus_minus, "pim": pim}


def inches_to_str(inches: int | None) -> str:
    if inches is None:
        return ""
    feet, rem = divmod(inches, 12)
    return f"{feet}'{rem}\""


# ── Manual overrides ──────────────────────────────────────────────────────────
# Corrections for players whose geocoded birthplace data was wrong or missing.
# Keyed by player_id; only the specified fields are overwritten. Applied to
# every row for that player so birth coordinates stay consistent across seasons.

MANUAL_OVERRIDES: dict[int, dict] = {
    8446047: {  # Rick Chartraw — born in Caracas, Venezuela
        "birth_city": "Caracas",
        "birth_lat":  "10.48265705916962",
        "birth_lon":  "-66.90414345846824",
    },
    8448331: {  # Jack Riley — born in Brackloney, County Cavan, Ireland
        "birth_city": "Brackloney",
        "birth_lat":  "53.79573031110086",
        "birth_lon":  "-7.1875956644436485",
    },
    8448651: {  # Rod Langway — born in Taipei, Taiwan
        "birth_city": "Taipei",
        "birth_lat":  "25.0329636",
        "birth_lon":  "121.5654268",
    },
}


# ── Main ───────────────────────────────────────────────────────────────────────

def main():
    all_rows: list[dict] = []

    # Track geocoded player base data so we only geocode once per unique player
    _player_base: dict[int, dict] = {}

    seasons = [season_code(y) for y in range(FIRST_YEAR, LAST_YEAR + 1)]
    print(f"Fetching {TEAM} rosters for {len(seasons)} seasons "
          f"({seasons[0]} → {seasons[-1]})...\n")

    for season in seasons:
        print(f"  [{season}] fetching roster...", end=" ", flush=True)
        stubs = get_roster(TEAM, season)
        print(f"{len(stubs)} players")

        for stub in stubs:
            pid = stub.get("id")
            if pid is None:
                continue

            # ── Fetch & cache player details ───────────────────────────────
            details = get_player_details(pid)
            if not details:
                continue

            # ── Build base player data once per unique player ──────────────
            if pid not in _player_base:
                first = details.get("firstName", {}).get("default", stub.get("firstName", {}).get("default", ""))
                last  = details.get("lastName",  {}).get("default", stub.get("lastName",  {}).get("default", ""))

                birth_city     = details.get("birthCity", {}).get("default", "")
                birth_province = details.get("birthStateProvince", {}).get("default", "")
                birth_country  = details.get("birthCountry", "")
                birth_country_name = alpha3_to_name(birth_country)
                birthdate      = details.get("birthDate", "")
                position       = details.get("position", stub.get("positionCode", ""))
                height         = details.get("heightInInches")
                weight         = details.get("weightInPounds")
                nationality    = details.get("nationalityCode", "")
                headshot       = details.get("headshot", "")

                # Geocode (cached — repeated cities cost nothing extra)
                cache_hit = f"{birth_city}|{birth_province}|{birth_country}" in _geocache
                if not cache_hit:
                    print(f"    Geocoding: {birth_city}, {birth_province}, {birth_country_name}...",
                          end=" ", flush=True)
                lat, lon = geocode_city(birth_city, birth_province, birth_country, birth_country_name)
                if not cache_hit:
                    print(f"({lat}, {lon})" if lat else "not found")

                base = {
                    "player_id":            pid,
                    "full_name":            f"{first} {last}".strip(),
                    "position":             position,
                    "birth_city":           birth_city,
                    "birth_state_province": birth_province,
                    "birth_country_code":   birth_country,
                    "birth_country":        birth_country_name,
                    "birthdate":            birthdate,
                    "nationality":          nationality,
                    "height":               inches_to_str(height),
                    "weight_lbs":           weight if weight else "",
                    "birth_lat":            lat,
                    "birth_lon":            lon,
                    "headshot_url":         headshot,
                }

                # Apply manual override to birth fields if needed
                if pid in MANUAL_OVERRIDES:
                    base.update(MANUAL_OVERRIDES[pid])

                _player_base[pid] = base

                time.sleep(0.05)  # Small pause between NHL API calls

            # ── Build per-season stats row ─────────────────────────────────
            jersey       = stub.get("sweaterNumber", details.get("sweaterNumber", ""))
            season_totals = details.get("seasonTotals", [])
            position      = _player_base[pid]["position"]
            stats         = get_season_stats(season_totals, season, position)

            row = {
                **_player_base[pid],
                "season":       season,
                "jersey_number": jersey,
                **stats,
            }
            all_rows.append(row)

    # Sort by season then player_id for deterministic output
    all_rows.sort(key=lambda r: (r["season"], r["player_id"]))

    # Write CSV
    output_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data")
    os.makedirs(output_dir, exist_ok=True)
    output_file = os.path.join(output_dir, "mtl_historical_players.csv")

    fieldnames = [
        "player_id", "full_name", "position", "season", "jersey_number",
        "birth_city", "birth_state_province", "birth_country_code", "birth_country",
        "birthdate", "nationality", "height", "weight_lbs",
        "birth_lat", "birth_lon", "headshot_url",
        # Skater stats
        "games_played", "goals", "assists", "points", "plus_minus", "pim",
        # Goalie stats
        "wins", "losses", "goals_against_avg", "save_pct", "shutouts",
    ]

    with open(output_file, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(all_rows)

    found = sum(1 for r in all_rows if r["birth_lat"])
    unique_players = len(_player_base)
    print(f"\nDone! {len(all_rows)} player-season rows ({unique_players} unique players) "
          f"written to '{output_file}'")
    print(f"Geocoded: {found}/{len(all_rows)} rows with birth coordinates.")
    print(f"Seasons covered: {seasons[0]} → {seasons[-1]}")


if __name__ == "__main__":
    main()
