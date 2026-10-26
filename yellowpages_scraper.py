#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
سكريبت سحب بيانات الصيدليات من Yellow Pages Egypt
متوافق مع مشروع "سلامتك" - يدعم الصيادلة الأحرار المستقلين
"""

import asyncio
import hashlib
import random
import time
from playwright.async_api import async_playwright
from supabase import create_client

# ============================================
# إعدادات Supabase لمشروع سلامتك
# ============================================

SUPA_URL = "https://iksjhjxwphmvthryfeae.supabase.co"
# استخدام Service Role Key للكتابة (bypass RLS)
SUPA_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imlrc2poanh3cGhtdnRocnlmZWFlIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MDA3NTUzNiwiZXhwIjoyMDg1NjUxNTM2fQ.IQ4KfNGAa8mLk_SYRv5nqXaquUtsxCiYdm2WClH4A0Q"

supabase = create_client(SUPA_URL, SUPA_KEY)

# ============================================
# قائمة السلاسل المستبعدة (نفس القائمة السابقة)
# ============================================

CHAIN_BLACKLIST = [
    'العزبي', 'العزابي', 'ezaby', 'el-ezaby',
    'سيف', 'seif', 'saif',
    'رشدي', 'روشدي', 'roushdy', 'roshdy', 'رشدى',
    '19011', '١٩٠١١',
    'علي وعلي', 'ali & ali', 'ali and ali', 'على وعلى',
    'دلمار', 'delmar',
    'عطا الله', 'attallah', 'ataallah', 'عطالله',
    'تامر', 'tamer',
    'علام', 'allam',
    'أبو علي', 'abu ali',
    'الشارقة', 'sharjah',
    'وايتس', 'whites',
    'دوائي', 'daway',
    'شفاء', 'shefaa', 'shifa',
    'صورتص', 'soratac',
    'أوسكار', 'oscar',
    'طيبة', 'taiba', 'tayba',
    'مصر', 'masr', 'misr', 'egypt pharma',
    'صيدليات شاكر', 'shaker',
    'صيدلية المدينة', 'el-madina',
    'خليل', 'khalil',
    'الدواء', 'eldawa',
]

# ============================================
# خريطة تحويل أسماء المحافظات
# ============================================

GOV_MAP = {
    'Qalyubia': 'القليوبية',
    'Cairo': 'القاهرة',
    'Giza': 'الجيزة',
    'Alexandria': 'الإسكندرية',
    'Dakahlia': 'الدقهلية',
    'Sharqia': 'الشرقية',
    'Monufia': 'المنوفية',
    'Beheira': 'البحيرة',
    'Gharbia': 'الغربية',
    'Fayoum': 'الفيوم',
    'Suez': 'السويس',
    'Port-Said': 'بورسعيد',
    'Ismailia': 'الإسماعيلية',
    'Damietta': 'دمياط',
    'Kafr-El-Sheikh': 'كفر الشيخ',
    'Beni-Suef': 'بني سويف',
    'Minya': 'المنيا',
    'Asyut': 'أسيوط',
    'Sohag': 'سوهاج',
    'Qena': 'قنا',
    'Luxor': 'الأقصر',
    'Aswan': 'أسوان',
    'Red-Sea': 'البحر الأحمر',
    'New-Valley': 'الوادي الجديد',
}

def is_chain_pharmacy(name: str) -> bool:
    """التحقق إذا كانت الصيدلية تابعة لسلسلة"""
    if not name:
        return True
    name_lower = name.lower()
    for chain in CHAIN_BLACKLIST:
        if chain.lower() in name_lower:
            return True
    return False

def extract_city_district(address: str, governorate: str) -> tuple:
    """استخراج المدينة والحي من العنوان"""
    # قائمة المدن المعروفة
    cities = [
        'مدينة نصر', 'المعادي', 'مصر الجديدة', 'حلوان', 'شبرا', 'الزيتون', 'المرج',
        'عين شمس', 'الوايلي', 'السيدة زينب', 'الخليفة', 'الموسكي', 'باب الشعرية',
        'الأزبكية', 'بولاق', 'الزاوية', 'الحضرة', 'المنتزة', 'الدرب الأحمر',
        'القبة', 'منشية ناصر', 'الساحل', 'الشرابية', 'روض الفرج', 'الشروق',
        'الرحاب', 'مدينتي', 'التجمع', 'التجمع الخامس', 'القاهرة الجديدة', 'بدر',
        '15 مايو', 'المنيل', 'مصر القديمة', 'سور مجرى العيون', 'الفسطاط',
        'المقطم', 'التحرير', 'وسط البلد', 'العباسية', 'الهايكستب', 'مدينة السلام',
        'حدائق القبة', 'الدقي', 'المهندسين', 'العجوزة', 'الهرم', 'فيصل',
        'العمرانية', 'الطالبية', 'الوارق', 'إمبابة', 'المنيب', 'بشتيل',
        'الوراق', 'كرداسة', 'أبو النمرس', 'الحوامدية', 'البدرشين', 'الصف',
        'أطفيح', '6 أكتوبر', 'الشيخ زايد', 'أكتوبر', 'سموحة', 'محرم بك',
        'سيدي جابر', 'العجمي', 'السيوف', 'الدخيلة', 'العصافرة', 'الأنفوشي',
        'المنشية', 'بحري', 'ستانلي', 'رشدي', 'جليم', 'باكوس', 'زيزينيا',
        'كفر عبده', 'سابا باشا', 'الشاطبي', 'العطارين', 'باب شرق', 'الجمرك',
        'المكس', 'بنها', 'الخصوص', 'شبرا الخيمة', 'قها', 'القناطر الخيرية',
        'طوخ', 'كفر شكر', 'العبور', 'قليوب', 'الخانكة', 'أبو زعبل',
        'شبين القناطر', 'المنصورة', 'طلخا', 'ميت غمر', 'السنبلاوين',
        'أجا', 'منية النصر', 'دكرنس', 'بلقاس', 'شربين', 'منية سمنود',
        'المنزلة', 'تمي الأمديد', 'المطرية', 'نبروه', 'جمصة', 'الكردي',
        'الزقازيق', 'العاشر من رمضان', 'بلبيس', 'منيا القمح', 'أبو حماد',
        'أبو كبير', 'الحسينية', 'الإبراهيمية', 'فاقوس', 'الصالحية',
        'كفر صقر', 'أولاد صقر', 'القرين', 'مشتول السوق', 'ديرب نجم',
        'شبين الكوم', 'منوف', 'قويسنا', 'أشمون', 'الباجور', 'تلا',
        'بركة السبع', 'السادات', 'سرس الليان', 'الشهداء', 'طنطا',
        'المحلة الكبرى', 'كفر الزيات', 'زفتى', 'السنطة', 'قطور', 'بسيون',
        'دمنهور', 'كفر الدوار', 'إيتاي البارود', 'أبو المطامير',
        'أبو حمص', 'الدلنجات', 'المحمودية', 'الرحمانية', 'حوش عيسى',
        'شبراخيت', 'كوم حمادة', 'دسوق', 'فوة', 'مطوبس', 'البرلس',
        'الحامول', 'بيلا', 'الرياض', 'سيدي سالم', 'مصيف بلطيم',
        'دمياط الجديدة', 'رأس البر', 'فارسكور', 'الزرقا', 'كفر سعد',
        'كفر البطيخ', 'عزبة البرج', 'السرو', 'الروضة', 'بور فؤاد',
        'الزهور', 'الشرق', 'الغرب', 'الجنوب', 'المناخ', 'الضواحي',
        'الحضارة', 'فايد', 'القنطرة شرق', 'القنطرة غرب', 'التل الكبير',
        'أبو صوير', 'القصاصين', 'الأربعين', 'الجناين', 'عتاقة',
        'الصليبة', 'سنورس', 'إطسا', 'أبشواي', 'طامية', 'يوسف الصديق',
        'الواسطى', 'ناصر', 'ببا', 'الفشن', 'إهناسيا', 'سمسطا',
        'ملوي', 'سمالوط', 'بني مزار', 'مطاي', 'أبو قرقاص', 'العدوة',
        'دير مواس', 'مغاغة', 'ديروط', 'منفلوط', 'القوصية', 'أبنوب',
        'أبو تيج', 'الغنايم', 'البداري', 'صدفا', 'ساحل سليم',
        'أخميم', 'البلينا', 'جرجا', 'دار السلام', 'جهينة',
        'ساقلتة', 'طما', 'طهطا', 'المنشأة', 'المراغة', 'العسيرات',
        'قوص', 'نجع حمادي', 'دشنا', 'أبو تشت', 'فرشوط', 'الوقف',
        'قفط', 'نقادة', 'القرنة', 'أرمنت', 'الطود', 'إسنا',
        'الزينية', 'البياضية', 'دراو', 'كوم أمبو', 'إدفو',
        'نصر النوبة', 'أبو سمبل', 'الصباعية', 'الشعيب', 'الغردقة',
        'سفاجا', 'القصير', 'رأس غارب', 'شلاتين', 'حلايب',
        'مرسى علم', 'الجونة', 'الخارجة', 'الداخلة', 'الفرافرة',
        'باريس', 'بلاط', 'موط', 'الشرف', 'مرسى مطروح', 'الحمام',
        'العلمين', 'الضبعة', 'سيوة', 'السلوم', 'سيدي براني',
        'النجيلة', 'العريش', 'رفح', 'الشيخ زويد', 'بئر العبد',
        'نخل', 'الحسنة', 'شرم الشيخ', 'دهب', 'نويبع', 'الطور',
        'سانت كاترين', 'أبو رديس', 'رأس سدر',
    ]

    # البحث عن المدينة في العنوان
    for city in cities:
        if city in address:
            return city, f"حي {city}"

    return governorate, "حي عام"

# ============================================
# الكلاس الرئيسي للـ Scraping
# ============================================

class YellowPagesScraper:
    def __init__(self):
        self.governorates = [
            'Cairo', 'Giza', 'Alexandria', 'Qalyubia', 'Dakahlia',
            'Sharqia', 'Monufia', 'Beheira', 'Gharbia', 'Fayoum',
            'Suez', 'Port-Said', 'Ismailia', 'Damietta', 'Kafr-El-Sheikh',
            'Beni-Suef', 'Minya', 'Asyut', 'Sohag', 'Qena',
            'Luxor', 'Aswan', 'Red-Sea', 'New-Valley'
        ]
        self.semaphore = asyncio.Semaphore(5)  # 5 متصفحات متوازية فقط

    async def scrape_governorate(self, gov: str):
        """سحب بيانات محافظة واحدة"""
        async with self.semaphore:
            async with async_playwright() as p:
                browser = await p.chromium.launch(headless=True)
                context = await browser.new_context(
                    user_agent=f"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/{random.randint(124,132)}.0.0.0 Safari/537.36",
                    viewport={'width': 1920, 'height': 1080}
                )
                page = await context.new_page()

                arabic_gov = GOV_MAP.get(gov, gov)
                print(f"🔍 جاري البحث في: {arabic_gov}")

                all_pharmacies = []
                max_pages = 100  # حد أقصى 100 صفحة لكل محافظة

                for page_num in range(1, max_pages + 1):
                    url = f"https://www.yellowpages.com.eg/ar/category/صيدليات/{gov}/p{page_num}"

                    try:
                        await page.goto(url, wait_until="domcontentloaded", timeout=30000)

                        # انتظار تحميل العناصر
                        await page.wait_for_selector('.item-details', timeout=10000)
                        items = await page.query_selector_all('.item-details')

                        if not items:
                            print(f"   ✅ {arabic_gov}: انتهى عند الصفحة {page_num}")
                            break

                        page_batch = []
                        for item in items:
                            try:
                                # استخراج الاسم
                                name_elem = await item.query_selector('h2')
                                name = (await name_elem.inner_text()).strip() if name_elem else ""

                                # تخطي السلاسل
                                if is_chain_pharmacy(name):
                                    continue

                                # استخراج العنوان
                                addr_elem = await item.query_selector('.address')
                                address = (await addr_elem.inner_text()).strip() if addr_elem else ""

                                # استخراج المدينة والحي
                                city, district = extract_city_district(address, arabic_gov)

                                page_batch.append({
                                    "name": name,
                                    "address": address,
                                    "governorate": arabic_gov,
                                    "city": city,
                                    "district": district,
                                })
                            except Exception:
                                continue

                        if page_batch:
                            all_pharmacies.extend(page_batch)
                            print(f"   📄 صفحة {page_num}: +{len(page_batch)} صيدلية")

                        # تأخير عشوائي بين الصفحات (2-4 ثواني)
                        await asyncio.sleep(random.uniform(2, 4))

                    except Exception as e:
                        print(f"   ⚠️ خطأ في صفحة {page_num}: {str(e)[:50]}")
                        continue

                await browser.close()

                # رفع البيانات لـ Supabase
                if all_pharmacies:
                    await self.upload_batch(all_pharmacies, arabic_gov)

                return len(all_pharmacies)

    async def upload_batch(self, pharmacies: list, gov_name: str):
        """رفع دفعة للـ Supabase"""
        try:
            # رفع على دفعات صغيرة (100 في المرة)
            batch_size = 100
            for i in range(0, len(pharmacies), batch_size):
                batch = pharmacies[i:i + batch_size]
                supabase.table('egypt_pharmacies_static').upsert(batch).execute()
                await asyncio.sleep(0.5)

            print(f"   ☁️ تم رفع {len(pharmacies)} صيدلية لـ {gov_name}")
        except Exception as e:
            print(f"   ❌ خطأ في الرفع: {str(e)[:100]}")

    async def run(self):
        """تشغيل السكريبت"""
        print("=" * 60)
        print("🏗️ سكريبت سحب بيانات Yellow Pages - مشروع سلامتك")
        print("=" * 60)
        print(f"📊 عدد المحافظات: {len(self.governorates)}")
        print(f"⚡ المتصفحات المتزامنة: 5")
        print("=" * 60)

        start_time = time.time()
        total = 0

        # تشغيل كل المحافظات
        tasks = [self.scrape_governorate(gov) for gov in self.governorates]
        results = await asyncio.gather(*tasks, return_exceptions=True)

        for result in results:
            if isinstance(result, int):
                total += result

        duration = round(time.time() - start_time, 2)
        print("=" * 60)
        print(f"✅ تم الانتهاء!")
        print(f"📊 إجمالي الصيدليات: {total}")
        print(f"⏱️ الوقت المستغرق: {duration} ثانية")
        print("=" * 60)

# ============================================
# التشغيل
# ============================================

if __name__ == "__main__":
    scraper = YellowPagesScraper()
    asyncio.run(scraper.run())
