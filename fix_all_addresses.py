#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
سكريبت شامل لتنظيف عناوين الصيدليات مباشرة في قاعدة البيانات
تحديث مباشر لـ Supabase بقواعد تنظيف محسّنة
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
# قواعد التنظيف المحسّنة
# ============================================

class AddressFixer:
    def __init__(self):
        self.supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
        self.batch_size = 300
        self.fixed_count = 0
        self.error_count = 0
        
    # ========== قواعد التنظيف ==========
    
    def clean(self, address: str, gov: str = "", city: str = "") -> tuple:
        """
        تنظيف العنوان واستخراج المنطقة
        Returns: (cleaned_address, district)
        """
        if not address:
            return None, None
            
        original = address
        text = address
        
        # 1. إزالة الرموز الغريبة
        text = re.sub(r'[@#%^&*()_+=\[\]{}|\\<>/~`\-]{2,}', ' ', text)
        text = re.sub(r'\*{2,}|\-{2,}|\.{2,}|_{2,}', ' ', text)
        
        # 2. حذف المحافظة والمدينة من العنوان
        if gov:
            text = re.sub(rf'\b{re.escape(gov)}\b', '', text, flags=re.IGNORECASE)
        if city and city != gov:
            text = re.sub(rf'\b{re.escape(city)}\b', '', text, flags=re.IGNORECASE)
        
        # حذف أسماء المحافظات المعروفة
        governorates = ['القاهرة', 'الجيزة', 'الإسكندرية', 'القليوبية', 'الدقهلية', 
                       'الشرقية', 'المنوفية', 'الغربية', 'البحيرة', 'كفر الشيخ', 'دمياط',
                       'بورسعيد', 'الإسماعيلية', 'السويس', 'الفيوم', 'بني سويف', 'المنيا',
                       'أسيوط', 'سوهاج', 'قنا', 'الأقصر', 'أسوان']
        for g in governorates:
            text = re.sub(rf'\b{g}\b', '', text, flags=re.IGNORECASE)
        
        # 3. تصحيح الإملاء
        replacements = [
            (r'\bش\s+(?![^\s])', 'شارع '),           # ش → شارع
            (r'\bشارع\s+شارع\b', 'شارع'),           # إزالة التكرار
            (r'\bميد\b', 'ميدان'),                   # ميد → ميدان
            (r'\bجمب\b', 'بجوار'),                   # جمب → بجوار
            (r'\bجنب\b', 'بجوار'),                   # جنب → بجوار
            (r'\bقدام\b', 'أمام'),                  # قدام → أمام
            (r'\bقصاد\b', 'أمام'),                  # قصاد → أمام
            (r'\bورا\b', 'خلف'),                    # ورا → خلف
            (r'\bعماره\b', 'عمارة'),               # عماره → عمارة
            (r'\bشقه\b', 'شقة'),                     # شقه → شقة
            (r'\bدور\s+(\d+)', r'الدور \1'),         # دور 3 → الدور 3
            (r'\bمنطقة\s*', ''),                     # حذف كلمة منطقة
            (r'\bمصر\b', ''),                        # حذف كلمة مصر
            (r'\bمحافظة\b', ''),                     # حذف كلمة محافظة
        ]
        
        for pattern, replacement in replacements:
            text = re.sub(pattern, replacement, text, flags=re.IGNORECASE)
        
        # 4. استخراج المكونات
        district = None
        street = None
        landmark = None
        building = None
        
        # استخراج المنطقة
        area_patterns = [
            r'\b(المنشية|الشدية|الفلل|وسط البلد|الإشارة|الحرية|المحطة|الجمهورية|السكة الحديد|الملعب|الاستاد|الشعبية|أم بيومي|كفر الجزار|عزبة الوالدة|حي النصر|حي السلام|الصفا|الإصلاح|الأمل|النزهة|الفردوس|الورديان|الخلفاء|عرب الرمل|كفر العمار|قلما)\b',
            r'\b(حي\s+(?:أول|ثاني|ثالث|rابع|خامس|سادس|سابع|ثامن|تاسع|عاشر|\d+))\b',
            r'\b(الحي\s+(?:\d+|الأول|الثاني|الثالث|الرابع|الخامس|السادس|السابع|الثامن|التاسع|العاشر))\b',
        ]
        for pattern in area_patterns:
            match = re.search(pattern, text, re.IGNORECASE)
            if match:
                district = match.group(1)
                break
        
        # استخراج الشارع
        street_match = re.search(r'شارع\s+([^,،]+?)(?=\s+(?:بجوار|أمام|خلف|عمارة|برج|،|,|$))', text)
        if street_match:
            street = 'شارع ' + street_match.group(1).strip()
            # تنظيف: إزالة "عمارة" أو "برج" إذا ظهرت في نهاية اسم الشارع
            street = re.sub(r'\s+(?:عمارة|برج|رقم|\d).*$', '', street).strip()
        else:
            # محاولة أخرى: شارع + أي شيء حتى الفاصلة
            street_alt = re.search(r'شارع\s+([^,،]+)', text)
            if street_alt:
                street_name = street_alt.group(1).strip()
                street_name = re.sub(r'\s+(?:عمارة|برج|رقم|\d).*$', '', street_name).strip()
                if len(street_name) > 2:
                    street = 'شارع ' + street_name
        
        # استخراج العلامة المميزة
        landmark_match = re.search(r'(بجوار|أمام|خلف)\s+([^,،]+?)(?=\s*(?:،|,|$|عمارة|برج|رقم|\d))', text)
        if landmark_match:
            landmark = landmark_match.group(1) + ' ' + landmark_match.group(2).strip()
        
        # استخراج العمارة/البرج
        building_match = re.search(r'(عمارة|برج)\s+(?:رقم\s*)?(\d+)', text)
        if building_match:
            building = building_match.group(1) + ' ' + building_match.group(2)
        
        # 5. إعادة بناء العنوان
        parts = []
        if district:
            parts.append(district)
        if street:
            parts.append(street)
        if landmark:
            parts.append(landmark)
        if building:
            parts.append(building)
        
        cleaned = '، '.join(parts) if parts else text
        
        # تنظيف نهائي
        cleaned = re.sub(r'\s+', ' ', cleaned).strip()
        cleaned = re.sub(r'^[،,]\s*', '', cleaned)
        cleaned = re.sub(r'\s*[،,]$', '', cleaned)
        cleaned = re.sub(r'\s+', ' ', cleaned).strip()
        
        # إذا كان فارغاً، رجع المنظف بسيط
        if not cleaned:
            cleaned = re.sub(r'\s+', ' ', original).strip()
            cleaned = re.sub(rf'\b{re.escape(gov)}\b', '', cleaned, flags=re.IGNORECASE) if gov else cleaned
            cleaned = re.sub(rf'\b{re.escape(city)}\b', '', cleaned, flags=re.IGNORECASE) if city else cleaned
            cleaned = re.sub(r'\s+', ' ', cleaned).strip()
        
        return cleaned, district
    
    # ========== عمليات قاعدة البيانات ==========
    
    def fetch_records(self, offset: int = 0) -> list:
        """جلب السجلات"""
        try:
            response = self.supabase.table(TABLE_NAME)\
                .select('id, address, governorate, city, district')\
                .not_.is_('address', 'null')\
                .range(offset, offset + self.batch_size - 1)\
                .execute()
            return response.data or []
        except Exception as e:
            print(f"❌ خطأ في الجلب: {e}")
            return []
    
    def update_record(self, record_id: int, address: str, district: str = None) -> bool:
        """تحديث سجل"""
        try:
            data = {'address': address}
            if district:
                data['district'] = district
            
            self.supabase.table(TABLE_NAME).update(data).eq('id', record_id).execute()
            return True
        except Exception as e:
            print(f"❌ خطأ في التحديث {record_id}: {e}")
            return False
    
    # ========== التشغيل الرئيسي ==========
    
    def run(self, preview_only: bool = False, limit: int = None):
        """
        التشغيل الرئيسي
        preview_only: عرض فقط بدون تحديث
        limit: عدد محدد للاختبار
        """
        print("=" * 70)
        print("🔧 تنظيف عناوين الصيدليات - تحديث مباشر لقاعدة البيانات")
        print(f"📋 الوضع: {'معاينة فقط' if preview_only else 'تحديث فعلي'}")
        print("=" * 70)
        
        offset = 0
        batch = 1
        total_processed = 0
        
        while True:
            if limit and total_processed >= limit:
                print(f"\n⏹️ توقف عند الحد: {limit}")
                break
            
            print(f"\n📦 الدفعة #{batch} (offset: {offset})")
            print("-" * 50)
            
            records = self.fetch_records(offset)
            if not records:
                print("✅ اكتمل!")
                break
            
            for record in records:
                if limit and total_processed >= limit:
                    break
                
                record_id = record['id']
                original = record.get('address', '')
                gov = record.get('governorate', '')
                city = record.get('city', '')
                
                # تنظيف
                cleaned, district = self.clean(original, gov, city)
                
                if cleaned and (cleaned != original or district != record.get('district')):
                    if preview_only:
                        print(f"\n📝 #{record_id}")
                        print(f"   من: {original[:55]}{'...' if len(original) > 55 else ''}")
                        print(f"   إلى: {cleaned[:55]}{'...' if len(cleaned) > 55 else ''}")
                        if district:
                            print(f"   منطقة: {district}")
                        self.fixed_count += 1
                    else:
                        success = self.update_record(record_id, cleaned, district)
                        if success:
                            self.fixed_count += 1
                            print(f"✓ #{record_id} - تم التحديث")
                        else:
                            self.error_count += 1
                
                total_processed += 1
            
            if not preview_only:
                time.sleep(0.3)
            
            offset += self.batch_size
            batch += 1
        
        # الملخص
        print(f"\n{'=' * 70}")
        print("📊 الملخص النهائي")
        print(f"{'=' * 70}")
        print(f"   إجمالي المعالج: {total_processed}")
        print(f"   تم التحديث: {self.fixed_count}")
        print(f"   الأخطاء: {self.error_count}")
        print(f"{'=' * 70}\n")


# ============================================
# التشغيل
# ============================================
if __name__ == "__main__":
    import sys
    
    preview = '--preview' in sys.argv or '--test' in sys.argv
    limit = None
    
    for arg in sys.argv:
        if arg.startswith('--limit=') or arg.startswith('--max='):
            try:
                limit = int(arg.split('=')[1])
            except:
                pass
    
    try:
        fixer = AddressFixer()
        fixer.run(preview_only=preview, limit=limit)
    except KeyboardInterrupt:
        print("\n\n⚠️ تم الإيقاف")
    except Exception as e:
        print(f"\n❌ خطأ: {e}")
        import traceback
        traceback.print_exc()
