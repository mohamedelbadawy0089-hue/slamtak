#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
سكريبت سحب الصيدليات الفردية من OSM
يسحب فقط الصيدليات المستقلة (بدون سلاسل) ويخزنها في 5 أعمدة فقط
"""

import requests
import json
import time
import re
import csv
from typing import List, Dict, Optional

# ============================================
# 1. Configuration
# ============================================

SUPABASE_URL = "https://iksjhjxwphmvthryfeae.supabase.co"
SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imlrc2poanh3cGhtdnRocnlmZWFlIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MDA3NTUzNiwiZXhwIjoyMDg1NjUxNTM2fQ.IQ4KfNGAa8mLk_SYRv5nqXaquUtsxCiYdm2WClH4A0Q"
TABLE_NAME = "egypt_pharmacies_static"

# سلاسل الصيدليات المستبعدة
CHAIN_BLACKLIST = [
    'العزبي', 'العزابي', 'ezaby', 'el-ezaby',
    'سيف', 'seif', 'saif',
    'رشدي', 'روشدي', 'roushdy', 'roshdy',
    '19011', '١٩٠١١',
    'علي وعلي', 'ali & ali', 'ali and ali',
    'دلمار', 'delmar',
    'عطا الله', 'attallah', 'ataallah',
    'تامر', 'tamer',
    'علام', 'allam',
    'أبو علي', 'abu ali',
    'الشارقة', 'sharjah',
    'وايتس', 'whites',
    'دوائي', 'daway',
    'شفاء', 'shefaa', 'shifa',
    'مصر', 'masr', 'misr', 'egypt pharma',
    'صيدليات شاكر', 'shaker',
    'صيدلية المدينة', 'el-madina',
    'خليل', 'khalil',
    'الدواء', 'eldawa',
    'العيبان', 'el-eban',
    'النجار', 'elnagar',
    'الشامي', 'elshamy',
    'الحكيم', 'elhakim',
    'الطاووس', 'eltaous',
]

# خريطة تحويل أسماء المحافظات للعربية
GOVERNORATE_MAP = {
    'Cairo': 'القاهرة',
    'Al Qahirah': 'القاهرة',
    'Giza': 'الجيزة',
    'Al Jizah': 'الجيزة',
    'Alexandria': 'الإسكندرية',
    'Al Iskandariyah': 'الإسكندرية',
    'Qalyubia': 'القليوبية',
    'Al Qalyubiyah': 'القليوبية',
    'Dakahlia': 'الدقهلية',
    'Ad Daqahliyah': 'الدقهلية',
    'Sharqia': 'الشرقية',
    "Ash Sharqiyah": 'الشرقية',
    'Monufia': 'المنوفية',
    'Al Minufiyah': 'المنوفية',
    'Gharbia': 'الغربية',
    'Al Gharbiyah': 'الغربية',
    'Beheira': 'البحيرة',
    'Al Buhayrah': 'البحيرة',
    'Kafr El Sheikh': 'كفر الشيخ',
    'Kafr ash Shaykh': 'كفر الشيخ',
    'Damietta': 'دمياط',
    'Dumyat': 'دمياط',
    'Port Said': 'بورسعيد',
    'Bur Sa`id': 'بورسعيد',
    'Ismailia': 'الإسماعيلية',
    'Al Ismailiyah': 'الإسماعيلية',
    'Suez': 'السويس',
    'As Suways': 'السويس',
    'Faiyum': 'الفيوم',
    'Al Fayyum': 'الفيوم',
    'Beni Suef': 'بني سويف',
    'Bani Suwayf': 'بني سويف',
    'Minya': 'المنيا',
    'Al Minya': 'المنيا',
    'Asyut': 'أسيوط',
    'Asyut': 'أسيوط',
    'Sohag': 'سوهاج',
    'Sawhaj': 'سوهاج',
    'Qena': 'قنا',
    'Qina': 'قنا',
    'Luxor': 'الأقصر',
    'Al Uqsur': 'الأقصر',
    'Aswan': 'أسوان',
    'Aswan': 'أسوان',
    'Red Sea': 'البحر الأحمر',
    'Al Bahr al Ahmar': 'البحر الأحمر',
    'New Valley': 'الوادي الجديد',
    'Al Wadi al Jadid': 'الوادي الجديد',
    'Matrouh': 'مطروح',
    'Matruh': 'مطروح',
    'North Sinai': 'شمال سيناء',
    'Shamal Sina': 'شمال سيناء',
    'South Sinai': 'جنوب سيناء',
    'Janub Sina': 'جنوب سيناء',
}

# ============================================
# 2. Helper Functions
# ============================================

def is_chain_pharmacy(name: str) -> bool:
    """التحقق إذا كانت الصيدلية تابعة لسلسلة"""
    if not name:
        return True
    name_lower = name.lower()
    for chain in CHAIN_BLACKLIST:
        if chain.lower() in name_lower:
            return True
    return False

def clean_text(text: str) -> str:
    """تنظيف النص من رموز غريبة وإحداثيات"""
    if not text:
        return ""
    # إزالة الإحداثيات
    text = re.sub(r'-?\d+\.\d+\s*,\s*-?\d+\.\d+', '', text)
    text = re.sub(r'GPS\s*[:;]?\s*', '', text, flags=re.IGNORECASE)
    # إزالة الروابط
    text = re.sub(r'https?://\S+', '', text)
    # إزالة الأحرف الخاصة والرموز
    text = re.sub(r'[^\w\s\-،\.\(\)\u0600-\u06FF]', ' ', text)
    # ت normalize المسافات
    text = re.sub(r'\s+', ' ', text).strip()
    return text

def arabize_governorate(gov: str) -> str:
    """تحويل اسم المحافظة للعربية"""
    if not gov:
        return "غير محدد"
    gov = gov.strip()
    # البحث في الخريطة
    for en, ar in GOVERNORATE_MAP.items():
        if en.lower() in gov.lower() or gov.lower() in en.lower():
            return ar
    # إذا كان بالعربية أصلاً
    if any('\u0600' <= c <= '\u06FF' for c in gov):
        return gov
    return "غير محدد"

def arabize_city(city: str, governorate: str) -> str:
    """تحسين اسم المدينة"""
    if not city:
        return "المركز الرئيسي"
    city = clean_text(city)
    # إذا كان بالعربية
    if any('\u0600' <= c <= '\u06FF' for c in city):
        return city
    # ترجمة بسيطة لأشهر المدن
    city_map = {
        'cairo': 'القاهرة',
        'alexandria': 'الإسكندرية',
        'giza': 'الجيزة',
        'shubra': 'شبرا',
        'helmeya': 'الحلمية',
        'nasr city': 'مدينة نصر',
        'maadi': 'المعادي',
        'heliopolis': 'مصر الجديدة',
        'mokattam': 'المقطم',
        'ain shams': 'عين شمس',
        'zewail': 'الزواية',
        'dokki': 'الدقي',
        'mohandessin': 'المهندسين',
        'haram': 'الهرم',
        'faysal': 'فيصل',
        'october': 'أكتوبر',
        'zayed': 'الشيخ زايد',
        'mansoura': 'المنصورة',
        'tanta': 'طنطا',
        'damanhour': 'دمنهور',
        'kafr el-sheikh': 'كفر الشيخ',
        'zagazig': 'الزقازيق',
        'ismailia': 'الإسماعيلية',
        'port said': 'بورسعيد',
        'suez': 'السويس',
        'minya': 'المنيا',
        'asyut': 'أسيوط',
        'sohag': 'سوهاج',
        'qena': 'قنا',
        'luxor': 'الأقصر',
        'aswan': 'أسوان',
        'hurghada': 'الغردقة',
    }
    city_lower = city.lower()
    for en, ar in city_map.items():
        if en in city_lower:
            return ar
    return city if city else "المركز الرئيسي"

def extract_district(tags: Dict) -> str:
    """استخراج الحي"""
    district = tags.get('addr:district', tags.get('addr:suburb', tags.get('addr:neighbourhood', '')))
    district = clean_text(district)
    if district and any('\u0600' <= c <= '\u06FF' for c in district):
        return district
    if district:
        return f"حي {district}"
    return "حي عام"

def build_address(tags: Dict, city: str, governorate: str) -> str:
    """بناء العنوان الكامل"""
    parts = []
    street = clean_text(tags.get('addr:street', ''))
    if street:
        parts.append(street)
    if city and city != "المركز الرئيسي":
        parts.append(city)
    if governorate and governorate != "غير محدد":
        parts.append(governorate)
    if parts:
        return "، ".join(parts)
    return f"عنوان في {governorate}"

# ============================================
# 3. Fetch from OSM
# ============================================

def fetch_individual_pharmacies() -> List[Dict]:
    """سحب الصيدليات الفردية من OSM"""
    print("🚀 جاري سحب الصيدليات الفردية من OpenStreetMap (مصر)...")
    overpass_url = "https://overpass-api.de/api/interpreter"

    # استعلام محسن للصيدليات في مصر
    query = """
    [out:json][timeout:300];
    area["name:en"="Egypt"]->.searchArea;
    (
      node["amenity"="pharmacy"](area.searchArea);
      way["amenity"="pharmacy"](area.searchArea);
      rel["amenity"="pharmacy"](area.searchArea);
    );
    out center;
    """

    headers = {
        'User-Agent': 'SlamtakPharmacyBot/1.0 (Individual Pharmacies Filter)',
        'Content-Type': 'application/x-www-form-urlencoded'
    }

    try:
        response = requests.post(overpass_url, data={'data': query}, headers=headers, timeout=300)
        response.raise_for_status()
        data = response.json()
        elements = data.get('elements', [])
        print(f"📊 تم العثور على {len(elements)} صيدلية إجمالاً في OSM")
        return elements
    except Exception as e:
        print(f"❌ فشل السحب من OSM: {e}")
        return []

# ============================================
# 4. Process & Filter
# ============================================

def process_pharmacies(elements: List[Dict]) -> List[Dict]:
    """معالجة وتصفية الصيدليات"""
    processed = []
    seen_names = set()  # لتجنب التكرار

    for el in elements:
        tags = el.get('tags', {})

        # استخراج الاسم بالعربية أولاً
        name = tags.get('name:ar', tags.get('name', '')).strip()

        # تخطي إذا لم يكن اسم عربي أو صيدلية
        if not name or 'صيدلية' not in name:
            continue

        # تخطي السلاسل
        if is_chain_pharmacy(name):
            continue

        # تنظيف الاسم
        name = clean_text(name)
        if not name or len(name) < 3:
            continue

        # تجنب التكرار
        name_key = name[:20].lower()
        if name_key in seen_names:
            continue
        seen_names.add(name_key)

        # استخراج البيانات الجغرافية
        raw_gov = tags.get('addr:state', tags.get('addr:province', ''))
        raw_city = tags.get('addr:city', tags.get('addr:town', ''))

        governorate = arabize_governorate(raw_gov)
        city = arabize_city(raw_city, governorate)
        district = extract_district(tags)
        address = build_address(tags, city, governorate)

        # التحقق من جودة البيانات
        if governorate == "غير محدد" and not raw_city:
            continue

        processed.append({
            "name": name,
            "address": address,
            "governorate": governorate,
            "city": city,
            "district": district,
        })

    print(f"✅ تمت تصفية {len(processed)} صيدلية فردية (بعد استبعاد السلاسل والتكرار)")
    return processed

# ============================================
# 5. Save to CSV
# ============================================

def save_to_csv(pharmacies: List[Dict], filename: str = "individual_pharmacies.csv"):
    """حفظ البيانات في CSV"""
    if not pharmacies:
        print("⚠️ لا توجد بيانات للحفظ")
        return

    with open(filename, 'w', newline='', encoding='utf-8-sig') as f:
        writer = csv.DictWriter(f, fieldnames=['name', 'address', 'governorate', 'city', 'district'])
        writer.writeheader()
        writer.writerows(pharmacies)

    print(f"💾 تم حفظ {len(pharmacies)} صيدلية في: {filename}")

# ============================================
# 6. Upload to Supabase
# ============================================

def upload_to_supabase(pharmacies: List[Dict], batch_size: int = 500):
    """رفع البيانات لـ Supabase"""
    if not pharmacies:
        print("⚠️ لا توجد بيانات للرفع")
        return

    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
        "Content-Profile": "public",
        "Accept-Profile": "public",
    }
    url = f"{SUPABASE_URL}/rest/v1/{TABLE_NAME}"

    total = len(pharmacies)
    uploaded = 0

    print(f"☁️ جاري رفع {total} صيدلية إلى Supabase...")

    for i in range(0, total, batch_size):
        batch = pharmacies[i:i + batch_size]
        try:
            response = requests.post(url, headers=headers, data=json.dumps(batch), timeout=60)
            if response.status_code in [200, 201, 204]:
                uploaded += len(batch)
                print(f"✅ دفعة {i//batch_size + 1}: {uploaded}/{total}")
            else:
                print(f"⚠️ خطأ في الدفعة {i//batch_size + 1}: {response.status_code}")
                print(f"   {response.text[:200]}")
        except Exception as e:
            print(f"❌ استثناء في الدفعة {i//batch_size + 1}: {e}")

        time.sleep(0.3)  # تجنب Rate Limit

    print(f"🎉 تم رفع {uploaded} صيدلية بنجاح!")

# ============================================
# 7. Main
# ============================================

def main():
    start_time = time.time()

    # 1. سحب البيانات
    elements = fetch_individual_pharmacies()
    if not elements:
        print("❌ لم يتم العثور على بيانات")
        return

    # 2. معالجة وتصفية
    pharmacies = process_pharmacies(elements)
    if not pharmacies:
        print("❌ لا توجد صيدليات فردية بعد التصفية")
        return

    # 3. حفظ محلي
    save_to_csv(pharmacies)

    # 4. رفع للسحابة
    upload_to_supabase(pharmacies)

    # 5. إحصائيات
    duration = round(time.time() - start_time, 2)
    print(f"\n📊 إحصائيات:")
    print(f"   • إجمالي الصيدليات: {len(pharmacies)}")
    print(f"   • الوقت المستغرق: {duration} ثانية")
    print(f"   • متوسط السرعة: {round(len(pharmacies)/duration, 1)} صيدلية/ثانية")

    # توزيع جغرافي
    gov_counts = {}
    for p in pharmacies:
        gov = p['governorate']
        gov_counts[gov] = gov_counts.get(gov, 0) + 1

    print(f"\n🌍 التوزيع الجغرافي (أعلى 5):")
    for gov, count in sorted(gov_counts.items(), key=lambda x: -x[1])[:5]:
        print(f"   • {gov}: {count} صيدلية")

if __name__ == "__main__":
    main()
