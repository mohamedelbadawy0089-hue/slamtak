import csv
import requests
import json
import time

# ============================================
# 1. Configuration
# ============================================

SUPABASE_URL = "https://iksjhjxwphmvthryfeae.supabase.co"
# IMPORTANT: Use a service_role key for batch uploads to bypass RLS
SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imlrc2poanh3cGhtdnRocnlmZWFlIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MDA3NTUzNiwiZXhwIjoyMDg1NjUxNTM2fQ.IQ4KfNGAa8mLk_SYRv5nqXaquUtsxCiYdm2WClH4A0Q" 
TABLE_NAME = "egypt_pharmacies_static"
CSV_FILE = "egypt_pharmacies_static.csv"
BATCH_SIZE = 500 # Number of rows per request
START_FROM = 14500 # Resume from this record number

# ============================================
# 2. Upload Logic
# ============================================

def upload_batches():
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
        "Content-Profile": "public",
        "Accept-Profile": "public",
        "x-client-info": "supabase-js-python/1.0.0" # Sometimes helps with schema routing
    }
    
    url = f"{SUPABASE_URL}/rest/v1/{TABLE_NAME}"
    
    print(f"Resuming batch upload to {TABLE_NAME} starting from record {START_FROM}...")
    
    with open(CSV_FILE, mode='r', encoding='utf-8-sig') as f:
        reader = csv.DictReader(f)
        batch = []
        total_processed = 0
        total_uploaded = START_FROM
        
        for row in reader:
            total_processed += 1
            if total_processed <= START_FROM:
                continue # Skip already uploaded records
                
            batch.append(row)
            
            if len(batch) >= BATCH_SIZE:
                success = send_batch(url, headers, batch)
                if success:
                    total_uploaded += len(batch)
                    print(f"Uploaded {total_uploaded} records...")
                else:
                    print(f"Failed at {total_uploaded}. Stopping.")
                    return
                batch = []
                time.sleep(0.5) # Small delay to avoid rate limiting
        
        # Final batch
        if batch:
            if send_batch(url, headers, batch):
                total_uploaded += len(batch)
                print(f"Final batch uploaded. Total: {total_uploaded}")

def send_batch(url, headers, batch):
    try:
        response = requests.post(url, headers=headers, data=json.dumps(batch))
        if response.status_code in [200, 201, 204]:
            return True
        else:
            print(f"Error: {response.status_code} - {response.text}")
            return False
    except Exception as e:
        print(f"Exception: {e}")
        return False

if __name__ == "__main__":
    upload_batches()
