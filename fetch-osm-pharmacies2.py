# -*- coding: utf-8 -*-
"""Fetch real pharmacy data from OpenStreetMap for Egypt - Alternative approach"""

import requests
import json
import time
import urllib.parse

overpass_url = "https://overpass-api.de/api/interpreter"
query = """
[out:json][timeout:180];
area["name:en"="Egypt"]->.searchArea;
(
  node["amenity"="pharmacy"](area.searchArea);
  way["amenity"="pharmacy"](area.searchArea);
);
out center body;
"""

encoded_query = urllib.parse.quote(query)
url_get = f"{overpass_url}?data={encoded_query}"

headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
}

print("Fetching pharmacies from OpenStreetMap (GET)...")
try:
    response = requests.get(url_get, headers=headers, timeout=180)
    print(f"Status: {response.status_code}")
    if response.status_code == 200:
        data = response.json()
        elements = data.get('elements', [])
        print(f"Total elements: {len(elements)}")

        pharmacies = []
        seen = set()
        for el in elements:
            tags = el.get('tags', {})
            name = tags.get('name:ar', tags.get('name', '')).strip()
            if not name:
                continue

            # Skip chain pharmacies
            chain_keywords = ['ezaby', 'el-ezaby', 'seif', '19011', 'ali & ali', 'delmar',
                              'attallah', 'whites', 'daway', 'oscar', 'masr', 'shaker',
                              'el-madina', 'eldawa', 'tamer', 'allam', 'soratac']
            name_lower = name.lower()
            if any(kw in name_lower for kw in chain_keywords):
                continue

            # Deduplicate
            key = name[:40].lower()
            if key in seen:
                continue
            seen.add(key)

            lat = el.get('lat', el.get('center', {}).get('lat'))
            lon = el.get('lon', el.get('center', {}).get('lon'))

            raw_gov = tags.get('addr:state', tags.get('addr:province', ''))
            raw_city = tags.get('addr:city', tags.get('addr:town', ''))
            raw_street = tags.get('addr:street', tags.get('addr:place', ''))

            address_parts = []
            if raw_street:
                address_parts.append(raw_street)
            if raw_city:
                address_parts.append(raw_city)
            if raw_gov:
                address_parts.append(raw_gov)
            if not address_parts:
                address_parts.append('Egypt')

            pharmacy = {
                'id': f'osm_{el["id"]}',
                'name': name,
                'address': ', '.join(address_parts),
                'governorate': raw_gov or 'غير محدد',
                'city': raw_city or 'غير محدد',
                'district': tags.get('addr:district', tags.get('addr:suburb', '')),
                'phone': tags.get('phone', tags.get('contact:phone', '')),
                'lat': lat,
                'lon': lon,
                'source': 'OSM'
            }
            pharmacies.append(pharmacy)

        print(f"Unique pharmacies: {len(pharmacies)}")
        with open('osm_pharmacies.json', 'w', encoding='utf-8') as f:
            json.dump(pharmacies, f, ensure_ascii=False, indent=2)
        print("Saved to osm_pharmacies.json")
    else:
        print(f"Error: {response.text[:300]}")
except Exception as e:
    print(f"Exception: {e}")
