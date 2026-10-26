# -*- coding: utf-8 -*-
"""Check what tables exist in Supabase"""

import requests

SUPABASE_URL = "https://iksjhjxwphmvthryfeae.supabase.co"
SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imlrc2poanh3cGhtdnRocnlmZWFlIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MDA3NTUzNiwiZXhwIjoyMDg1NjUxNTM2fQ.IQ4KfNGAa8mLk_SYRv5nqXaquUtsxCiYdm2WClH4A0Q"

headers = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
}

# Try to query egypt_pharmacies_static
url = f"{SUPABASE_URL}/rest/v1/egypt_pharmacies_static?select=*&limit=1"
try:
    r = requests.get(url, headers=headers, timeout=30)
    print(f"egypt_pharmacies_static status: {r.status_code}")
    if r.status_code != 200:
        print(f"Error: {r.text[:200]}")
except Exception as e:
    print(f"Exception: {e}")

# Try to query pharmacies table
url2 = f"{SUPABASE_URL}/rest/v1/pharmacies?select=*&limit=1"
try:
    r2 = requests.get(url2, headers=headers, timeout=30)
    print(f"pharmacies status: {r2.status_code}")
    if r2.status_code != 200:
        print(f"Error: {r2.text[:200]}")
except Exception as e:
    print(f"Exception: {e}")

# Try RPC to list tables via pg_catalog
url3 = f"{SUPABASE_URL}/rest/v1/"
try:
    r3 = requests.get(url3, headers=headers, timeout=30)
    print(f"REST root status: {r3.status_code}")
    if r3.status_code == 200:
        print(f"Response: {r3.text[:300]}")
except Exception as e:
    print(f"Exception: {e}")
