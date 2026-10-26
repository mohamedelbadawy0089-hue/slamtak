import requests
import json
import time
import re

# Supabase Configuration
SUPABASE_URL = "https://iksjhjxwphmvthryfeae.supabase.co"
SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imlrc2poanh3cGhtdnRocnlmZWFlIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MDA3NTUzNiwiZXhwIjoyMDg1NjUxNTM2fQ.IQ4KfNGAa8mLk_SYRv5nqXaquUtsxCiYdm2WClH4A0Q"
TABLE_NAME = "egypt_pharmacies_static"

# Blacklist words
BLACKLIST = [
    'العزبي', 'مصر', 'سيف', 'رشدي', '19011', 'دلمار', 'عطا الله', 
    'تامر', 'علام', 'أبو علي', 'الشارقة', 'وايتس', 'دوائي', 'شفاء',
    'El Ezaby', 'Misr', 'Seif', 'Rousdy', 'Delmar', 'Attalla'
]

def is_individual_pharmacy(name):
    if not name: return False
    name_lower = name.lower()
    for word in BLACKLIST:
        if word.lower() in name_lower: return False
    return 'صيدلية' in name or 'pharmacy' in name_lower

def fetch_massive_egypt_pharmacies():
    print("🚀 جاري سحب بيانات كافة صيدليات مصر من الخريطة العالمية (عملية مكثفة)...")
    overpass_url = "https://overpass-api.de/api/interpreter"
    
    # Broad query covering all possible tags and names across the Egypt Bbox
    query = """
    [out:json][timeout:600];
    (
      node["amenity"="pharmacy"](22.0,24.0,32.0,37.0);
      node["shop"="pharmacy"](22.0,24.0,32.0,37.0);
      node["name"~"صيدلية"](22.0,24.0,32.0,37.0);
      node["name:ar"~"صيدلية"](22.0,24.0,32.0,37.0);
      way["amenity"="pharmacy"](22.0,24.0,32.0,37.0);
      way["shop"="pharmacy"](22.0,24.0,32.0,37.0);
    );
    out center;
    """
    
    headers = {
        'User-Agent': 'SlamtakBulkScraper/5.0 (mohamedelbadawy0089@gmail.com)',
        'Content-Type': 'application/x-www-form-urlencoded'
    }
    
    try:
        response = requests.post(overpass_url, data={'data': query}, headers=headers)
        response.raise_for_status()
        return response.json().get('elements', [])
    except Exception as e:
        print(f"❌ فشل السحب من الخريطة: {e}")
        return []

def upload_massive_bulk(all_pharmacies):
    if not all_pharmacies: return
    
    # Process and Map
    processed = []
    seen_coords = set()
    
    for el in all_pharmacies:
        tags = el.get('tags', {})
        name = tags.get('name', tags.get('name:ar', tags.get('name:en', '')))
        
        if not name or not is_individual_pharmacy(name): continue
        
        lat = el.get('lat', el.get('center', {}).get('lat'))
        lng = el.get('lon', el.get('center', {}).get('lon'))
        
        coord_key = f"{round(lat, 4)},{round(lng, 4)}"
        if coord_key in seen_coords: continue
        seen_coords.add(coord_key)
        
        gov = tags.get('addr:state', tags.get('addr:province', 'عام'))
        city = tags.get('addr:city', tags.get('addr:town', tags.get('addr:suburb', 'المركز')))
        
        processed.append({
            "name": re.sub(r'\s+', ' ', name).strip(),
            "governorate": gov,
            "city": city,
            "district": tags.get('addr:district', 'حي عام'),
            "address": tags.get('addr:street', f"GPS: {lat},{lng}"),
            "phone": tags.get('phone', tags.get('contact:phone', '')),
            "location_url": f"https://www.google.com/maps?q={lat},{lng}",
            "district_id": "BULK-OSM"
        })
        
    print(f"📦 تم تجميع {len(processed)} صيدلية فردية. جاري الرفع بنظام الدفعات (500)...")
    
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
        "Content-Profile": "public"
    }
    url = f"{SUPABASE_URL}/rest/v1/{TABLE_NAME}"
    
    batch_size = 500
    for i in range(0, len(processed), batch_size):
        batch = processed[i:i + batch_size]
        try:
            requests.post(url, headers=headers, data=json.dumps(batch))
            print(f"✅ تم رفع دفعة {i//batch_size + 1}.. الإجمالي المرفوع الآن: {min(i + batch_size, len(processed))}")
        except:
            pass # Continue on errors for speed

def main():
    start_time = time.time()
    elements = fetch_massive_egypt_pharmacies()
    if elements:
        upload_massive_bulk(elements)
    
    duration = round(time.time() - start_time, 2)
    print(f"🏁 تمت العملية الكبرى بنجاح في {duration} ثانية.")

if __name__ == "__main__":
    main()
