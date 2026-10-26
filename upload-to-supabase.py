# -*- coding: utf-8 -*-
"""Upload generated pharmacy data to Supabase"""

import json
import requests
import time

SUPABASE_URL = "https://iksjhjxwphmvthryfeae.supabase.co"
SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imlrc2poanh3cGhtdnRocnlmZWFlIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MDA3NTUzNiwiZXhwIjoyMDg1NjUxNTM2fQ.IQ4KfNGAa8mLk_SYRv5nqXaquUtsxCiYdm2WClH4A0Q"
TABLE_NAME = "egypt_pharmacies_static"

with open('egypt_pharmacies_large.json', 'r', encoding='utf-8') as f:
    pharmacies = json.load(f)

# Map to table schema (id is auto-generated, so we exclude it)
records = []
for p in pharmacies:
    records.append({
        'name': p['name'],
        'address': p['address'],
        'governorate': p['governorate'],
        'city': p['city'],
        'district': p['district'],
        'phone': p.get('phone', ''),
    })

headers = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
    "Prefer": "return=minimal",
}

url = f"{SUPABASE_URL}/rest/v1/{TABLE_NAME}"

# First, check how many exist already
try:
    r = requests.get(f"{url}?select=*&limit=1", headers=headers, timeout=30)
    print(f"Table access status: {r.status_code}")
except Exception as e:
    print(f"Table check error: {e}")

batch_size = 500
total = len(records)
uploaded = 0

print(f"\nUploading {total} pharmacies to Supabase...")

for i in range(0, total, batch_size):
    batch = records[i:i + batch_size]
    try:
        response = requests.post(url, headers=headers, data=json.dumps(batch), timeout=60)
        if response.status_code in [200, 201, 204]:
            uploaded += len(batch)
            print(f"  Batch {i//batch_size + 1}: {uploaded}/{total}")
        else:
            print(f"  Batch {i//batch_size + 1} error: {response.status_code} - {response.text[:100]}")
    except Exception as e:
        print(f"  Batch {i//batch_size + 1} exception: {e}")
    time.sleep(0.3)

print(f"\nDone! Uploaded {uploaded}/{total} pharmacies.")
