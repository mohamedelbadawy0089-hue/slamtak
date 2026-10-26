#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
جلب صيدليات حقيقية من OpenStreetMap - جميع محافظات مصر
استخدام Overpass API للحصول على بيانات مكانية دقيقة
"""

import requests
import json
import time
import re
from typing import List, Dict, Optional, Tuple
from supabase import create_client, Client
from datetime import datetime

# ============================================
# إعدادات Supabase
# ============================================
SUPABASE_URL = "https://iksjhjxwphmvthryfeae.supabase.co"
SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imlrc2poanh3cGhtdnRocnlmZWFlIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MDA3NTUzNiwiZXhwIjoyMDg1NjUxNTM2fQ.IQ4KfNGAa8mLk_SYRv5nqXquUtsxCiYdm2WClH4A0Q"
TABLE_NAME = "egypt_pharmacies_static"

# ============================================
# قائمة الاستبعاد - سلاسل الصيدليات
# ============================================
CHAIN_PATTERNS = [
    r'العزب[يى]', r'ezaby', r'el-?ezaby', r'سيف', r'seif', r'رشد[يى]', r'roushdy',
    r'19011', r'١٩٠١١', r'علي\s*و?علي', r'ali\s*(?:&|and|\+)?\s*ali',
    r'دلمار', r'delmar', r'عطا\s*الله', r'attallah', r'تامر', r'tamer',
    r'علام', r'allam', r'أبو\s*علي', r'abu\s*ali', r'الشارقة', r'sharjah',
    r'وايتس', r'whites', r'دوائي', r'daway', r'شفاء', r'shefaa', r'صورتص',
    r'أوسكار', r'oscar', r'طيبة', r'taiba', r'egypt\s*pharma', r'شاكر', r'shaker',
    r'el-?madina', r'المدينة', r'خليل', r'khalil', r'الدواء', r'eldawa',
    r'masr\s*pharma', r'misr\s*pharma', r'egypt\s*drug', r'الدكتور', r'dr\.?\s*',
    r'pharmacy\s*chain', r'صيدليات\s*السلاسل', r'صيدلية\s*سلسلة'
]

# ============================================
# حدود المحافظات للبحث في OSM
# ============================================
GOVERNORATES = {
    'القاهرة': {'bbox': [29.8500, 31.1500, 30.2000, 31.6500], 'cities': ['القاهرة', 'مدينة نصر', 'المعادي', 'مصر الجديدة', 'حلوان', 'المرج', 'عين شمس', 'الزيتون', 'الوايلي', 'السيدة زينب', 'الخليفة', 'الموسكي', 'باب الشعرية', 'الأزبكية', 'بولاق', 'الدرب الأحمر', 'القبة', 'منشية ناصر', 'الساحل', 'الشرابية', 'روض الفرج']},
    
    'الجيزة': {'bbox': [29.8000, 30.9000, 30.2000, 31.3500], 'cities': ['الجيزة', '6 أكتوبر', 'الشيخ زايد', 'الدقي', 'المهندسين', 'العجوزة', 'الهرم', 'فيصل', 'العمرانية', 'الطالبية', 'الوراق', 'إمبابة', 'المنيب', 'بشتيل', 'كرداسة', 'أبو النمرس', 'الحوامدية', 'البدرشين', 'الصف', 'أطفيح']},
    
    'الإسكندرية': {'bbox': [31.0500, 29.8500, 31.3500, 30.2500], 'cities': ['الإسكندرية', 'سموحة', 'محرم بك', 'سيدي جابر', 'المنتزة', 'العجمي', 'السيوف', 'الدخيلة', 'العصافرة', 'الأنفوشي', 'المنشية', 'بحري', 'رشدي', 'جليم', 'باكوس', 'زيزينيا', 'كفر عبده', 'سابا باشا', 'الشاطبي', 'العطارين', 'باب شرق']},
    
    'القليوبية': {'bbox': [30.0000, 31.0000, 30.5000, 31.4500], 'cities': ['بنها', 'قليوب', 'شبرا الخيمة', 'القناطر الخيرية', 'الخصوص', 'العبور', 'الخانكة', 'أبو زعبل', 'شبين القناطر', 'طوخ', 'كفر شكر']},
    
    'الدقهلية': {'bbox': [30.7500, 31.2500, 31.4500, 31.8500], 'cities': ['المنصورة', 'طلخا', 'ميت غمر', 'السنبلاوين', 'أجا', 'منية النصر', 'دكرنس', 'بلقاس', 'شربين', 'منية سمنود', 'المنزلة', 'تمي الأمديد', 'المطرية', 'نبروه']},
    
    'الشرقية': {'bbox': [30.2000, 31.3000, 31.2000, 32.2000], 'cities': ['الزقازيق', 'العاشر من رمضان', 'بلبيس', 'منيا القمح', 'أبو حماد', 'أبو كبير', 'الحسينية', 'الإبراهيمية', 'فاقوس', 'الصالحية', 'كفر صقر', 'أولاد صقر', 'القرين', 'مشتول السوق']},
    
    'المنوفية': {'bbox': [30.2000, 30.5000, 30.7000, 31.1000], 'cities': ['شبين الكوم', 'منوف', 'قويسنا', 'أشمون', 'الباجور', 'تلا', 'بركة السبع', 'السادات', 'سرس الليان', 'الشهداء']},
    
    'الغربية': {'bbox': [30.5000, 30.7000, 31.2000, 31.4000], 'cities': ['طنطا', 'المحلة الكبرى', 'كفر الزيات', 'زفتى', 'السنطة', 'قطور', 'بسيون', 'سمنود']},
    
    'البحيرة': {'bbox': [30.2500, 29.8000, 31.3500, 30.6500], 'cities': ['دمنهور', 'كفر الدوار', 'إيتاي البارود', 'أبو المطامير', 'أبو حمص', 'الدلنجات', 'المحمودية', 'الرحمانية', 'حوش عيسى', 'شبراخيت', 'كوم حمادة', 'رشيد', 'إدكو']},
    
    'كفر الشيخ': {'bbox': [30.9000, 30.4000, 31.5000, 31.1000], 'cities': ['كفر الشيخ', 'دسوق', 'فوة', 'مطوبس', 'البرلس', 'الحامول', 'بيلا', 'الرياض', 'سيدي سالم', 'قلين']},
    
    'دمياط': {'bbox': [31.4000, 31.7000, 31.8000, 32.3000], 'cities': ['دمياط', 'دمياط الجديدة', 'رأس البر', 'فارسكور', 'الزرقا', 'كفر سعد', 'كفر البطيخ']},
    
    'بورسعيد': {'bbox': [31.2000, 32.2000, 31.4000, 32.4000], 'cities': ['بورسعيد', 'بور فؤاد', 'الزهور', 'الشرق', 'الغرب', 'الجنوب', 'المناخ']},
    
    'الإسماعيلية': {'bbox': [30.3000, 32.1000, 30.8000, 32.4000], 'cities': ['الإسماعيلية', 'فايد', 'القنطرة شرق', 'القنطرة غرب', 'التل الكبير', 'أبو صوير']},
    
    'السويس': {'bbox': [29.8000, 32.4000, 30.2000, 32.6000], 'cities': ['السويس', 'الأربعين', 'الجناين', 'فيصل', 'عتاقة']},
    
    'الفيوم': {'bbox': [29.1000, 30.5000, 29.8000, 31.1000], 'cities': ['الفيوم', 'سنورس', 'إطسا', 'أبشواي', 'طامية', 'يوسف الصديق']},
    
    'بني سويف': {'bbox': [28.8000, 30.8000, 29.5000, 31.7000], 'cities': ['بني سويف', 'الواسطى', 'ناصر', 'ببا', 'الفشن', 'إهناسيا', 'سمسطا']},
    
    'المنيا': {'bbox': [27.8000, 30.5000, 28.8000, 31.0000], 'cities': ['المنيا', 'ملوي', 'سمالوط', 'بني مزار', 'مطاي', 'أبو قرقاص', 'العدوة', 'دير مواس']},
    
    'أسيوط': {'bbox': [26.9000, 31.0000, 27.9000, 31.5000], 'cities': ['أسيوط', 'ديروط', 'منفلوط', 'القوصية', 'أبنوب', 'أبو تيج', 'الغنايم', 'البداري', 'صدفا']},
    
    'سوهاج': {'bbox': [26.3000, 31.5000, 27.0000, 32.1000], 'cities': ['سوهاج', 'أخميم', 'البلينا', 'جرجا', 'دار السلام', 'جهينة', 'ساقلتة', 'طما', 'طهطا', 'المنشأة']},
    
    'قنا': {'bbox': [25.8000, 32.6000, 26.6000, 33.2000], 'cities': ['قنا', 'قوص', 'نجع حمادي', 'دشنا', 'أبو تشت', 'فرشوط', 'الوقف', 'قفط', 'نقادة']},
    
    'الأقصر': {'bbox': [25.4000, 32.4000, 26.0000, 33.0000], 'cities': ['الأقصر', 'القرنة', 'أرمنت', 'الطود', 'إسنا']},
    
    'أسوان': {'bbox': [23.8000, 32.6000, 24.8000, 33.2000], 'cities': ['أسوان', 'دراو', 'كوم أمبو', 'إدفو', 'نصر النوبة']},
    
    'البحر الأحمر': {'bbox': [25.0000, 33.6000, 27.0000, 37.0000], 'cities': ['الغردقة', 'سفاجا', 'القصير', 'رأس غارب', 'شلاتين', 'مرسى علم']},
    
    'الوادي الجديد': {'bbox': [24.0000, 25.0000, 27.5000, 30.5000], 'cities': ['الخارجة', 'الداخلة', 'الفرافرة', 'باريس']},
    
    'مطروح': {'bbox': [29.3000, 25.0000, 31.5000, 30.0000], 'cities': ['مرسى مطروح', 'الحمام', 'العلمين', 'الضبعة', 'سيوة', 'السلوم', 'سيدي براني']},
    
    'شمال سيناء': {'bbox': [29.8000, 32.3000, 31.2000, 34.5000], 'cities': ['العريش', 'رفح', 'الشيخ زويد', 'بئر العبد', 'نخل']},
    
    'جنوب سيناء': {'bbox': [27.8000, 33.0000, 29.5000, 35.0000], 'cities': ['شرم الشيخ', 'دهب', 'نويبع', 'الطور', 'سانت كاترين', 'أبو رديس']}
}

# ============================================
class OSMPharmacyFetcher:
    def __init__(self):
        self.supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
        self.session = requests.Session()
        self.session.headers.update({
            'User-Agent': 'Mozilla/5.0 (compatible; PharmacyBot/1.0; +mailto:contact@example.com)'
        })
        self.overpass_url = "https://overpass-api.de/api/interpreter"
        self.collected_pharmacies = []
        self.seen_names = set()  # لتجنب التكرار
        
    def is_chain_pharmacy(self, name: str) -> bool:
        """التحقق إذا كانت صيدلية سلسلة"""
        if not name:
            return True
        
        name_lower = name.lower()
        for pattern in CHAIN_PATTERNS:
            if re.search(pattern, name_lower, re.IGNORECASE):
                return True
        return False
    
    def build_address(self, tags: Dict) -> Tuple[str, str, str]:
        """بناء العنوان الكامل من tags"""
        parts = []
        
        # اسم الشارع
        street = tags.get('addr:street', '') or tags.get('street', '')
        if street:
            # إضافة كلمة شارع إذا مش موجودة
            if not re.search(r'^(شارع|طريق|ميدان)', street, re.IGNORECASE):
                street = f"شارع {street}"
            parts.append(street)
        
        # رقم المنزل/المبنى
        housenumber = tags.get('addr:housenumber', '')
        if housenumber:
            parts.append(f"رقم {housenumber}")
        
        # علامة مميزة
        landmark_tags = ['near', 'beside', 'opposite', 'next_to']
        for tag in landmark_tags:
            if tags.get(tag):
                parts.append(f"بجوار {tags[tag]}")
                break
        
        # استخراج المنطقة
        district = (tags.get('addr:district', '') or 
                   tags.get('district', '') or 
                   tags.get('suburb', '') or
                   tags.get('neighbourhood', '') or
                   tags.get('addr:neighbourhood', ''))
        
        # استخراج المدينة
        city = (tags.get('addr:city', '') or 
               tags.get('city', '') or
               tags.get('town', '') or
               tags.get('addr:town', ''))
        
        # العنوان الكامل إذا موجود
        full_addr = tags.get('addr:full', '') or tags.get('address', '')
        if full_addr and len(full_addr) > 5:
            # تنظيف العنوان الكامل
            full_addr = re.sub(r'\s+', ' ', full_addr).strip()
            if len(full_addr) > 10:
                return full_addr, district, city
        
        address = '، '.join(parts) if parts else None
        return address, district, city
    
    def fetch_governorate(self, gov_name: str, bbox: List[float], cities: List[str]) -> List[Dict]:
        """جلب صيدليات محافظة واحدة"""
        print(f"\n🔍 جلب: {gov_name}...")
        
        # استعلام Overpass شامل
        query = f"""
        [out:json][timeout:120];
        (
          node["amenity"="pharmacy"]({bbox[0]},{bbox[1]},{bbox[2]},{bbox[3]});
          way["amenity"="pharmacy"]({bbox[0]},{bbox[1]},{bbox[2]},{bbox[3]});
          relation["amenity"="pharmacy"]({bbox[0]},{bbox[1]},{bbox[2]},{bbox[3]});
        );
        out body center;
        >;
        out skel qt;
        """
        
        try:
            response = self.session.post(
                self.overpass_url,
                data=query,
                timeout=150
            )
            response.raise_for_status()
            data = response.json()
            
            pharmacies = []
            for element in data.get('elements', []):
                if element.get('type') not in ['node', 'way', 'relation']:
                    continue
                
                tags = element.get('tags', {})
                
                # الحصول على الاسم
                name = (tags.get('name:ar', '') or 
                       tags.get('name', '') or 
                       tags.get('name:en', ''))
                
                if not name or len(name) < 2:
                    continue
                
                # تخطي سلاسل الصيدليات
                if self.is_chain_pharmacy(name):
                    continue
                
                # إضافة كلمة صيدلية إذا مش موجودة
                if 'صيدلية' not in name and 'pharmacy' not in name.lower():
                    name = f"صيدلية {name}"
                
                # بناء العنوان
                address, district, city_from_osm = self.build_address(tags)
                
                # تحديد المدينة
                city = city_from_osm if city_from_osm else cities[0] if cities else gov_name
                
                # التحقق من التكرار
                key = f"{name}_{city}_{gov_name}"
                if key in self.seen_names:
                    continue
                self.seen_names.add(key)
                
                pharmacy = {
                    'name': name,
                    'address': address or f"{city} - {gov_name}",
                    'governorate': gov_name,
                    'city': city,
                    'district': district,
                    'source': 'OpenStreetMap',
                    'lat': element.get('lat') or element.get('center', {}).get('lat'),
                    'lon': element.get('lon') or element.get('center', {}).get('lon'),
                    'osm_id': element.get('id'),
                    'timestamp': datetime.now().isoformat()
                }
                
                pharmacies.append(pharmacy)
            
            print(f"   ✅ {len(pharmacies)} صيدلية حقيقية")
            return pharmacies
            
        except requests.exceptions.Timeout:
            print(f"   ⏱️ انتهى الوقت لـ {gov_name}، سأحاول مرة أخرى...")
            time.sleep(30)
            return self.fetch_governorate(gov_name, bbox, cities)
        except Exception as e:
            print(f"   ❌ خطأ: {e}")
            return []
    
    def save_to_supabase(self, pharmacies: List[Dict], clear_existing: bool = False):
        """حفظ في Supabase"""
        if not pharmacies:
            print("⚠️ لا يوجد بيانات للحفظ")
            return
        
        if clear_existing:
            print("\n🗑️ مسح البيانات القديمة...")
            try:
                self.supabase.table(TABLE_NAME).delete().neq('id', 0).execute()
                print("   ✅ تم المسح")
            except Exception as e:
                print(f"   ⚠️ لم يتم المسح: {e}")
        
        print(f"\n💾 حفظ {len(pharmacies)} صيدلية في Supabase...")
        
        # إعداد البيانات للإدخال
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
        print("🚀 جلب صيدليات حقيقية من OpenStreetMap - جميع محافظات مصر")
        print("=" * 80)
        print(f"⏱️ البدء: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        print("-" * 80)
        
        all_pharmacies = []
        
        # تحديد المحافظات للمعالجة
        if selected_govs:
            govs_to_process = {k: v for k, v in GOVERNORATES.items() if k in selected_govs}
        else:
            govs_to_process = GOVERNORATES
        
        total_govs = len(govs_to_process)
        for idx, (gov_name, data) in enumerate(govs_to_process.items(), 1):
            print(f"\n[{idx}/{total_govs}] ", end="")
            
            pharmacies = self.fetch_governorate(
                gov_name, 
                data['bbox'], 
                data['cities']
            )
            
            all_pharmacies.extend(pharmacies)
            
            # انتظار بين المحافظات لتجنب الحظر
            if idx < total_govs:
                time.sleep(5)
        
        # الملخص
        print("\n" + "=" * 80)
        print("📊 ملخص الجمع:")
        print("-" * 80)
        print(f"   إجمالي الصيدليات: {len(all_pharmacies)}")
        print(f"   المحافظات: {len(govs_to_process)}")
        print(f"   متوسط لكل محافظة: {len(all_pharmacies) // len(govs_to_process) if govs_to_process else 0}")
        
        # توزيع حسب المحافظة
        gov_counts = {}
        for p in all_pharmacies:
            gov = p['governorate']
            gov_counts[gov] = gov_counts.get(gov, 0) + 1
        
        print("\n📍 التوزيع:")
        for gov, count in sorted(gov_counts.items(), key=lambda x: x[1], reverse=True)[:10]:
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
    
    # معالجة المعاملات
    clear_db = '--clear' in sys.argv or '--new' in sys.argv
    
    # اختيار محافظات محددة أو الكل
    selected = None
    if '--govs' in sys.argv:
        idx = sys.argv.index('--govs')
        if idx + 1 < len(sys.argv):
            selected = sys.argv[idx + 1].split(',')
    
    try:
        fetcher = OSMPharmacyFetcher()
        fetcher.run(selected_govs=selected, clear_existing=clear_db)
        
    except KeyboardInterrupt:
        print("\n\n⚠️ تم الإيقاف من قبل المستخدم")
    except Exception as e:
        print(f"\n❌ خطأ فادح: {e}")
        import traceback
        traceback.print_exc()
