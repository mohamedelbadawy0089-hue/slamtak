#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
جامع الصيدليات الحقيقية من مصر - من كل المصادر المجانية
OpenStreetMap + مصادر مفتوحة أخرى
"""

import requests
import json
import time
import re
from typing import List, Dict, Optional
from supabase import create_client, Client
from urllib.parse import quote

# ============================================
# إعدادات Supabase
# ============================================
SUPABASE_URL = "https://iksjhjxwphmvthryfeae.supabase.co"
SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imlrc2poanh3cGhtdnRocnlmZWFlIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MDA3NTUzNiwiZXhwIjoyMDg1NjUxNTM2fQ.IQ4KfNGAa8mLk_SYRv5nqXquUtsxCiYdm2WClH4A0Q"
TABLE_NAME = "egypt_pharmacies_static"

# ============================================
# قوائم الاستبعاد (سلاسل الصيدليات)
# ============================================
CHAIN_BLACKLIST = [
    'العزبي', 'العزابي', 'ezaby', 'el-ezaby', 'el ezaby', 'سيف', 'seif', 'saif',
    'رشدي', 'روشدي', 'roushdy', 'roshdy', 'رشدى', '19011', '١٩٠١١', 'علي وعلي',
    'ali & ali', 'ali and ali', 'على وعلى', 'دلمار', 'delmar', 'عطا الله', 'attallah',
    'ataallah', 'عطالله', 'تامر', 'tamer', 'علام', 'allam', 'أبو علي', 'abu ali',
    'الشارقة', 'sharjah', 'وايتس', 'whites', 'دوائي', 'daway', 'شفاء', 'shefaa',
    'shifa', 'صورتص', 'soratac', 'أوسكار', 'oscar', 'طيبة', 'taiba', 'tayba',
    'مصر', 'masr', 'misr', 'egypt pharma', 'صيدليات شاكر', 'shaker', 'صيدلية المدينة',
    'el-madina', 'خليل', 'khalil', 'الدواء', 'eldawa', 'el dawa'
]

# ============================================
# حدود المحافظات (مستطيلات تقريبية للبحث في OSM)
# ============================================
GOVERNORATE_BBOXES = {
    'القاهرة': [29.8, 30.0, 31.4, 31.5],
    'الجيزة': [29.8, 30.0, 31.0, 31.4],
    'الإسكندرية': [29.8, 30.0, 31.0, 31.3],
    'القليوبية': [30.8, 31.0, 31.2, 31.4],
    'الدقهلية': [30.8, 31.0, 31.4, 31.6],
    'الشرقية': [30.4, 30.6, 31.8, 32.0],
    'المنوفية': [30.4, 30.6, 30.8, 31.0],
    'الغربية': [30.6, 30.8, 30.8, 31.0],
    'البحيرة': [30.2, 30.4, 30.4, 30.6],
    'كفر الشيخ': [30.8, 31.0, 30.4, 30.6],
    'دمياط': [31.2, 31.4, 31.8, 32.0],
    'بورسعيد': [32.2, 32.4, 31.2, 31.4],
    'الإسماعيلية': [32.2, 32.4, 30.4, 30.6],
    'السويس': [32.4, 32.6, 29.8, 30.0],
    'الفيوم': [30.6, 30.8, 29.2, 29.4],
    'بني سويف': [31.0, 31.2, 29.0, 29.2],
    'المنيا': [30.6, 30.8, 28.0, 28.2],
    'أسيوط': [31.0, 31.2, 27.0, 27.2],
    'سوهاج': [31.6, 31.8, 26.4, 26.6],
    'قنا': [32.6, 32.8, 25.8, 26.0],
    'الأقصر': [32.6, 32.8, 25.6, 25.8],
    'أسوان': [32.8, 33.0, 23.8, 24.0],
    'البحر الأحمر': [33.6, 33.8, 27.0, 27.2],
    'الوادي الجديد': [28.8, 29.0, 25.4, 25.6],
    'مطروح': [27.2, 27.4, 29.8, 30.0],
    'شمال سيناء': [34.2, 34.4, 30.8, 31.0],
    'جنوب سيناء': [34.6, 34.8, 28.2, 28.4],
}

# ============================================
class RealPharmacyCollector:
    def __init__(self):
        self.supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
        self.session = requests.Session()
        self.session.headers.update({
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        })
        self.collected = []
        self.duplicate_check = set()
        
    def is_chain_pharmacy(self, name: str) -> bool:
        """التحقق إذا كانت صيدلية سلسلة"""
        if not name:
            return False
        name_lower = name.lower()
        for chain in CHAIN_BLACKLIST:
            if chain.lower() in name_lower:
                return True
        return False
    
    def normalize_arabic(self, text: str) -> str:
        """ت normalizing النص العربي"""
        if not text:
            return text
        # إزالة التشكيل
        text = re.sub(r'[\u064B-\u065F\u0670\u0640]', '', text)
        # توحيد الألفات
        text = re.sub('[إأآا]', 'ا', text)
        # توحيد الهاء
        text = re.sub('ة', 'ه', text)
        # توحيد الياء
        text = re.sub('ى', 'ي', text)
        return text.strip()
    
    def fetch_from_osm(self, governorate: str, bbox: List[float]) -> List[Dict]:
        """
        جلب صيدليات من OpenStreetMap لمحافظة معينة
        """
        print(f"🔍 جلب من OSM: {governorate}...")
        
        overpass_url = "https://overpass-api.de/api/interpreter"
        
        # استعلام Overpass للصيدليات
        query = f"""
        [out:json][timeout:60];
        (
          node["amenity"="pharmacy"]({bbox[0]},{bbox[1]},{bbox[2]},{bbox[3]});
          way["amenity"="pharmacy"]({bbox[0]},{bbox[1]},{bbox[2]},{bbox[3]});
        );
        out body;
        >;
        out skel qt;
        """
        
        try:
            response = self.session.post(
                overpass_url,
                data=query,
                timeout=120
            )
            response.raise_for_status()
            data = response.json()
            
            pharmacies = []
            for element in data.get('elements', []):
                if element.get('type') in ['node', 'way']:
                    tags = element.get('tags', {})
                    name = tags.get('name', '') or tags.get('name:ar', '')
                    
                    if not name or self.is_chain_pharmacy(name):
                        continue
                    
                    # بناء العنوان من tags
                    address_parts = []
                    
                    # الشارع
                    street = tags.get('addr:street', '') or tags.get('street', '')
                    if street:
                        address_parts.append(f"شارع {street}")
                    
                    # رقم المنزل
                    housenumber = tags.get('addr:housenumber', '')
                    if housenumber:
                        address_parts.append(f"رقم {housenumber}")
                    
                    # المدينة
                    city = tags.get('addr:city', '') or tags.get('city', '')
                    if city and city not in address_parts:
                        address_parts.append(city)
                    
                    # المنطقة/الحي
                    district = tags.get('addr:district', '') or tags.get('district', '')
                    suburb = tags.get('addr:suburb', '') or tags.get('suburb', '')
                    if district:
                        district = district
                    elif suburb:
                        district = suburb
                    else:
                        district = None
                    
                    # العنوان الكامل إذا موجود
                    full_address = tags.get('addr:full', '') or tags.get('address', '')
                    if full_address and len(full_address) > 10:
                        address = full_address
                    else:
                        address = '، '.join(address_parts) if address_parts else None
                    
                    pharmacy = {
                        'name': name,
                        'address': address,
                        'governorate': governorate,
                        'city': city or governorate,
                        'district': district,
                        'source': 'OSM',
                        'lat': element.get('lat'),
                        'lon': element.get('lon'),
                        'osm_id': element.get('id')
                    }
                    
                    pharmacies.append(pharmacy)
            
            print(f"   ✅ تم العثور على {len(pharmacies)} صيدلية")
            return pharmacies
            
        except Exception as e:
            print(f"   ❌ خطأ في جلب {governorate}: {e}")
            return []
    
    def fetch_from_nominatim(self, city: str, governorate: str) -> List[Dict]:
        """
        جلب صيدليات باستخدام Nominatim (geocoding)
        """
        print(f"🔍 جلب من Nominatim: {city}...")
        
        try:
            url = f"https://nominatim.openstreetmap.org/search"
            params = {
                'q': f'pharmacy in {city}, Egypt',
                'format': 'json',
                'limit': 50,
                'accept-language': 'ar'
            }
            
            response = self.session.get(url, params=params, timeout=30)
            response.raise_for_status()
            data = response.json()
            
            pharmacies = []
            for place in data:
                name = place.get('display_name', '').split(',')[0]
                
                if not name or 'pharmacy' not in place.get('type', '') or self.is_chain_pharmacy(name):
                    continue
                
                address = place.get('display_name', '')
                # استخراج المدينة من العنوان
                city_from_addr = city
                
                pharmacy = {
                    'name': name,
                    'address': address,
                    'governorate': governorate,
                    'city': city_from_addr,
                    'district': None,
                    'source': 'Nominatim',
                    'lat': place.get('lat'),
                    'lon': place.get('lon'),
                    'osm_id': place.get('osm_id')
                }
                
                pharmacies.append(pharmacy)
            
            print(f"   ✅ تم العثور على {len(pharmacies)} صيدلية")
            return pharmacies
            
        except Exception as e:
            print(f"   ❌ خطأ: {e}")
            return []
    
    def clean_and_validate(self, pharmacies: List[Dict]) -> List[Dict]:
        """تنظيف والتحقق من البيانات"""
        cleaned = []
        
        for p in pharmacies:
            # التحقق من التكرار
            key = f"{self.normalize_arabic(p['name'])}_{p['governorate']}"
            if key in self.duplicate_check:
                continue
            self.duplicate_check.add(key)
            
            # تنظيف الاسم
            name = p['name'].strip()
            if len(name) < 3:
                continue
            
            # إضافة كلمة "صيدلية" إذا مش موجودة
            if 'صيدلية' not in name and 'pharmacy' not in name.lower():
                name = f"صيدلية {name}"
            
            p['name'] = name
            cleaned.append(p)
        
        return cleaned
    
    def save_to_supabase(self, pharmacies: List[Dict]):
        """حفظ في Supabase على دفعات"""
        if not pharmacies:
            return
        
        batch_size = 100
        for i in range(0, len(pharmacies), batch_size):
            batch = pharmacies[i:i+batch_size]
            try:
                # تحضير البيانات للإدخال
                records = []
                for p in batch:
                    records.append({
                        'name': p['name'],
                        'address': p['address'] or f"{p['city']} - {p['governorate']}",
                        'governorate': p['governorate'],
                        'city': p['city'],
                        'district': p['district']
                    })
                
                self.supabase.table(TABLE_NAME).insert(records).execute()
                print(f"   ✅ تم حفظ {len(records)} سجل")
                time.sleep(0.5)  # تجنب Rate limiting
                
            except Exception as e:
                print(f"   ❌ خطأ في الحفظ: {e}")
    
    def run(self, governorates: List[str] = None):
        """التشغيل الرئيسي"""
        print("=" * 70)
        print("🚀 جامع الصيدليات الحقيقية من مصر")
        print("=" * 70)
        
        all_pharmacies = []
        
        # تحديد المحافظات للمعالجة
        if not governorates:
            governorates = list(GOVERNORATE_BBOXES.keys())
        
        for gov in governorates:
            bbox = GOVERNORATE_BBOXES.get(gov)
            if not bbox:
                continue
            
            # جلب من OSM
            osm_pharmacies = self.fetch_from_osm(gov, bbox)
            all_pharmacies.extend(osm_pharmacies)
            
            time.sleep(2)  # احترام خادم OSM
            
            # جلب من Nominatim للمدن الرئيسية
            main_cities = {
                'القاهرة': ['القاهرة', 'مدينة نصر', 'المعادي', 'حلوان'],
                'الجيزة': ['الجيزة', '6 أكتوبر', 'الشيخ زايد'],
                'الإسكندرية': ['الإسكندرية'],
                'القليوبية': ['بنها', 'قليوب', 'شبرا الخيمة'],
                'الدقهلية': ['المنصورة', 'طلخا'],
                'الشرقية': ['الزقازيق', 'العاشر من رمضان'],
                'المنوفية': ['شبين الكوم', 'منوف'],
                'الغربية': ['طنطا', 'المحلة الكبرى'],
                'البحيرة': ['دمنهور', 'كفر الدوار'],
            }
            
            if gov in main_cities:
                for city in main_cities[gov][:2]:  # أول مدينتين فقط
                    nom_pharmacies = self.fetch_from_nominatim(city, gov)
                    all_pharmacies.extend(nom_pharmacies)
                    time.sleep(1)
        
        print(f"\n📊 إجمالي المجموع: {len(all_pharmacies)} صيدلية")
        
        # تنظيف والتحقق
        print("\n🧹 تنظيف البيانات...")
        cleaned = self.clean_and_validate(all_pharmacies)
        print(f"✅ بعد التنظيف: {len(cleaned)} صيدلية")
        
        # حفظ في Supabase
        print("\n💾 حفظ في قاعدة البيانات...")
        self.save_to_supabase(cleaned)
        
        print("\n" + "=" * 70)
        print("✅ اكتمل!")
        print(f"📊 تم جمع {len(cleaned)} صيدلية حقيقية")
        print("=" * 70)


# ============================================
# التشغيل
# ============================================
if __name__ == "__main__":
    try:
        collector = RealPharmacyCollector()
        
        # جلب من كل المحافظات أو محافظات محددة
        # collector.run()  # كل المحافظات
        
        # أو جلب من محافظات محددة للاختبار
        collector.run(['القاهرة', 'الجيزة', 'الإسكندرية', 'القليوبية'])
        
    except KeyboardInterrupt:
        print("\n\n⚠️ تم الإيقاف")
    except Exception as e:
        print(f"\n❌ خطأ: {e}")
        import traceback
        traceback.print_exc()
