import csv
import random
import os

# ============================================
# 1. Configuration & Data Structures
# ============================================

GOVERNORATES = [
    "القاهرة", "الجيزة", "الإسكندرية", "القليوبية", "الدقهلية", 
    "الشرقية", "المنوفية", "الغربية", "البحيرة", "كفر الشيخ",
    "دمياط", "بورسعيد", "الإسماعيلية", "السويس", "الفيوم",
    "بني سويف", "المنيا", "أسيوط", "سوهاج", "قنا",
    "الأقصر", "أسوان", "البحر الأحمر", "الوادي الجديد", "مطروح",
    "شمال سيناء", "جنوب سيناء"
]

CITIES = {
    "القاهرة": ["المعادي", "مدينة نصر", "مصر الجديدة", "حلوان", "شبرا", "التجمع الخامس", "الرحاب"],
    "الجيزة": ["المهندسين", "الدقي", "الهرم", "فيصل", "6 أكتوبر", "الشيخ زايد"],
    "الإسكندرية": ["سموحة", "محرم بك", "المنتزة", "سيدي جابر", "العجمي", "السيوف"],
    "الدقهلية": ["المنصورة", "طلخا", "ميت غمر", "السنبلاوين"],
    "الشرقية": ["الزقازيق", "العاشر من رمضان", "بلبيس"],
    # Simplified for the script, but structured correctly
}

PHARMACY_BRANDS = ["العزبي", "سيف", "رشدي", "مصر", "علي وعلي", "خليل", "19011", "صيدليات شاكر", "صيدلية المدينة"]
NAMES = ["أحمد", "محمد", "علي", "محمود", "إبراهيم", "حسين", "سيد", "حسن"]

DISTRICT_PREFIX = "DIST-"

# ============================================
# 2. Generation Logic
# ============================================

def generate_pharmacies(count=80000):
    data = []
    print(f"Generating {count} pharmacy records...")
    
    for i in range(count):
        gov = random.choice(GOVERNORATES)
        city = random.choice(CITIES.get(gov, ["المركز الرئيسي"]))
        district = f"الحي {random.randint(1, 10)}"
        
        brand = random.choice(PHARMACY_BRANDS)
        if random.random() > 0.3:
            name = f"صيدلية {brand} - {city}"
        else:
            name = f"صيدلية د. {random.choice(NAMES)} {random.choice(NAMES)}"
            
        phone = f"01{random.choice(['0', '1', '2', '5'])}{random.randint(1000000, 9999999)}"
        address = f"شارع {random.randint(1, 100)}، خلف {random.choice(['المسجد', 'المدرسة', 'البنك'])}، {district}"
        
        # Unique district ID for filtering
        district_id = f"{DISTRICT_PREFIX}{GOVERNORATES.index(gov):02d}-{random.randint(100, 999)}"
        
        # Mock location URL
        lat = 30 + random.uniform(-1, 1)
        lng = 31 + random.uniform(-1, 1)
        location_url = f"https://www.google.com/maps?q={lat},{lng}"
        
        data.append({
            "name": name,
            "governorate": gov,
            "city": city,
            "district": district,
            "address": address,
            "phone": phone,
            "location_url": location_url,
            "district_id": district_id
        })
        
        if i % 10000 == 0 and i > 0:
            print(f"Generated {i} records...")
            
    return data

# ============================================
# 3. Save to CSV
# ============================================

def save_to_csv(data, filename="egypt_pharmacies_static.csv"):
    keys = data[0].keys()
    with open(filename, 'w', newline='', encoding='utf-8-sig') as output_file:
        dict_writer = csv.DictWriter(output_file, fieldnames=keys)
        dict_writer.writeheader()
        dict_writer.writerows(data)
    print(f"Successfully saved {len(data)} records to {filename}")

if __name__ == "__main__":
    pharmacies = generate_pharmacies(80000)
    save_to_csv(pharmacies)
