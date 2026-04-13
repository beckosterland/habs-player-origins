"""
NHL Active Players CSV Exporter with Geocoding
Fetches all active NHL players from the official NHL API, geocodes each
birth city using the free Nominatim (OpenStreetMap) API, and exports to CSV.

Columns: player_id, full_name, position, team, jersey_number,
         birth_city, birth_state_province, birth_country, birthdate,
         nationality, height, weight_lbs, birth_lat, birth_lon

Requirements:
    pip install requests
"""

import requests
import csv
import time
import pycountry

BASE_URL = "https://api-web.nhle.com/v1"
NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"

# Nominatim requires a descriptive User-Agent per their usage policy
HEADERS = {"User-Agent": "NHL-Player-Geocoder/1.0 (educational/research use)"}


# Team full names, home arenas, and arena coordinates (lat/lon).
# Coordinates are the arena centroid — precise enough for mapping purposes.
# Arena names verified against Wikipedia's "List of National Hockey League arenas" (April 2026).
# Coordinates sourced from each arena's individual Wikipedia page / infobox.
TEAM_INFO: dict[str, dict] = {
    "ANA": {"full_name": "Anaheim Ducks",          "arena": "Honda Center",                "arena_lat": 33.8078,  "arena_lon": -117.8765},
    "BOS": {"full_name": "Boston Bruins",           "arena": "TD Garden",                   "arena_lat": 42.3662,  "arena_lon": -71.0621},
    "BUF": {"full_name": "Buffalo Sabres",          "arena": "KeyBank Center",              "arena_lat": 42.8750,  "arena_lon": -78.8764},
    "CAR": {"full_name": "Carolina Hurricanes",     "arena": "Lenovo Center",               "arena_lat": 35.8033,  "arena_lon": -78.7220},
    "CBJ": {"full_name": "Columbus Blue Jackets",   "arena": "Nationwide Arena",            "arena_lat": 39.9693,  "arena_lon": -83.0061},
    "CGY": {"full_name": "Calgary Flames",          "arena": "Scotiabank Saddledome",       "arena_lat": 51.0374,  "arena_lon": -114.0519},
    "CHI": {"full_name": "Chicago Blackhawks",      "arena": "United Center",               "arena_lat": 41.8806,  "arena_lon": -87.6742},
    "COL": {"full_name": "Colorado Avalanche",      "arena": "Ball Arena",                  "arena_lat": 39.7486,  "arena_lon": -105.0077},
    "DAL": {"full_name": "Dallas Stars",            "arena": "American Airlines Center",    "arena_lat": 32.7905,  "arena_lon": -96.8103},
    "DET": {"full_name": "Detroit Red Wings",       "arena": "Little Caesars Arena",        "arena_lat": 42.3411,  "arena_lon": -83.0548},
    "EDM": {"full_name": "Edmonton Oilers",         "arena": "Rogers Place",                "arena_lat": 53.5469,  "arena_lon": -113.4979},
    "FLA": {"full_name": "Florida Panthers",        "arena": "Amerant Bank Arena",          "arena_lat": 26.1584,  "arena_lon": -80.3256},
    "LAK": {"full_name": "Los Angeles Kings",       "arena": "Crypto.com Arena",            "arena_lat": 34.0430,  "arena_lon": -118.2673},
    "MIN": {"full_name": "Minnesota Wild",          "arena": "Grand Casino Arena",          "arena_lat": 44.9448,  "arena_lon": -93.1013},
    "MTL": {"full_name": "Montréal Canadiens",      "arena": "Bell Centre",                 "arena_lat": 45.4961,  "arena_lon": -73.5694},
    "NJD": {"full_name": "New Jersey Devils",       "arena": "Prudential Center",           "arena_lat": 40.7336,  "arena_lon": -74.1711},
    "NSH": {"full_name": "Nashville Predators",     "arena": "Bridgestone Arena",           "arena_lat": 36.1592,  "arena_lon": -86.7785},
    "NYI": {"full_name": "New York Islanders",      "arena": "UBS Arena",                   "arena_lat": 40.7226,  "arena_lon": -73.7236},
    "NYR": {"full_name": "New York Rangers",        "arena": "Madison Square Garden",       "arena_lat": 40.7505,  "arena_lon": -73.9934},
    "OTT": {"full_name": "Ottawa Senators",         "arena": "Canadian Tire Centre",        "arena_lat": 45.2969,  "arena_lon": -75.9271},
    "PHI": {"full_name": "Philadelphia Flyers",     "arena": "Xfinity Mobile Arena",        "arena_lat": 39.9012,  "arena_lon": -75.1720},
    "PIT": {"full_name": "Pittsburgh Penguins",     "arena": "PPG Paints Arena",            "arena_lat": 40.4395,  "arena_lon": -79.9892},
    "SEA": {"full_name": "Seattle Kraken",          "arena": "Climate Pledge Arena",        "arena_lat": 47.6221,  "arena_lon": -122.3544},
    "SJS": {"full_name": "San Jose Sharks",         "arena": "SAP Center",                  "arena_lat": 37.3329,  "arena_lon": -121.9011},
    "STL": {"full_name": "St. Louis Blues",         "arena": "Enterprise Center",           "arena_lat": 38.6267,  "arena_lon": -90.2025},
    "TBL": {"full_name": "Tampa Bay Lightning",     "arena": "Benchmark International Arena", "arena_lat": 27.9428, "arena_lon": -82.4519},
    "TOR": {"full_name": "Toronto Maple Leafs",     "arena": "Scotiabank Arena",            "arena_lat": 43.6435,  "arena_lon": -79.3791},
    "UTA": {"full_name": "Utah Mammoth",            "arena": "Delta Center",                "arena_lat": 40.7683,  "arena_lon": -111.9011},
    "VAN": {"full_name": "Vancouver Canucks",       "arena": "Rogers Arena",                "arena_lat": 49.2778,  "arena_lon": -123.1089},
    "VGK": {"full_name": "Vegas Golden Knights",    "arena": "T-Mobile Arena",              "arena_lat": 36.1030,  "arena_lon": -115.1787},
    "WPG": {"full_name": "Winnipeg Jets",           "arena": "Canada Life Centre",          "arena_lat": 49.8928,  "arena_lon": -97.1436},
    "WSH": {"full_name": "Washington Capitals",     "arena": "Capital One Arena",           "arena_lat": 38.8981,  "arena_lon": -77.0209},
}

# All 32 current NHL team abbreviations
NHL_TEAMS = [
    "MTL",
]


# ── Country code helpers ───────────────────────────────────────────────────────

def alpha3_to_name(code: str) -> str:
    """Convert a 3-letter ISO country code to its full name (e.g. 'SVK' -> 'Slovakia').
    Returns the original code unchanged if not found."""
    if not code:
        return code
    # A few pycountry names differ from what Nominatim expects
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




# Cache so each unique city is only looked up once
_geocache: dict[str, tuple[str, str]] = {}


def geocode_city(city: str, province: str, country_code: str, country_name: str) -> tuple[str, str]:
    """
    Return (latitude, longitude) strings for a birth location.
    Uses Nominatim's structured parameters (city/state/country separately)
    for maximum accuracy, with progressively looser fallbacks.
    country_name should be the full English name (e.g. 'Slovakia') — much
    more reliable with Nominatim than 3-letter ISO codes like 'SVK'.
    Uses a cache so each unique city is only looked up once.
    Returns ("", "") if nothing is found.
    """
    cache_key = f"{city}|{province}|{country_code}"
    if cache_key in _geocache:
        return _geocache[cache_key]

    # Prefer the full country name; fall back to the code if name is unavailable.
    country = country_name or country_code

    # Build a list of structured param dicts, from most to least specific.
    # Using separate fields is much more accurate than a freeform "q=" string.
    attempts = []
    if city and province and country:
        attempts.append({"city": city, "state": province, "country": country})
    if city and country:
        attempts.append({"city": city, "country": country})
    if city and province:
        attempts.append({"city": city, "state": province})
    if city:
        attempts.append({"city": city})

    lat, lon = "", ""
    for structured in attempts:
        params = {**structured, "format": "json", "limit": 1, "addressdetails": 0}
        try:
            r = requests.get(NOMINATIM_URL, params=params, headers=HEADERS, timeout=10)
            r.raise_for_status()
            results = r.json()
            if results:
                lat = results[0]["lat"]
                lon = results[0]["lon"]
                break
        except requests.RequestException:
            pass
        # Nominatim requires >=1 second between requests (usage policy)
        time.sleep(1.1)

    if not lat:
        time.sleep(1.1)

    _geocache[cache_key] = (lat, lon)
    return lat, lon


# ── NHL API helpers ────────────────────────────────────────────────────────────

def get_roster(team: str) -> list[dict]:
    """Fetch current roster for a team."""
    url = f"{BASE_URL}/roster/{team}/current"
    try:
        r = requests.get(url, timeout=10)
        r.raise_for_status()
        data = r.json()
    except requests.RequestException as e:
        print(f"  Warning: Could not fetch roster for {team}: {e}")
        return []

    players = []
    for group in ("forwards", "defensemen", "goalies"):
        for p in data.get(group, []):
            p["_team"] = team
            players.append(p)
    return players


def get_player_details(player_id: int) -> dict:
    """Fetch full player profile including birthplace."""
    url = f"{BASE_URL}/player/{player_id}/landing"
    try:
        r = requests.get(url, timeout=10)
        r.raise_for_status()
        return r.json()
    except requests.RequestException as e:
        print(f"  Warning: Could not fetch details for player {player_id}: {e}")
        return {}


HEADSHOT_BASE = "https://assets.nhle.com/mugs/nhl/20252026"

def headshot_url(team: str, player_id: int) -> str:
    """Construct the NHL headshot PNG URL from team abbreviation and player ID."""
    return f"{HEADSHOT_BASE}/{team}/{player_id}.png"


def inches_to_str(inches: int | None) -> str:
    if inches is None:
        return ""
    feet, rem = divmod(inches, 12)
    return f"{feet}'{rem}\""


# ── Main ───────────────────────────────────────────────────────────────────────

def main():
    all_rows = []
    seen_ids: set[int] = set()

    print(f"Fetching rosters for {len(NHL_TEAMS)} NHL teams...\n")

    for team in NHL_TEAMS:
        print(f"  [{team}] fetching roster...", end=" ", flush=True)
        players = get_roster(team)
        print(f"{len(players)} players")

        for stub in players:
            pid = stub.get("id")
            if pid in seen_ids:
                continue
            seen_ids.add(pid)

            details = get_player_details(pid)
            if not details:
                continue

            # Name
            first = details.get("firstName", {}).get("default", stub.get("firstName", {}).get("default", ""))
            last  = details.get("lastName",  {}).get("default", stub.get("lastName",  {}).get("default", ""))
            full_name = f"{first} {last}".strip()

            # Birth info
            birth_city     = details.get("birthCity", {}).get("default", "")
            birth_province = details.get("birthStateProvince", {}).get("default", "")
            birth_country  = details.get("birthCountry", "")
            birth_country_name = alpha3_to_name(birth_country)
            birthdate      = details.get("birthDate", "")

            # Physical / meta
            position    = details.get("position", stub.get("positionCode", ""))
            height      = details.get("heightInInches")
            weight      = details.get("weightInPounds")
            nationality = details.get("nationalityCode", "")
            jersey      = stub.get("sweaterNumber", details.get("sweaterNumber", ""))

            # Geocode birth city (cached — repeated cities cost nothing extra)
            cache_hit = f"{birth_city}|{birth_province}|{birth_country}" in _geocache
            if not cache_hit:
                print(f"    Geocoding: {birth_city}, {birth_province}, {birth_country_name}...", end=" ", flush=True)
            lat, lon = geocode_city(birth_city, birth_province, birth_country, birth_country_name)
            if not cache_hit:
                print(f"({lat}, {lon})" if lat else "not found")

            team_abbrev = stub.get("_team", "")
            team_meta   = TEAM_INFO.get(team_abbrev, {})
            all_rows.append({
                "player_id":            pid,
                "full_name":            full_name,
                "position":             position,
                "team":                 team_abbrev,
                "team_full_name":       team_meta.get("full_name", team_abbrev),
                "jersey_number":        jersey,
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
                "headshot_url":         headshot_url(team_abbrev, pid),
                "arena_name":           team_meta.get("arena", ""),
                "arena_lat":            team_meta.get("arena_lat", ""),
                "arena_lon":            team_meta.get("arena_lon", ""),
            })

            time.sleep(0.05)  # Small pause between NHL API calls

    # Write CSV
    import os
    output_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data")
    os.makedirs(output_dir, exist_ok=True)
    output_file = os.path.join(output_dir, "nhl_active_players.csv")
    fieldnames = [
        "player_id", "full_name", "position", "team", "team_full_name", "jersey_number",
        "birth_city", "birth_state_province", "birth_country_code", "birth_country",
        "birthdate", "nationality", "height", "weight_lbs",
        "birth_lat", "birth_lon", "headshot_url",
        "arena_name", "arena_lat", "arena_lon",
    ]

    with open(output_file, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(all_rows)

    found = sum(1 for r in all_rows if r["birth_lat"])
    print(f"\nDone! {len(all_rows)} players written to '{output_file}'")
    print(f"Geocoded: {found}/{len(all_rows)} birth cities resolved.")


if __name__ == "__main__":
    main()