#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
سكريبت تنظيف وتنسيق عمود address في جدول egypt_pharmacies_static
استخدام مكتبة re للتنظيف الدقيق
"""

import re
import time
from supabase import create_client, Client

# ============================================
# إعدادات Supabase
# ============================================
SUPABASE_URL = "https://iksjhjxwphmvthryfeae.supabase.co"
SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imlrc2poanh3cGhtdnRocnlmZWFlIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MDA3NTUzNiwiZXhwIjoyMDg1NjUxNTM2fQ.IQ4KfNGAa8mLk_SYRv5nqXquUtsxCiYdm2WClH4A0Q"
TABLE_NAME = "egypt_pharmacies_static"

# ============================================
# قواميس التصحيح الإملائي والتوحيد
# ============================================
SPELLING_CORRECTIONS = {
    # تصحيح شارع
    r'\bش\s+': 'شارع ',
    r'\bشارع\s+شارع\b': 'شارع',
    
    # توحيد بجوار
    r'\bجمب\b': 'بجوار',
    r'\bجنب\b': 'بجوار',
    r'\bقبل\b': 'بجوار',
    r'\bبعد\b': 'بجوار',
    
    # توحيد أمام
    r'\bقدام\b': 'أمام',
    r'\bقدام\b': 'أمام',
    
    # توحيد ميدان
    r'\bميد\b': 'ميدان',
    
    # توحيد عمارة
    r'\bعماره\b': 'عمارة',
    r'\bعمارة\b': 'عمارة',
    
    # توحيد برج
    r'\bبرج\b': 'برج',
    
    # توحيد المنطقة
    r'\bمنطقة\s*': '',
}

# كلمات مفتاحية للتعرف على المكونات
AREA_KEYWORDS = [
    'المنشية', 'الشدية', 'الفلل', 'وسط البلد', 'الإشارة', 'الحرية', 'المحطة',
    'الجمهورية', 'السكة الحديد', 'الملعب', 'الاستاد', 'الشعبية', 'أم بيومي',
    'كفر الجزار', 'الصفا', 'الإصلاح', 'الأمل', 'النزهة', 'الفردوس', 'الورديان',
    'الخلفاء', 'عرب الرمل', 'كفر العمار', 'قلما', 'عزبة', 'منشية', 'حي أول',
    'حي ثاني', 'حي ثالث', 'حي رابع', 'حي 1', 'حي 2', 'حي 3', 'حي 4',
    'مدينة نصر', 'المعادي', 'مصر الجديدة', 'حلوان', 'شبرا', 'الزيتون',
    'المرج', 'عين شمس', 'السيدة زينب', 'الخليفة', 'الموسكي', 'الأزبكية'
]

LANDMARK_KEYWORDS = [
    'كوبري', 'جامع', 'كنيسة', 'مستشفى', 'مدرسة', 'مول', 'سنتر', 'فندق',
    'بنك', 'سوق', 'محطة', 'كشك', 'بوفيه', 'مخبز', 'مطعم', 'كافيه'
]

# أسماء المحافظات للحذف من العنوان
GOVERNORATE_NAMES = [
    'القاهرة', 'الجيزة', 'الإسكندرية', 'القليوبية', 'الدقهلية', 'الشرقية',
    'المنوفية', 'الغربية', 'البحيرة', 'كفر الشيخ', 'دمياط', 'بورسعيد',
    'الإسماعيلية', 'السويس', 'الفيوم', 'بني سويف', 'المنيا', 'أسيوط',
    'سوهاج', 'قنا', 'الأقصر', 'أسوان', 'البحر الأحمر', 'الوادي الجديد',
    'مطروح', 'شمال سيناء', 'جنوب سيناء'
]

# رموز غريبة للحذف
WEIRD_SYMBOLS = r'[@#%^&*()_+=\[\]{}|\\<>/~`\-]{3,}|\*{3,}|\-{3,}|\.{3,}'


class AddressCleaner:
    def __init__(self):
        self.supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
        self.batch_size = 300
        self.processed = 0
        self.updated = 0
        self.errors = 0
        
    def remove_weird_symbols(self, text: str) -> str:
        """حذف الرموز الغريبة"""
        if not text:
            return text
        # حذف الرموز المتكررة
        text = re.sub(WEIRD_SYMBOLS, ' ', text)
        # حذف المسافات المتكررة
        text = re.sub(r'\s+', ' ', text)
        return text.strip()
    
    def remove_governorate_from_address(self, address: str, governorate: str) -> str:
        """حذف اسم المحافظة من العنوان"""
        if not address or not governorate:
            return address
        
        # حذف المحافظة المحددة
        pattern = rf'\b{re.escape(governorate)}\b'
        address = re.sub(pattern, '', address, flags=re.IGNORECASE)
        
        # حذف أي محافظة أخرى موجودة في العنوان
        for gov in GOVERNORATE_NAMES:
            if gov != governorate:
                pattern = rf'\b{re.escape(gov)}\b'
                address = re.sub(pattern, '', address, flags=re.IGNORECASE)
        
        return address
    
    def fix_spelling(self, text: str) -> str:
        """تصحيح الإملاء"""
        if not text:
            return text
        
        for pattern, replacement in SPELLING_CORRECTIONS.items():
            text = re.sub(pattern, replacement, text, flags=re.IGNORECASE)
        
        return text
    
    def extract_components(self, address: str) -> dict:
        """استخراج مكونات العنوان"""
        components = {
            'area': None,
            'street': None,
            'landmark': None,
            'building': None
        }
        
        if not address:
            return components
        
        # البحث عن المنطقة
        for area in AREA_KEYWORDS:
            pattern = rf'\b{re.escape(area)}\b'
            if re.search(pattern, address, re.IGNORECASE):
                components['area'] = area
                break
        
        # البحث عن الشارع (ما بعد كلمة شارع)
        street_match = re.search(
            r'شارع\s+([^,،]+?)(?=\s+(?:بجوار|أمام|ميدان|عمارة|برج|،|,|$))',
            address
        )
        if street_match:
            components['street'] = 'شارع ' + street_match.group(1).strip()
        
        # البحث عن علامة مميزة (بجوار/أمام + ما يليها)
        landmark_match = re.search(
            r'(بجوار|أمام)\s+([^,،]+?)(?=\s*(?:،|,|$))',
            address
        )
        if landmark_match:
            components['landmark'] = landmark_match.group(1) + ' ' + landmark_match.group(2).strip()
        
        # البحث عن المبنى
        building_match = re.search(
            r'(عمارة|برج)\s+(?:رقم\s*)?(\d+)',
            address
        )
        if building_match:
            components['building'] = building_match.group(1) + ' ' + building_match.group(2)
        
        return components
    
    def rebuild_address(self, components: dict) -> str:
        """إعادة بناء العنوان بالترتيب الصحيح"""
        parts = []
        
        # المنطقة أولاً
        if components['area']:
            parts.append(components['area'])
        
        # ثم الشارع
        if components['street']:
            parts.append(components['street'])
        
        # ثم العلامة المميزة
        if components['landmark']:
            parts.append(components['landmark'])
        
        # أخيراً المبنى إذا موجود
        if components['building']:
            parts.append(components['building'])
        
        # ربط المكونات بفاصلة
        return '، '.join(parts) if parts else ''
    
    def clean_address(self, address: str, governorate: str = None) -> tuple:
        """
        تنظيف العنوان واستخراج المنطقة
        Returns: (cleaned_address, district)
        """
        if not address:
            return None, None
        
        original = address
        
        # 1. حذف الرموز الغريبة
        address = self.remove_weird_symbols(address)
        
        # 2. حذف المحافظة من العنوان
        address = self.remove_governorate_from_address(address, governorate)
        
        # 3. تصحيح الإملاء
        address = self.fix_spelling(address)
        
        # 4. استخراج المكونات
        components = self.extract_components(address)
        
        # 5. إعادة بناء العنوان
        cleaned = self.rebuild_address(components)
        
        # 6. استخراج المنطقة
        district = components['area']
        
        return cleaned, district
    
    def fetch_records(self, offset: int = 0) -> list:
        """جلب السجلات"""
        try:
            response = self.supabase.table(TABLE_NAME)\
                .select('id, address, governorate, city, district')\
                .not_.is_('address', 'null')\
                .range(offset, offset + self.batch_size - 1)\
                .execute()
            
            return response.data if response.data else []
        except Exception as e:
            print(f"❌ Error fetching: {e}")
            return []
    
    def update_record(self, record_id: int, cleaned_address: str, district: str):
        """تحديث سجل واحد"""
        try:
            update_data = {'address': cleaned_address}
            if district:
                update_data['district'] = district
            
            self.supabase.table(TABLE_NAME)\
                .update(update_data)\
                .eq('id', record_id)\
                .execute()
            
            return True
        except Exception as e:
            print(f"❌ Error updating {record_id}: {e}")
            return False
    
    def run(self):
        """التشغيل الرئيسي"""
        print("=" * 70)
        print("🚀 بدء تنظيف عناوين الصيدليات")
        print("=" * 70)
        
        offset = 0
        batch_num = 1
        
        while True:
            print(f"\n📦 الدفعة #{batch_num} (offset: {offset})")
            print("-" * 50)
            
            records = self.fetch_records(offset)
            
            if not records:
                print("✅ تم الانتهاء من جميع السجلات")
                break
            
            for record in records:
                original = record.get('address', '')
                gov = record.get('governorate', '')
                record_id = record['id']
                
                # تنظيف العنوان
                cleaned, district = self.clean_address(original, gov)
                
                if cleaned and cleaned != original:
                    success = self.update_record(record_id, cleaned, district)
                    
                    if success:
                        self.updated += 1
                        print(f"✓ #{record_id}")
                        print(f"    من: {original[:50]}...")
                        print(f"    إلى: {cleaned[:50]}...")
                        if district:
                            print(f"    المنطقة: {district}")
                    else:
                        self.errors += 1
                else:
                    # العنوان نظيف بالفعل أو لم يتغير
                    pass
                
                self.processed += 1
            
            # انتظار بين الدفعات
            time.sleep(0.3)
            
            offset += self.batch_size
            batch_num += 1
            
            # ملخص كل 5 دفعات
            if batch_num % 5 == 0:
                self.print_summary()
        
        self.print_summary(final=True)
    
    def print_summary(self, final=False):
        """طباعة ملخص"""
        title = "📊 الملخص النهائي" if final else "📊 الملخص"
        print(f"\n{'=' * 70}")
        print(title)
        print(f"{'=' * 70}")
        print(f"   إجمالي المعالج: {self.processed}")
        print(f"   تم التحديث: {self.updated}")
        print(f"   الأخطاء: {self.errors}")
        print(f"   لم يتغير: {self.processed - self.updated - self.errors}")
        print(f"{'=' * 70}\n")


if __name__ == "__main__":
    try:
        cleaner = AddressCleaner()
        cleaner.run()
    except KeyboardInterrupt:
        print("\n\n⚠️ تم الإيقاف")
    except Exception as e:
        print(f"\n❌ خطأ: {e}")
        import traceback
        traceback.print_exc()
