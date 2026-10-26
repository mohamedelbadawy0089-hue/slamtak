#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
جمع بيانات الصيدليات من المصادر الحكومية المفتوحة
وزارة الصحة - الهيئة العامة للخدمات البريدية - مصادر حكومية أخرى
"""

import requests
import json
import re
import time
from typing import List, Dict, Optional
from supabase import create_client, Client

# ============================================
# إعدادات Supabase
# ============================================
SUPABASE_URL = "https://iksjhjxwphmvthryfeae.supabase.co"
SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imlrc2poanh3cGhtdnRocnlmZWFlIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MDA3NTUzNiwiZXhwIjoyMDg1NjUxNTM2fQ.IQ4KfNGAa8mLk_SYRv5nqXquUtsxCiYdm2WClH4A0Q"
TABLE_NAME = "egypt_pharmacies_static"

# ============================================
class GovPharmacyCollector:
    def __init__(self):
        self.supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
        self.session = requests.Session()
        self.session.headers.update({
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        })
        self.collected = []
        
    # ============================================
    # 1. البيانات المفتوحة من موقع مصر المفتوحة (Open Data Egypt)
    # ============================================
    def fetch_from_egypt_opendata(self) -> List[Dict]:
        """
        محاولة جلب من البوابة المفتوحة للحكومة المصرية
        https://www.opendata.eg/
        """
        print("🔍 البحث في بوابة مصر المفتوحة...")
        
        # unfortunately, most gov APIs require authentication
        # trying available public datasets
        
        pharmacies = []
        
        # Example API endpoint (hypothetical - need real API key)
        # Most Egyptian government APIs require registration
        
        print("   ⚠️ البوابة تتطلب تسجيل والحصول على API Key")
        print("   💡 يمكن التقدم بطلب من: https://www.opendata.eg/")
        
        return pharmacies
    
    # ============================================
    # 2. الهيئة العامة للخدمات البريدية
    # ============================================
    def fetch_from_postal_service(self) -> List[Dict]:
        """
        البريد المصري - عناوين مفصلة
        الموقع: https://www.egyptpost.org/
        """
        print("🔍 محاولة جلب من البريد المصري...")
        
        # Postal service doesn't have public pharmacy API
        # but we can use their address structure as reference
        
        print("   ⚠️ البريد لا يوفر API عام للصيدليات")
        print("   💡 يمكن استخدام هيكل العناوين كمرجع")
        
        return []
    
    # ============================================
    # 3. Google Places API (بديل قوي للبيانات الحقيقية)
    # ============================================
    def fetch_from_google_places(self, api_key: str, location: str, radius: int = 5000) -> List[Dict]:
        """
        Google Places API - أفضل مصدر للبيانات الحقيقية
        يتطلب API Key (مجاني 300$ شهرياً)
        https://developers.google.com/maps/documentation/places/web-service/overview
        """
        print(f"🔍 جلب من Google Places: {location}...")
        
        if not api_key:
            print("   ❌ لا يوجد Google API Key")
            return []
        
        pharmacies = []
        
        try:
            # خطوة 1: البحث عن الصيدليات
            url = "https://maps.googleapis.com/maps/api/place/textsearch/json"
            params = {
                'query': f'pharmacies in {location}, Egypt',
                'key': api_key,
                'language': 'ar'
            }
            
            response = self.session.get(url, params=params, timeout=30)
            data = response.json()
            
            if data.get('status') != 'OK':
                print(f"   ❌ خطأ: {data.get('status')}")
                return []
            
            for place in data.get('results', []):
                name = place.get('name', '')
                
                # تخطي السلاسل
                if self.is_chain(name):
                    continue
                
                # خطوة 2: جلب تفاصيل المكان
                details = self.get_place_details(api_key, place.get('place_id'))
                
                pharmacy = {
                    'name': f"صيدلية {name}" if 'صيدلية' not in name else name,
                    'address': details.get('formatted_address') or place.get('formatted_address'),
                    'governorate': self.extract_governorate(details.get('formatted_address', '')),
                    'city': self.extract_city(details.get('formatted_address', '')),
                    'district': details.get('neighborhood') or details.get('sublocality'),
                    'phone': details.get('formatted_phone_number'),
                    'source': 'Google Places API',
                    'place_id': place.get('place_id')
                }
                
                pharmacies.append(pharmacy)
            
            print(f"   ✅ {len(pharmacies)} صيدلية")
            return pharmacies
            
        except Exception as e:
            print(f"   ❌ خطأ: {e}")
            return []
    
    def get_place_details(self, api_key: str, place_id: str) -> Dict:
        """جلب تفاصيل المكان"""
        try:
            url = "https://maps.googleapis.com/maps/api/place/details/json"
            params = {
                'place_id': place_id,
                'key': api_key,
                'language': 'ar',
                'fields': 'formatted_address,formatted_phone_number,address_component'
            }
            
            response = self.session.get(url, params=params, timeout=30)
            data = response.json()
            
            if data.get('status') == 'OK':
                result = data.get('result', {})
                
                # استخراج المكونات
                components = result.get('address_components', [])
                neighborhood = None
                sublocality = None
                
                for comp in components:
                    types = comp.get('types', [])
                    if 'neighborhood' in types:
                        neighborhood = comp.get('long_name')
                    if 'sublocality' in types or 'sublocality_level_1' in types:
                        sublocality = comp.get('long_name')
                
                return {
                    'formatted_address': result.get('formatted_address'),
                    'formatted_phone_number': result.get('formatted_phone_number'),
                    'neighborhood': neighborhood,
                    'sublocality': sublocality
                }
            
            return {}
            
        except:
            return {}
    
    # ============================================
    # 4. Foursquare API (بديل مجاني)
    # ============================================
    def fetch_from_foursquare(self, api_key: str, city: str) -> List[Dict]:
        """
        Foursquare Places API - مجاني حتى 100,000 طلب/شهر
        https://developer.foursquare.com/
        """
        print(f"🔍 جلب من Foursquare: {city}...")
        
        if not api_key:
            print("   ❌ لا يوجد Foursquare API Key")
            return []
        
        try:
            url = "https://api.foursquare.com/v3/places/search"
            headers = {
                'Authorization': api_key,
                'Accept': 'application/json'
            }
            params = {
                'query': 'pharmacy',
                'near': f'{city}, Egypt',
                'limit': 50
            }
            
            response = self.session.get(url, headers=headers, params=params, timeout=30)
            data = response.json()
            
            pharmacies = []
            for place in data.get('results', []):
                name = place.get('name', '')
                
                if self.is_chain(name):
                    continue
                
                location = place.get('location', {})
                
                pharmacy = {
                    'name': f"صيدلية {name}" if 'صيدلية' not in name else name,
                    'address': location.get('formatted_address') or f"{location.get('address', '')}, {location.get('locality', '')}",
                    'governorate': None,  # يحتاج استخراج
                    'city': location.get('locality', ''),
                    'district': location.get('neighborhood', ''),
                    'source': 'Foursquare API',
                    'fsq_id': place.get('fsq_id')
                }
                
                pharmacies.append(pharmacy)
            
            print(f"   ✅ {len(pharmacies)} صيدلية")
            return pharmacies
            
        except Exception as e:
            print(f"   ❌ خطأ: {e}")
            return []
    
    # ============================================
    # 5. HERE API (بديل آخر - 250,000 طلب/شهر مجاناً)
    # ============================================
    def fetch_from_here(self, api_key: str, city: str) -> List[Dict]:
        """
        HERE Places API - 250,000 طلب/شهر مجاناً
        https://developer.here.com/
        """
        print(f"🔍 جلب من HERE API: {city}...")
        
        if not api_key:
            print("   ❌ لا يوجد HERE API Key")
            return []
        
        try:
            url = "https://discover.search.hereapi.com/v1/discover"
            params = {
                'q': 'pharmacy',
                'in': f'circle:{self.get_city_coords(city)};r=50000',
                'apiKey': api_key,
                'lang': 'ar'
            }
            
            response = self.session.get(url, params=params, timeout=30)
            data = response.json()
            
            pharmacies = []
            for item in data.get('items', []):
                name = item.get('title', '')
                
                if self.is_chain(name):
                    continue
                
                address = item.get('address', {})
                
                pharmacy = {
                    'name': f"صيدلية {name}" if 'صيدلية' not in name else name,
                    'address': address.get('label', ''),
                    'governorate': address.get('county', ''),
                    'city': address.get('city', ''),
                    'district': address.get('district', ''),
                    'source': 'HERE API'
                }
                
                pharmacies.append(pharmacy)
            
            print(f"   ✅ {len(pharmacies)} صيدلية")
            return pharmacies
            
        except Exception as e:
            print(f"   ❌ خطأ: {e}")
            return []
    
    # ============================================
    # أدوات مساعدة
    # ============================================
    def is_chain(self, name: str) -> bool:
        """التحقق من السلاسل"""
        chains = ['العزبي', 'سيف', 'رشدي', '19011', 'علي وعلي', 'دلمار', 'عطا الله', 
                 'تامر', 'علام', 'أبو علي', 'الشارقة', 'وايتس', 'دوائي', 'شفاء',
                 'صورتص', 'أوسكار', 'طيبة', 'شاكر', 'المدينة', 'خليل', 'الدواء']
        name_lower = name.lower()
        for chain in chains:
            if chain in name_lower:
                return True
        return False
    
    def extract_governorate(self, address: str) -> Optional[str]:
        """استخراج المحافظة من العنوان"""
        governorates = ['القاهرة', 'الجيزة', 'الإسكندرية', 'القليوبية', 'الدقهلية',
                       'الشرقية', 'المنوفية', 'الغربية', 'البحيرة', 'كفر الشيخ',
                       'دمياط', 'بورسعيد', 'الإسماعيلية', 'السويس', 'الفيوم',
                       'بني سويف', 'المنيا', 'أسيوط', 'سوهاج', 'قنا', 'الأقصر', 'أسوان']
        
        for gov in governorates:
            if gov in address:
                return gov
        return None
    
    def extract_city(self, address: str) -> Optional[str]:
        """استخراج المدينة من العنوان"""
        # محاولة بسيطة - يمكن تحسينها
        parts = address.split('،')
        if len(parts) >= 2:
            return parts[-2].strip()
        return None
    
    def get_city_coords(self, city: str) -> str:
        """إحداثيات المدن الرئيسية"""
        coords = {
            'القاهرة': '30.0444,31.2357',
            'الإسكندرية': '31.2001,29.9187',
            'الجيزة': '30.0131,31.2089',
            'بنها': '30.4694,31.1840',
            'المنصورة': '31.0409,31.3785',
            'الزقازيق': '30.5877,31.5020',
        }
        return coords.get(city, '30.0444,31.2357')  # القاهرة كافتراضي
    
    # ============================================
    # حفظ البيانات
    # ============================================
    def save_to_supabase(self, pharmacies: List[Dict]):
        """حفظ في Supabase"""
        if not pharmacies:
            return
        
        records = []
        for p in pharmacies:
            records.append({
                'name': p['name'],
                'address': p['address'],
                'governorate': p.get('governorate'),
                'city': p.get('city'),
                'district': p.get('district'),
                'phone': p.get('phone')
            })
        
        batch_size = 100
        for i in range(0, len(records), batch_size):
            batch = records[i:i+batch_size]
            try:
                self.supabase.table(TABLE_NAME).insert(batch).execute()
                print(f"   ✅ تم حفظ {len(batch)}")
                time.sleep(0.5)
            except Exception as e:
                print(f"   ❌ خطأ: {e}")
    
    def run(self):
        """التشغيل الرئيسي"""
        print("=" * 80)
        print("🏛️ جمع بيانات الصيدليات من المصادر الحكومية والخدمات المفتوحة")
        print("=" * 80)
        
        all_pharmacies = []
        
        # 1. البيانات المفتوحة الحكومية
        opendata = self.fetch_from_egypt_opendata()
        all_pharmacies.extend(opendata)
        
        # 2. البريد المصري
        postal = self.fetch_from_postal_service()
        all_pharmacies.extend(postal)
        
        # 3. Google Places (يتطلب API Key)
        # google_key = "YOUR_GOOGLE_API_KEY"
        # for city in ['القاهرة', 'الإسكندرية', 'الجيزة', 'بنها']:
        #     google_pharmacies = self.fetch_from_google_places(google_key, city)
        #     all_pharmacies.extend(google_pharmacies)
        #     time.sleep(2)
        
        # 4. Foursquare (يتطلب API Key)
        # foursquare_key = "YOUR_FOURSQUARE_KEY"
        # for city in ['Cairo', 'Alexandria', 'Giza']:
        #     foursquare_pharmacies = self.fetch_from_foursquare(foursquare_key, city)
        #     all_pharmacies.extend(foursquare_pharmacies)
        
        print("\n" + "=" * 80)
        print("📊 ملخص:")
        print(f"   إجمالي المجموع: {len(all_pharmacies)} صيدلية")
        
        if all_pharmacies:
            self.save_to_supabase(all_pharmacies)
        
        print("=" * 80)
        print("\n💡 للحصول على المزيد من البيانات الحقيقية:")
        print("   1. احصل على Google Places API Key (300$ مجانية/شهر)")
        print("   2. احصل على Foursquare API Key (مجاني 100K طلب/شهر)")
        print("   3. تواصل مع وزارة الصحة للحصول على قاعدة البيانات الرسمية")
        print("   4. استخدم HERE API (250K طلب مجاني/شهر)")


# ============================================
# التشغيل
# ============================================
if __name__ == "__main__":
    collector = GovPharmacyCollector()
    collector.run()
