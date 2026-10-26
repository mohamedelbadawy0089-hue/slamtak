#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
جمع صيدليات حقيقية من HERE API - جميع محافظات مصر
HERE Places API: 250,000 طلب/شهر مجاناً
https://developer.here.com/
"""

import requests
import json
import re
import time
from typing import List, Dict, Optional
from supabase import create_client, Client
from datetime import datetime

# ============================================
# إعدادات Supabase
# ============================================
SUPABASE_URL = "https://iksjhjxwphmvthryfeae.supabase.co"
SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imlrc2poanh3cGhtdnRocnlmZWFlIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MDA3NTUzNiwiZXhwIjoyMDg1NjUxNTM2fQ.IQ4KfNGAa8mLk_SYRv5nqXquUtsxCiYdm2WClH4A0Q"
TABLE_NAME = "egypt_pharmacies_static"

# ============================================
# HERE API Configuration
# ============================================
HERE_API_KEY = "YOUR_HERE_API_KEY"  # يجب تغييره
HERE_DISCOVER_URL = "https://discover.search.hereapi.com/v1/discover"
HERE_BROWSE_URL = "https://browse.search.hereapi.com/v1/browse"

# ============================================
# قائمة الاستبعاد - سلاسل الصيدليات
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
# إحداثيات المدن الرئيسية في كل محافظة
# ============================================
EGYPT_CITIES = {
    # القاهرة والجيزة
    'القاهرة': [
        {'name': 'القاهرة', 'lat': 30.0444, 'lng': 31.2357, 'radius': 25000},
        {'name': 'مدينة نصر', 'lat': 30.0500, 'lng': 31.2833, 'radius': 15000},
        {'name': 'المعادي', 'lat': 29.9581, 'lng': 31.2500, 'radius': 12000},
        {'name': 'مصر الجديدة', 'lat': 30.1222, 'lng': 31.2708, 'radius': 10000},
        {'name': 'حلوان', 'lat': 29.8414, 'lng': 31.3008, 'radius': 15000},
        {'name': 'المرج', 'lat': 30.1556, 'lng': 31.3500, 'radius': 10000},
        {'name': 'عين شمس', 'lat': 30.1297, 'lng': 31.3194, 'radius': 10000},
        {'name': 'الوايلي', 'lat': 30.0667, 'lng': 31.2833, 'radius': 8000},
        {'name': 'الزيتون', 'lat': 30.1222, 'lng': 31.3167, 'radius': 8000},
    ],
    'الجيزة': [
        {'name': 'الجيزة', 'lat': 30.0131, 'lng': 31.2089, 'radius': 20000},
        {'name': '6 أكتوبر', 'lat': 29.9527, 'lng': 30.9093, 'radius': 20000},
        {'name': 'الشيخ زايد', 'lat': 30.0454, 'lng': 30.9476, 'radius': 15000},
        {'name': 'الدقي', 'lat': 30.0381, 'lng': 31.2114, 'radius': 10000},
        {'name': 'المهندسين', 'lat': 30.0667, 'lng': 31.2167, 'radius': 8000},
        {'name': 'العجوزة', 'lat': 30.0556, 'lng': 31.2167, 'radius': 8000},
        {'name': 'الهرم', 'lat': 29.9773, 'lng': 31.2089, 'radius': 15000},
        {'name': 'فيصل', 'lat': 29.9889, 'lng': 31.1444, 'radius': 12000},
        {'name': 'إمبابة', 'lat': 30.0833, 'lng': 31.2000, 'radius': 10000},
        {'name': 'الوراق', 'lat': 30.1222, 'lng': 31.1833, 'radius': 8000},
    ],
    # الإسكندرية
    'الإسكندرية': [
        {'name': 'الإسكندرية', 'lat': 31.2001, 'lng': 29.9187, 'radius': 30000},
        {'name': 'سموحة', 'lat': 31.2114, 'lng': 29.9483, 'radius': 10000},
        {'name': 'محرم بك', 'lat': 31.1833, 'lng': 29.9000, 'radius': 10000},
        {'name': 'سيدي جابر', 'lat': 31.2167, 'lng': 29.9333, 'radius': 10000},
        {'name': 'المنتزة', 'lat': 31.2833, 'lng': 30.0167, 'radius': 15000},
        {'name': 'العجمي', 'lat': 31.0958, 'lng': 29.7606, 'radius': 15000},
        {'name': 'السيوف', 'lat': 31.2167, 'lng': 29.9667, 'radius': 8000},
        {'name': 'رشدي', 'lat': 31.2333, 'lng': 29.9667, 'radius': 8000},
        {'name': 'جليم', 'lat': 31.2333, 'lng': 29.9500, 'radius': 8000},
        {'name': 'باكوس', 'lat': 31.2500, 'lng': 29.9833, 'radius': 8000},
    ],
    # القليوبية
    'القليوبية': [
        {'name': 'بنها', 'lat': 30.4694, 'lng': 31.1840, 'radius': 20000},
        {'name': 'قليوب', 'lat': 30.1792, 'lng': 31.1311, 'radius': 12000},
        {'name': 'شبرا الخيمة', 'lat': 30.1286, 'lng': 31.2442, 'radius': 15000},
        {'name': 'القناطر الخيرية', 'lat': 30.1936, 'lng': 31.1372, 'radius': 10000},
        {'name': 'الخصوص', 'lat': 30.1667, 'lng': 31.3333, 'radius': 10000},
        {'name': 'العبور', 'lat': 30.2131, 'lng': 31.4686, 'radius': 12000},
        {'name': 'طوخ', 'lat': 30.3528, 'lng': 31.2025, 'radius': 12000},
    ],
    # الدقهلية
    'الدقهلية': [
        {'name': 'المنصورة', 'lat': 31.0409, 'lng': 31.3785, 'radius': 25000},
        {'name': 'طلخا', 'lat': 30.9750, 'lng': 31.3772, 'radius': 12000},
        {'name': 'ميت غمر', 'lat': 30.7136, 'lng': 31.2508, 'radius': 15000},
        {'name': 'السنبلاوين', 'lat': 30.9333, 'lng': 31.4667, 'radius': 10000},
        {'name': 'أجا', 'lat': 30.9414, 'lng': 31.2900, 'radius': 10000},
        {'name': 'منية النصر', 'lat': 31.1167, 'lng': 31.6333, 'radius': 8000},
    ],
    # الشرقية
    'الشرقية': [
        {'name': 'الزقازيق', 'lat': 30.5877, 'lng': 31.5020, 'radius': 25000},
        {'name': 'العاشر من رمضان', 'lat': 30.2973, 'lng': 31.4842, 'radius': 25000},
        {'name': 'بلبيس', 'lat': 30.4200, 'lng': 31.5636, 'radius': 15000},
        {'name': 'منيا القمح', 'lat': 30.5267, 'lng': 31.6631, 'radius': 12000},
        {'name': 'أبو حماد', 'lat': 30.7433, 'lng': 31.6792, 'radius': 10000},
    ],
    # المنوفية
    'المنوفية': [
        {'name': 'شبين الكوم', 'lat': 30.5549, 'lng': 30.9876, 'radius': 20000},
        {'name': 'منوف', 'lat': 30.4658, 'lng': 30.9308, 'radius': 15000},
        {'name': 'قويسنا', 'lat': 30.5689, 'lng': 31.1492, 'radius': 12000},
        {'name': 'أشمون', 'lat': 30.3000, 'lng': 30.9667, 'radius': 12000},
        {'name': 'تلا', 'lat': 30.6833, 'lng': 30.9500, 'radius': 10000},
        {'name': 'الباجور', 'lat': 30.4333, 'lng': 31.0333, 'radius': 10000},
    ],
    # الغربية
    'الغربية': [
        {'name': 'طنطا', 'lat': 30.7865, 'lng': 31.0004, 'radius': 25000},
        {'name': 'المحلة الكبرى', 'lat': 30.9714, 'lng': 31.1669, 'radius': 25000},
        {'name': 'كفر الزيات', 'lat': 30.8248, 'lng': 30.8181, 'radius': 15000},
        {'name': 'زفتى', 'lat': 30.7120, 'lng': 30.8777, 'radius': 15000},
        {'name': 'السنطة', 'lat': 30.9167, 'lng': 30.9833, 'radius': 10000},
    ],
    # البحيرة
    'البحيرة': [
        {'name': 'دمنهور', 'lat': 31.0341, 'lng': 30.4591, 'radius': 25000},
        {'name': 'كفر الدوار', 'lat': 31.1339, 'lng': 30.1136, 'radius': 20000},
        {'name': 'إيتاي البارود', 'lat': 30.8778, 'lng': 30.6667, 'radius': 12000},
        {'name': 'أبو المطامير', 'lat': 30.9131, 'lng': 30.1744, 'radius': 10000},
        {'name': 'رشيد', 'lat': 31.4044, 'lng': 30.4167, 'radius': 10000},
    ],
    # كفر الشيخ
    'كفر الشيخ': [
        {'name': 'كفر الشيخ', 'lat': 31.1094, 'lng': 30.9386, 'radius': 20000},
        {'name': 'دسوق', 'lat': 31.1339, 'lng': 30.6500, 'radius': 15000},
        {'name': 'فوة', 'lat': 31.2036, 'lng': 30.5489, 'radius': 10000},
        {'name': 'مطوبس', 'lat': 31.3622, 'lng': 30.5194, 'radius': 8000},
    ],
    # دمياط
    'دمياط': [
        {'name': 'دمياط', 'lat': 31.4167, 'lng': 31.8214, 'radius': 20000},
        {'name': 'رأس البر', 'lat': 31.5092, 'lng': 31.7347, 'radius': 10000},
        {'name': 'فارسكور', 'lat': 31.3286, 'lng': 31.7728, 'radius': 8000},
    ],
    # بورسعيد
    'بورسعيد': [
        {'name': 'بورسعيد', 'lat': 31.2564, 'lng': 32.2842, 'radius': 25000},
        {'name': 'بور فؤاد', 'lat': 31.2278, 'lng': 32.3203, 'radius': 15000},
    ],
    # الإسماعيلية
    'الإسماعيلية': [
        {'name': 'الإسماعيلية', 'lat': 30.6043, 'lng': 32.2723, 'radius': 25000},
        {'name': 'فايد', 'lat': 30.3028, 'lng': 32.3050, 'radius': 10000},
        {'name': 'القنطرة شرق', 'lat': 30.5644, 'lng': 32.3072, 'radius': 8000},
    ],
    # السويس
    'السويس': [
        {'name': 'السويس', 'lat': 29.9667, 'lng': 32.5498, 'radius': 25000},
    ],
    # الفيوم
    'الفيوم': [
        {'name': 'الفيوم', 'lat': 29.3084, 'lng': 30.8428, 'radius': 25000},
        {'name': 'سنورس', 'lat': 29.4092, 'lng': 30.6717, 'radius': 12000},
    ],
    # بني سويف
    'بني سويف': [
        {'name': 'بني سويف', 'lat': 29.0661, 'lng': 31.0994, 'radius': 25000},
        {'name': 'الواسطى', 'lat': 29.0336, 'lng': 31.1928, 'radius': 12000},
    ],
    # المنيا
    'المنيا': [
        {'name': 'المنيا', 'lat': 28.1099, 'lng': 30.7503, 'radius': 25000},
        {'name': 'ملوي', 'lat': 27.7314, 'lng': 30.8417, 'radius': 20000},
        {'name': 'سمالوط', 'lat': 28.3111, 'lng': 30.7106, 'radius': 15000},
    ],
    # أسيوط
    'أسيوط': [
        {'name': 'أسيوط', 'lat': 27.1783, 'lng': 31.1859, 'radius': 25000},
        {'name': 'ديروط', 'lat': 27.6108, 'lng': 30.8192, 'radius': 15000},
        {'name': 'منفلوط', 'lat': 27.3119, 'lng': 30.7542, 'radius': 12000},
    ],
    # سوهاج
    'سوهاج': [
        {'name': 'سوهاج', 'lat': 26.5571, 'lng': 31.6951, 'radius': 25000},
        {'name': 'جرجا', 'lat': 26.3372, 'lng': 31.8919, 'radius': 20000},
        {'name': 'أخميم', 'lat': 26.5667, 'lng': 31.7500, 'radius': 15000},
    ],
    # قنا
    'قنا': [
        {'name': 'قنا', 'lat': 26.1642, 'lng': 32.7267, 'radius': 25000},
        {'name': 'قوص', 'lat': 26.1500, 'lng': 32.7167, 'radius': 15000},
        {'name': 'نجع حمادي', 'lat': 26.0469, 'lng': 32.2539, 'radius': 15000},
    ],
    # الأقصر
    'الأقصر': [
        {'name': 'الأقصر', 'lat': 25.6872, 'lng': 32.6396, 'radius': 25000},
        {'name': 'إسنا', 'lat': 25.2931, 'lng': 32.5542, 'radius': 15000},
    ],
    # أسوان
    'أسوان': [
        {'name': 'أسوان', 'lat': 24.0889, 'lng': 32.8998, 'radius': 25000},
        {'name': 'دراو', 'lat': 24.4167, 'lng': 32.9333, 'radius': 10000},
        {'name': 'كوم أمبو', 'lat': 24.4667, 'lng': 31.7333, 'radius': 10000},
    ],
    # البحر الأحمر
    'البحر الأحمر': [
        {'name': 'الغردقة', 'lat': 27.2579, 'lng': 33.8116, 'radius': 30000},
        {'name': 'سفاجا', 'lat': 26.7333, 'lng': 33.9333, 'radius': 15000},
        {'name': 'مرسى علم', 'lat': 25.0667, 'lng': 34.9000, 'radius': 15000},
    ],
    # الوادي الجديد
    'الوادي الجديد': [
        {'name': 'الخارجة', 'lat': 25.4408, 'lng': 30.5877, 'radius': 20000},
        {'name': 'الداخلة', 'lat': 25.4833, 'lng': 29.0167, 'radius': 10000},
    ],
    # مطروح
    'مطروح': [
        {'name': 'مرسى مطروح', 'lat': 31.3525, 'lng': 27.2453, 'radius': 20000},
        {'name': 'العلمين', 'lat': 30.8333, 'lng': 28.9500, 'radius': 15000},
        {'name': 'سيوة', 'lat': 29.2000, 'lng': 25.5167, 'radius': 10000},
    ],
    # شمال سيناء
    'شمال سيناء': [
        {'name': 'العريش', 'lat': 31.1322, 'lng': 33.7986, 'radius': 20000},
        {'name': 'رفح', 'lat': 31.2875, 'lng': 34.2519, 'radius': 15000},
    ],
    # جنوب سيناء
    'جنوب سيناء': [
        {'name': 'شرم الشيخ', 'lat': 27.9158, 'lng': 34.3299, 'radius': 25000},
        {'name': 'دهب', 'lat': 28.4931, 'lng': 34.5047, 'radius': 10000},
        {'name': 'الطور', 'lat': 28.2411, 'lng': 33.6225, 'radius': 15000},
    ],
}

# ============================================
class HEREPharmacyCollector:
    def __init__(self, api_key: str):
        self.api_key = api_key
        self.supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
        self.session = requests.Session()
        self.collected_pharmacies = []
        self.seen_names = set()
        self.request_count = 0
        
    def is_chain_pharmacy(self, name: str) -> bool:
        """التحقق إذا كانت صيدلية سلسلة"""
        if not name:
            return True
        name_lower = name.lower()
        for chain in CHAIN_BLACKLIST:
            if chain.lower() in name_lower:
                return True
        return False
    
    def clean_name(self, name: str) -> str:
        """تنظيف الاسم وإضافة كلمة صيدلية"""
        if not name:
            return None
        
        # إزالة "صيدلية" المكررة
        name = re.sub(r'^صيدلية\s+', '', name, flags=re.IGNORECASE)
        name = re.sub(r'^pharmacy\s+', '', name, flags=re.IGNORECASE)
        
        # إضافة كلمة صيدلية في البداية
        return f"صيدلية {name.strip()}"
    
    def extract_address_components(self, address: Dict) -> Dict:
        """استخراج مكونات العنوان"""
        label = address.get('label', '')
        
        # استخراج الشارع
        street = address.get('street', '')
        if street:
            if not re.search(r'^(شارع|طريق|ميدان)', street, re.IGNORECASE):
                street = f"شارع {street}"
        
        # استخراج المنطقة/الحي
        district = (address.get('district', '') or 
                   address.get('neighborhood', '') or
                   address.get('subdistrict', ''))
        
        # استخراج المدينة
        city = address.get('city', '') or address.get('town', '')
        
        # استخراج المحافظة
        governorate = address.get('county', '') or address.get('state', '')
        
        # بناء العنوان المنسق
        address_parts = []
        if district:
            address_parts.append(district)
        if street:
            address_parts.append(street)
        if address.get('houseNumber'):
            address_parts.append(f"رقم {address['houseNumber']}")
        
        formatted_address = '، '.join(address_parts) if address_parts else label
        
        return {
            'address': formatted_address,
            'district': district,
            'city': city,
            'governorate': governorate
        }
    
    def fetch_pharmacies_in_circle(self, lat: float, lng: float, radius: int, city_name: str) -> List[Dict]:
        """جلب الصيدليات في دائرة محددة"""
        params = {
            'apiKey': self.api_key,
            'q': 'pharmacy صيدلية',
            'in': f'circle:{lat},{lng};r={radius}',
            'limit': 100,
            'lang': 'ar'
        }
        
        try:
            response = self.session.get(HERE_DISCOVER_URL, params=params, timeout=30)
            self.request_count += 1
            
            if response.status_code != 200:
                print(f"   ⚠️ خطأ HTTP {response.status_code}")
                return []
            
            data = response.json()
            
            if 'error' in data:
                print(f"   ⚠️ خطأ API: {data['error']}")
                return []
            
            pharmacies = []
            for item in data.get('items', []):
                name = item.get('title', '')
                
                # تخطي السلاسل
                if self.is_chain_pharmacy(name):
                    continue
                
                # تنظيف الاسم
                clean_name = self.clean_name(name)
                if not clean_name:
                    continue
                
                # التحقق من التكرار
                key = f"{clean_name}_{city_name}"
                if key in self.seen_names:
                    continue
                self.seen_names.add(key)
                
                # استخراج العنوان
                address_data = item.get('address', {})
                components = self.extract_address_components(address_data)
                
                pharmacy = {
                    'name': clean_name,
                    'address': components['address'] or f"{city_name}",
                    'governorate': components['governorate'] or self.infer_governorate(city_name),
                    'city': components['city'] or city_name,
                    'district': components['district'],
                    'source': 'HERE API',
                    'lat': item.get('position', {}).get('lat'),
                    'lng': item.get('position', {}).get('lng'),
                    'here_id': item.get('id')
                }
                
                pharmacies.append(pharmacy)
            
            return pharmacies
            
        except Exception as e:
            print(f"   ❌ خطأ: {e}")
            return []
    
    def infer_governorate(self, city_name: str) -> str:
        """استنتاج المحافظة من اسم المدينة"""
        for gov, cities in EGYPT_CITIES.items():
            for city in cities:
                if city['name'] == city_name:
                    return gov
        return None
    
    def fetch_governorate(self, gov_name: str) -> List[Dict]:
        """جلب كل الصيدليات في محافظة"""
        print(f"\n🔍 جلب: {gov_name}...")
        
        cities = EGYPT_CITIES.get(gov_name, [])
        if not cities:
            print(f"   ⚠️ لا توجد مدن محددة لـ {gov_name}")
            return []
        
        all_pharmacies = []
        
        for idx, city in enumerate(cities, 1):
            print(f"   [{idx}/{len(cities)}] {city['name']}...", end=' ')
            
            pharmacies = self.fetch_pharmacies_in_circle(
                city['lat'], 
                city['lng'], 
                city['radius'],
                city['name']
            )
            
            all_pharmacies.extend(pharmacies)
            print(f"✓ {len(pharmacies)}")
            
            # انتظار لتجنب الحظر
            time.sleep(1)
        
        print(f"   ✅ إجمالي {gov_name}: {len(all_pharmacies)} صيدلية")
        return all_pharmacies
    
    def save_to_supabase(self, pharmacies: List[Dict], clear_existing: bool = False):
        """حفظ في Supabase"""
        if not pharmacies:
            print("⚠️ لا يوجد بيانات للحفظ")
            return 0
        
        if clear_existing:
            print("\n🗑️ مسح البيانات القديمة...")
            try:
                self.supabase.table(TABLE_NAME).delete().neq('id', 0).execute()
                print("   ✅ تم المسح")
            except Exception as e:
                print(f"   ⚠️ خطأ في المسح: {e}")
        
        print(f"\n💾 حفظ {len(pharmacies)} صيدلية في Supabase...")
        
        # إعداد السجلات
        records = []
        for p in pharmacies:
            records.append({
                'name': p['name'],
                'address': p['address'],
                'governorate': p['governorate'],
                'city': p['city'],
                'district': p['district']
            })
        
        # الحفظ على دفعات
        batch_size = 100
        saved = 0
        for i in range(0, len(records), batch_size):
            batch = records[i:i+batch_size]
            try:
                self.supabase.table(TABLE_NAME).insert(batch).execute()
                saved += len(batch)
                print(f"   ✅ تم حفظ {saved}/{len(records)}")
                time.sleep(0.5)
            except Exception as e:
                print(f"   ❌ خطأ في الحفظ: {e}")
        
        return saved
    
    def run(self, selected_govs: List[str] = None, clear_existing: bool = False):
        """التشغيل الرئيسي"""
        print("=" * 80)
        print("🚀 جمع صيدليات حقيقية من HERE API")
        print("=" * 80)
        print(f"⏱️ البدء: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        print("-" * 80)
        
        # التحقق من API Key
        if not self.api_key or self.api_key == "YOUR_HERE_API_KEY":
            print("❌ خطأ: يجب إدخال HERE API Key")
            print("💡 احصل على مفتاح مجاني من: https://developer.here.com/")
            return
        
        all_pharmacies = []
        
        # تحديد المحافظات
        if selected_govs:
            govs_to_process = {k: v for k, v in EGYPT_CITIES.items() if k in selected_govs}
        else:
            govs_to_process = EGYPT_CITIES
        
        total_govs = len(govs_to_process)
        print(f"📍 عدد المحافظات: {total_govs}")
        print(f"🏙️ عدد المدن: {sum(len(cities) for cities in govs_to_process.values())}")
        print("-" * 80)
        
        # جلب من كل محافظة
        for idx, gov_name in enumerate(govs_to_process.keys(), 1):
            print(f"\n[{idx}/{total_govs}] ", end="")
            pharmacies = self.fetch_governorate(gov_name)
            all_pharmacies.extend(pharmacies)
            
            # استراحة بين المحافظات
            if idx < total_govs:
                time.sleep(3)
        
        # الملخص
        print("\n" + "=" * 80)
        print("📊 ملخص الجمع:")
        print("-" * 80)
        print(f"   إجمالي الصيدليات: {len(all_pharmacies)}")
        print(f"   المحافظات: {len(govs_to_process)}")
        print(f"   طلبات API: {self.request_count}")
        print(f"   متوسط/محافظة: {len(all_pharmacies) // len(govs_to_process) if govs_to_process else 0}")
        
        # التوزيع
        gov_counts = {}
        for p in all_pharmacies:
            gov = p['governorate'] or 'غير معروف'
            gov_counts[gov] = gov_counts.get(gov, 0) + 1
        
        print("\n📍 التوزيع:")
        for gov, count in sorted(gov_counts.items(), key=lambda x: x[1], reverse=True)[:15]:
            print(f"   {gov}: {count}")
        
        # الحفظ
        if all_pharmacies:
            saved = self.save_to_supabase(all_pharmacies, clear_existing)
            print(f"\n✅ تم حفظ {saved} صيدلية في قاعدة البيانات")
        
        print("-" * 80)
        print(f"⏱️ الانتهاء: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        print("=" * 80)


# ============================================
# التشغيل
# ============================================
if __name__ == "__main__":
    import sys
    
    # قراءة API Key من المعاملات أو استخدام الافتراضي
    api_key = HERE_API_KEY
    for arg in sys.argv:
        if arg.startswith('--key='):
            api_key = arg.split('=')[1]
    
    # قراءة المحافظات المحددة
    selected_govs = None
    if '--govs' in sys.argv:
        idx = sys.argv.index('--govs')
        if idx + 1 < len(sys.argv):
            selected_govs = sys.argv[idx + 1].split(',')
    
    # قراءة خيار المسح
    clear_db = '--clear' in sys.argv or '--new' in sys.argv
    
    try:
        collector = HEREPharmacyCollector(api_key)
        collector.run(selected_govs=selected_govs, clear_existing=clear_db)
        
    except KeyboardInterrupt:
        print("\n\n⚠️ تم الإيقاف من قبل المستخدم")
    except Exception as e:
        print(f"\n❌ خطأ فادح: {e}")
        import traceback
        traceback.print_exc()
