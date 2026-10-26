#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
سكريبت تنظيف متقدم لعناوين الصيدليات - الإصدار 2
دقة عالية في استخراج المكونات وتنسيق العناوين
"""

import re
import time
from supabase import create_client, Client
from typing import Tuple, Dict, Optional

# ============================================
# إعدادات Supabase
# ============================================
SUPABASE_URL = "https://iksjhjxwphmvthryfeae.supabase.co"
SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imlrc2poanh3cGhtdnRocnlmZWFlIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MDA3NTUzNiwiZXhwIjoyMDg1NjUxNTM2fQ.IQ4KfNGAa8mLk_SYRv5nqXquUtsxCiYdm2WClH4A0Q"
TABLE_NAME = "egypt_pharmacies_static"

# ============================================
# قواميس متقدمة للتصحيح والتوحيد
# ============================================

# تصحيحات إملائية شاملة
SPELLING_FIXES = {
    # شارع ومتعلقاته
    r'\bش\s+(?![^\s])': 'شارع ',
    r'\bشارع\s+شارع\b': 'شارع',
    r'\bالشارع\b': 'شارع',
    r'\bشارع\s+الشارع\b': 'شارع',
    
    # ميدان ومتعلقاته
    r'\bميد\b': 'ميدان',
    r'\bالميدان\b': 'ميدان',
    r'\bميدان\s+الميدان\b': 'ميدان',
    
    # بجوار وبدائلها
    r'\bجمب\b': 'بجوار',
    r'\bجنب\b': 'بجوار',
    r'\bقبل\b': 'بجوار',
    r'\بعد\b': 'بجوار',
    r'\bقبالة\b': 'بجوار',
    r'\bتحت\b': 'بجوار',
    r'\bفوق\b': 'بجوار',
    
    # أمام وبدائلها
    r'\bقدام\b': 'أمام',
    r'\bقصاد\b': 'أمام',
    r'\bناحية\b': 'أمام',
    
    # خلف وبدائلها
    r'\bورا\b': 'خلف',
    r'\bوراء\b': 'خلف',
    
    # عمارة وبدائلها
    r'\bعماره\b': 'عمارة',
    r'\bعمارة\s+رقم\b': 'عمارة',
    r'\bع\s*(\d+)\b': r'عمارة \1',
    
    # برج وبدائلها
    r'\bبرج\s+رقم\b': 'برج',
    r'\bبرج\s+(\d+)\b': r'برج \1',
    
    # شقة
    r'\bشقه\b': 'شقة',
    r'\bشق\s*(\d+)\b': r'شقة \1',
    
    # الطابق
    r'\bدور\b': 'الدور',
    r'\bالدور\s*(\d+)\b': r'الدور \1',
    r'\bطابق\b': 'الدور',
    
    # رقم
    r'\bرق\b': 'رقم',
    r'\bرقم\s*رقم\b': 'رقم',
    
    # توحيد المنطقة/حي
    r'\bمنطقة\s*': '',
    r'\bحى\b': 'حي',
    r'\bالحى\b': 'حي',
    
    # إزالة كلمات زائدة
    r'\bمصر\b': '',
    r'\bجمهورية\s*مصر\s*العربية\b': '',
    r'\bمحافظة\b': '',
}

# ============================================
# قواميس المناطق المفصلة حسب المحافظة
# ============================================
DETAILED_AREAS = {
    # القليوبية - بنها
    'بنها': [
        'المنشية', 'الشدية', 'الفلل', 'وسط البلد', 'الإشارة', 'الحرية', 'المحطة',
        'الجمهورية', 'السكة الحديد', 'الملعب', 'الاستاد', 'الشعبية', 'أم بيومي',
        'كفر الجزار', 'عزبة الوالدة', 'الحي الأول', 'الحي الثاني', 'الحي الثالث',
        'الحي الرابع', 'الحي الخامس', 'الحي السادس', 'الحي السابع', 'الحي الثامن',
        'الحي التاسع', 'الحي العاشر', 'حي النصر', 'حي السلام', 'الصفا', 'الإصلاح',
        'الأمل', 'النزهة', 'الفردوس', 'الورديان', 'الخلفاء', 'عرب الرمل', 'كفر العمار',
        'قلما', 'بنها الجديدة', 'منشية ب conflict', 'منشية النصر', 'منشية السلام'
    ],
    # القاهرة
    'مدينة نصر': ['حي السفارات', 'حي الأربعين', 'حي الشيخ زايد', 'حي العامرية', 'حي غرب'],
    'المعادي': ['المعادي الجديدة', 'المعادي القديمة', 'حي اللاسلكي', 'دجلة'],
    'مصر الجديدة': ['روكسي', 'هليوبوليس', 'الكرمة', 'غمرة'],
    'حلوان': ['حلوان الجديدة', 'عين حلوان', 'المعصرة', 'طرة'],
    'القاهرة': ['وسط البلد', 'العتبة', 'الأزبكية', 'الحسين', 'السيدة زينب', 'الخليفة'],
    'شبرا': ['شبرا مصر', 'روض الفرج', 'الساحل'],
    'الزيتون': ['حي الزيتون', 'المطرية'],
    'عين شمس': ['العمرانية', 'الشرابية', 'الحرفيين'],
    'المرج': ['المرج الجديدة', 'المرج القديمة'],
    
    # الجيزة
    'الجيزة': ['العمرانية', 'الطالبية', 'الوراق', 'إمبابة', 'منشية القناطر'],
    '6 أكتوبر': ['الحي الأول', 'الحي الثاني', 'الحي الثالث', 'الحي الرابع', 'الحي الخامس',
                'الحي السادس', 'الحي السابع', 'الحي الثامن', 'الحي التاسع', 'الحي العاشر',
                'الحي 11', 'الحي 12', 'الحي 13', 'الحي 14', 'الحي 15', 'الحي 16'],
    'الشيخ زايد': ['الحي الأول', 'الحي الثاني', 'الحي الثالث', 'الحي الرابع', 'الحي الخامس',
                   'الحي السادس', 'الحي السابع', 'الحي الثامن', 'الحي التاسع', 'الحي العاشر',
                   'الحي 11', 'الحي 12', 'الحي 13', 'الحي 14', 'الحي 15', 'الحي 16', 'الحي 17', 'الحي 18', 'الحي 19', 'الحي 20'],
    'الدقي': ['الدقي الجديدة', 'الدقي القديمة', 'المهندسين'],
    'المهندسين': ['حي المهندسين', 'شارع جامعة الدول'],
    'العجوزة': ['العجوزة', 'كوم الدكة'],
    'الهرم': ['الهرم', 'كفرطهرمس', 'منشية القباطي'],
    'فيصل': ['فيصل', 'العشرين', 'الدويقة'],
    
    # الإسكندرية
    'الإسكندرية': ['المنشية', 'الأنفوشي', 'بحري', 'محطة الرمل', 'رشدي', 'جليم', 'باكوس'],
    'سموحة': ['سموحة', 'جليم', 'الشاطبي'],
    'محرم بك': ['محرم بك', 'كامب شيزار'],
    'سيدي جابر': ['سيدي جابر', 'الإبراهيمية'],
    'المنتزة': ['المنتزة أول', 'المنتزة ثان', 'المنتزة ثالث'],
    'العجمي': ['العجمي', 'العصافرة', 'الدخيلة'],
    
    # الدقهلية
    'المنصورة': ['حي الجامعة', 'حي الثورة', 'حي الجمهورية', 'حي السلام', 'عمر أفندي',
                 'النحاس', 'شارع الجمهورية', 'شارع قناة السويس'],
    'طلخا': ['طلخا', 'ميت غمر'],
    'ميت غمر': ['ميت غمر', 'السنبلاوين'],
    
    # الشرقية
    'الزقازيق': ['حي أول', 'حي ثاني', 'القومية', 'الترعة'],
    'العاشر من رمضان': ['الحي الأول', 'الحي الثاني', 'الحي الثالث', 'الحي الرابع', 'الحي الخامس',
                        'الحي السادس', 'الحي السابع', 'الحي الثامن', 'الحي التاسع', 'الحي العاشر',
                        'الحي 11', 'الحي 12', 'الحي 13', 'الحي 14', 'الحي 15', 'الحي 16', 'الحي 17', 'الحي 18'],
    
    # المنوفية
    'شبين الكوم': ['حي غرب', 'حي شرق', 'بنى خالد'],
    'منوف': ['منوف', 'منشية فؤاد'],
    
    # الغربية
    'طنطا': ['حي أول', 'حي ثاني', 'حي ثالث', 'السبع بنات', 'باب المداحنة'],
    'المحلة الكبرى': ['المحلة', 'حي أول', 'حي ثاني'],
    
    # البحيرة
    'دمنهور': ['حي غرب', 'حي شرق'],
    'كفر الدوار': ['كفر الدوار', 'الحي الأول', 'الحي الثاني'],
    
    # أسيوط
    'أسيوط': ['حي شرق', 'حي غرب', 'حي الجامعة', 'حي العمال'],
    
    # سوهاج
    'سوهاج': ['حي شرق', 'حي غرب', 'الكوثر'],
    
    # قنا
    'قنا': ['حي شرق', 'حي غرب', 'حي الجامعة', 'حي الناصرية'],
    
    # الأقصر
    'الأقصر': ['حي شرق', 'حي غرب', 'حي الجامعة', 'الكرنك'],
}

# شوارع رئيسية مشهورة
MAIN_STREETS = [
    'شارع 26 يوليو', 'شارع الأزهر', 'شارع الجمهورية', 'شارع رمسيس', 'شارع القصر العيني',
    'شارع التحرير', 'شارع قناة السويس', 'شارع الهرم', 'شارع فيصل', 'شارع العروبة',
    'شارع أحمد عرابي', 'شارع محيي الدين أبو العز', 'شارع جامعة الدول', 'شارع النصر',
    'شارع السادات', 'شارع الجلاء', 'شارع الجيش', 'شارع النحاس', 'شارع الجمهورية',
    'طريق مصر الإسكندرية', 'طريق مصر القاهرة', 'طريق القاهرة الإسكندرية',
    'الدائري', 'الصحراوي', 'الإقليمي', 'الزراعي'
]

# علامات مميزة
LANDMARKS = [
    'كوبري', 'جامع', 'مسجد', 'كنيسة', 'مستشفى', 'مستشفى', 'مدرسة', 'سنتر', 'مول',
    'فندق', 'بنك', 'بنك', 'سوق', 'محطة', 'كشك', 'بوفيه', 'مخبز', 'مطعم', 'كافيه',
    'كافتيريا', 'سوبر ماركت', 'هايبر', 'محل', 'معرض', 'صيدلية', 'مركز',
    'نادي', 'حديقة', 'ميدان', 'ساحة', 'كورنيش'
]

# أسماء المحافظات للحذف
GOVERNORATE_NAMES = [
    'القاهرة', 'الجيزة', 'الإسكندرية', 'القليوبية', 'الدقهلية', 'الشرقية',
    'المنوفية', 'الغربية', 'البحيرة', 'كفر الشيخ', 'دمياط', 'بورسعيد',
    'الإسماعيلية', 'السويس', 'الفيوم', 'بني سويف', 'المنيا', 'أسيوط',
    'سوهاج', 'قنا', 'الأقصر', 'أسوان', 'البحر الأحمر', 'الوادي الجديد',
    'مطروح', 'شمال سيناء', 'جنوب سيناء'
]

# رموز غريبة للحذف
WEIRD_PATTERNS = [
    r'[@#%^&*()_+=\[\]{}|\\<>/~`\-]{2,}',  # رموز متكررة
    r'\*{2,}',  # نجوم
    r'\-{2,}',  # شرطات
    r'\.{2,}',  # نقاط
    r'_{2,}',   # underscores
    r'\s{2,}',  # مسافات متكررة
]


class AddressCleanerV2:
    """منظف العناوين الإصدار 2 - دقة عالية"""
    
    def __init__(self):
        self.supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
        self.batch_size = 200
        self.processed = 0
        self.updated = 0
        self.errors = 0
        self.skipped = 0
        
    # ============================================
    # المرحلة 1: التنظيف الأولي
    # ============================================
    
    def remove_weird_chars(self, text: str) -> str:
        """حذف الرموز الغريبة والتكرارات"""
        if not text:
            return text
        
        for pattern in WEIRD_PATTERNS:
            text = re.sub(pattern, ' ', text)
        
        # حذف الأسطر الجديدة والتابات
        text = text.replace('\n', ' ').replace('\t', ' ')
        
        # تقليل المسافات المتكررة
        text = re.sub(r'\s+', ' ', text)
        
        return text.strip()
    
    def remove_governorates(self, text: str, gov: str = None) -> str:
        """حذف أسماء المحافظات من العنوان"""
        if not text:
            return text
        
        # حذف المحافظة المحددة أولاً
        if gov:
            pattern = rf'\b{re.escape(gov)}\b'
            text = re.sub(pattern, '', text, flags=re.IGNORECASE)
        
        # حذف كل المحافظات
        for g in GOVERNORATE_NAMES:
            pattern = rf'\b{re.escape(g)}\b'
            text = re.sub(pattern, '', text, flags=re.IGNORECASE)
        
        return text
    
    def fix_spelling(self, text: str) -> str:
        """تصحيح الإملاء"""
        if not text:
            return text
        
        # تطبيق كل التصحيحات
        for pattern, replacement in SPELLING_FIXES.items():
            text = re.sub(pattern, replacement, text, flags=re.IGNORECASE)
        
        return text
    
    # ============================================
    # المرحلة 2: استخراج المكونات
    # ============================================
    
    def extract_area(self, text: str, city: str = None, gov: str = None) -> Optional[str]:
        """استخراج المنطقة/الحي بدقة"""
        if not text:
            return None
        
        text_lower = text.lower()
        
        # البحث في مناطق المدينة المحددة
        if city and city in DETAILED_AREAS:
            for area in DETAILED_AREAS[city]:
                pattern = rf'\b{re.escape(area.lower())}\b'
                if re.search(pattern, text_lower):
                    return area
        
        # البحث في مناطق المحافظة
        if gov and gov in DETAILED_AREAS:
            for area in DETAILED_AREAS[gov]:
                pattern = rf'\b{re.escape(area.lower())}\b'
                if re.search(pattern, text_lower):
                    return area
        
        # البحث العام في كل المناطق
        for city_areas in DETAILED_AREAS.values():
            for area in city_areas:
                pattern = rf'\b{re.escape(area.lower())}\b'
                if re.search(pattern, text_lower):
                    return area
        
        # البحث عن "حي" + رقم
        match = re.search(r'\bحي\s+(\d+|أول|ثاني|ثالث|rابع|خامس|سادس|سابع|ثامن|تاسع|عاشر|11|12|13|14|15|16|17|18|19|20)\b', text, re.IGNORECASE)
        if match:
            return f"حي {match.group(1)}"
        
        # البحث عن "منطقة" + اسم
        match = re.search(r'\bمنطقة\s+([^,،]+?)(?=\s*(?:،|,|$))', text)
        if match:
            return match.group(1).strip()
        
        # البحث عن "عزبة" + اسم
        match = re.search(r'\bعزبة\s+([^,،]+?)(?=\s*(?:،|,|$))', text)
        if match:
            return f"عزبة {match.group(1).strip()}"
        
        return None
    
    def extract_street(self, text: str) -> Optional[str]:
        """استخراج الشارع بدقة"""
        if not text:
            return None
        
        # البحث في الشوارع الرئيسية أولاً
        for street in MAIN_STREETS:
            pattern = rf'\b{re.escape(street)}\b'
            if re.search(pattern, text, re.IGNORECASE):
                return street
        
        # استخراج "شارع" + ما بعده
        # نمط محسن: شارع + اسم (حتى الفاصلة أو بجوار/أمام/خلف/ميدان/عمارة/برج)
        match = re.search(
            r'شارع\s+((?:[^,،]+?)(?=\s+(?:بجوار|أمام|خلف|ميدان|عمارة|برج|،|,|رقم|\d|$)))',
            text,
            re.IGNORECASE
        )
        if match:
            street_name = match.group(1).strip()
            if street_name and len(street_name) > 2:
                return f"شارع {street_name}"
        
        # محاولة أخرى: شارع + أي شيء حتى الفاصلة
        match = re.search(r'شارع\s+([^,،]+)', text, re.IGNORECASE)
        if match:
            street_name = match.group(1).strip()
            # تنظيف: إزالة "عمارة" أو "برج" إذا ظهرت في نهاية اسم الشارع
            street_name = re.sub(r'\s+(?:عمارة|برج|رقم|\d).*$', '', street_name).strip()
            if street_name and len(street_name) > 2:
                return f"شارع {street_name}"
        
        # البحث عن "ميدان" + اسم
        match = re.search(r'ميدان\s+([^,،]+?)(?=\s*(?:،|,|$))', text, re.IGNORECASE)
        if match:
            square_name = match.group(1).strip()
            if square_name and len(square_name) > 2:
                return f"ميدان {square_name}"
        
        # البحث عن "طريق" + اسم
        match = re.search(r'طريق\s+([^,،]+?)(?=\s*(?:،|,|$))', text, re.IGNORECASE)
        if match:
            road_name = match.group(1).strip()
            if road_name and len(road_name) > 2:
                return f"طريق {road_name}"
        
        return None
    
    def extract_landmark(self, text: str) -> Optional[str]:
        """استخراج العلامة المميزة (بجوار/أمام/خلف + ما يليها)"""
        if not text:
            return None
        
        # البحث عن بجوار/أمام/خلف + ما يليها حتى الفاصلة أو النهاية
        match = re.search(
            r'(بجوار|أمام|خلف|قبل|بعد)\s+((?:كوبري|جامع|مسجد|كنيسة|مستشفى|مدرسة|سنتر|مول|فندق|بنك|سوق|محطة|كشك|بوفيه|مخبز|مطعم|كافيه|كافتيريا|سوبر|هايبر|محل|معرض|صيدلية|مركز|نادي|حديقة|ميدان|ساحة|كورنيش)?\s*[^,،]+?)(?=\s*(?:،|,|$|عمارة|برج|رقم|\d))',
            text,
            re.IGNORECASE
        )
        if match:
            return f"{match.group(1)} {match.group(2).strip()}"
        
        # محاولة أبسط
        match = re.search(r'(بجوار|أمام|خلف)\s+([^,،]+)', text, re.IGNORECASE)
        if match:
            return f"{match.group(1)} {match.group(2).strip()}"
        
        return None
    
    def extract_building(self, text: str) -> Optional[str]:
        """استخراج رقم العمارة/البرج"""
        if not text:
            return None
        
        # البحث عن عمارة/برج + رقم
        match = re.search(r'(عمارة|برج)\s+(?:رقم\s*)?(\d+)', text, re.IGNORECASE)
        if match:
            return f"{match.group(1)} {match.group(2)}"
        
        # البحث عن رقم العمارة فقط (رقم + حرف اختياري)
        match = re.search(r'عمارة\s+(\d+[أ-يa-zA-Z]?)', text, re.IGNORECASE)
        if match:
            return f"عمارة {match.group(1)}"
        
        # البحث عن "رقم" + رقم
        match = re.search(r'رقم\s+(\d+)', text, re.IGNORECASE)
        if match:
            # نتحقق أن الرقم ليس جزء من شارع
            context = text[max(0, match.start()-10):match.start()]
            if not re.search(r'شارع|ميدان|طريق', context, re.IGNORECASE):
                return f"رقم {match.group(1)}"
        
        return None
    
    def extract_floor(self, text: str) -> Optional[str]:
        """استخراج الطابق/الدور"""
        if not text:
            return None
        
        match = re.search(r'(الدور|دور|طابق)\s*(\d+|الأرضي|الأول|الثاني|الثالث|الرابع|الخامس)', text, re.IGNORECASE)
        if match:
            return f"الدور {match.group(2)}"
        
        return None
    
    # ============================================
    # المرحلة 3: إعادة البناء
    # ============================================
    
    def rebuild_address(self, components: Dict[str, str]) -> str:
        """إعادة بناء العنوان بالترتيب المثالي"""
        parts = []
        
        # 1. المنطقة/الحي
        if components.get('area'):
            parts.append(components['area'])
        
        # 2. الشارع/الميدان/الطريق
        if components.get('street'):
            parts.append(components['street'])
        
        # 3. العلامة المميزة
        if components.get('landmark'):
            parts.append(components['landmark'])
        
        # 4. العمارة/البرج
        if components.get('building'):
            parts.append(components['building'])
        
        # 5. الدور/الطابق (اختياري)
        if components.get('floor'):
            parts.append(components['floor'])
        
        return '، '.join(parts) if parts else ''
    
    # ============================================
    # المرحلة الرئيسية: التنظيف الكامل
    # ============================================
    
    def clean_address(self, address: str, governorate: str = None, city: str = None) -> Tuple[Optional[str], Optional[str]]:
        """
        تنظيف العنوان واستخراج المنطقة
        Returns: (cleaned_address, district)
        """
        if not address or not isinstance(address, str):
            return None, None
        
        # حفظ الأصل للمقارنة
        original = address.strip()
        
        # 1. التنظيف الأولي
        text = self.remove_weird_chars(original)
        text = self.remove_governorates(text, governorate)
        text = self.fix_spelling(text)
        
        # 2. استخراج المكونات
        components = {
            'area': self.extract_area(text, city, governorate),
            'street': self.extract_street(text),
            'landmark': self.extract_landmark(text),
            'building': self.extract_building(text),
            'floor': self.extract_floor(text)
        }
        
        # 3. إعادة البناء
        cleaned = self.rebuild_address(components)
        
        # 4. تنظيف نهائي
        cleaned = self.remove_weird_chars(cleaned)
        cleaned = re.sub(r'^\s*[،,]\s*', '', cleaned)  # إزالة الفاصلة في البداية
        cleaned = re.sub(r'\s*[،,]\s*$', '', cleaned)  # إزالة الفاصلة في النهاية
        cleaned = self.remove_weird_chars(cleaned)
        
        # إذا كان النتيجة فارغة، نرجع الأصل منظفاً قليلاً
        if not cleaned:
            cleaned = self.remove_weird_chars(original)
            cleaned = self.remove_governorates(cleaned, governorate)
            cleaned = self.fix_spelling(cleaned)
        
        district = components.get('area')
        
        return cleaned, district
    
    # ============================================
    # العمليات على قاعدة البيانات
    # ============================================
    
    def fetch_batch(self, offset: int) -> list:
        """جلب دفعة من السجلات"""
        try:
            response = self.supabase.table(TABLE_NAME)\
                .select('id, address, governorate, city, district')\
                .not_.is_('address', 'null')\
                .range(offset, offset + self.batch_size - 1)\
                .execute()
            return response.data or []
        except Exception as e:
            print(f"❌ Error fetching batch: {e}")
            return []
    
    def update_record(self, record_id: int, address: str, district: str) -> bool:
        """تحديث سجل واحد"""
        try:
            update_data = {'address': address}
            if district:
                update_data['district'] = district
            
            self.supabase.table(TABLE_NAME)\
                .update(update_data)\
                .eq('id', record_id)\
                .execute()
            return True
        except Exception as e:
            print(f"❌ Error updating record {record_id}: {e}")
            return False
    
    # ============================================
    # التشغيل الرئيسي
    # ============================================
    
    def run(self, test_mode: bool = False, max_records: int = None):
        """
        التشغيل الرئيسي
        test_mode: True = عرض التغييرات فقط بدون تحديث
        max_records: عدد السجلات الأقصى (للاختبار)
        """
        print("=" * 80)
        print("🚀 منظف العناوين الإصدار 2 - بدء التشغيل")
        print(f"📋 الوضع: {'اختبار (بدون تحديث)' if test_mode else 'تنفيذ فعلي'}")
        print("=" * 80)
        
        offset = 0
        batch_num = 1
        stop_processing = False
        
        while not stop_processing:
            print(f"\n📦 الدفعة #{batch_num} (الإزاحة: {offset})")
            print("-" * 60)
            
            records = self.fetch_batch(offset)
            
            if not records:
                print("✅ لا يوجد المزيد من السجلات")
                break
            
            for record in records:
                if max_records and self.processed >= max_records:
                    print(f"\n⏹️ توقف بعد {max_records} سجل (وضع الاختبار)")
                    stop_processing = True
                    break
                
                record_id = record['id']
                original = record.get('address', '')
                gov = record.get('governorate', '')
                city = record.get('city', '')
                
                # التنظيف
                cleaned, district = self.clean_address(original, gov, city)
                
                if not cleaned:
                    self.skipped += 1
                    continue
                
                # التحقق إذا حدث تغيير
                if cleaned != original or (district and district != record.get('district')):
                    
                    if test_mode:
                        # وضع الاختبار: عرض فقط
                        print(f"\n📝 #{record_id}")
                        print(f"   من: {original[:60]}{'...' if len(original) > 60 else ''}")
                        print(f"   إلى: {cleaned[:60]}{'...' if len(cleaned) > 60 else ''}")
                        if district:
                            print(f"   المنطقة: {district}")
                        self.updated += 1
                    else:
                        # وضع التنفيذ: تحديث قاعدة البيانات
                        success = self.update_record(record_id, cleaned, district)
                        if success:
                            self.updated += 1
                            print(f"✓ #{record_id} - تم التحديث")
                        else:
                            self.errors += 1
                else:
                    self.skipped += 1
                
                self.processed += 1
            
            if not test_mode:
                time.sleep(0.3)  # انتظار بين الدفعات
            
            offset += self.batch_size
            batch_num += 1
            
            # ملخص كل 5 دفعات
            if batch_num % 5 == 0:
                self.print_summary()
        
        self.print_summary(final=True)
    
    def print_summary(self, final: bool = False):
        """طباعة ملخص"""
        title = "📊 الملخص النهائي" if final else "📊 الملخص"
        print(f"\n{'=' * 80}")
        print(title)
        print(f"{'=' * 80}")
        print(f"   إجمالي المعالج:    {self.processed}")
        print(f"   تم التحديث:        {self.updated}")
        print(f"   تم تخطيهم:        {self.skipped}")
        print(f"   الأخطاء:           {self.errors}")
        print(f"{'=' * 80}\n")


# ============================================
# نقطة الدخول
# ============================================
if __name__ == "__main__":
    import sys
    
    # معالجة معاملات سطر الأوامر
    test_mode = '--test' in sys.argv
    max_records = None
    
    for arg in sys.argv:
        if arg.startswith('--max='):
            try:
                max_records = int(arg.split('=')[1])
            except:
                pass
    
    try:
        cleaner = AddressCleanerV2()
        cleaner.run(test_mode=test_mode, max_records=max_records)
    except KeyboardInterrupt:
        print("\n\n⚠️ تم الإيقاف من قبل المستخدم")
    except Exception as e:
        print(f"\n❌ خطأ فادح: {e}")
        import traceback
        traceback.print_exc()
