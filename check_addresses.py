#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
عرض أمثلة حقيقية من عناوين الصيدليات لفهم المشكلة
"""

from supabase import create_client, Client

SUPABASE_URL = "https://iksjhjxwphmvthryfeae.supabase.co"
SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imlrc2poanh3cGhtdnRocnlmZWFlIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MDA3NTUzNiwiZXhwIjoyMDg1NjUxNTM2fQ.IQ4KfNGAa8mLk_SYRv5nqXquUtsxCiYdm2WClH4A0Q"
TABLE_NAME = "egypt_pharmacies_static"

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

print("=" * 80)
print("📋 عرض أمثلة حقيقية من عناوين الصيدليات")
print("=" * 80)

# جلب 20 عنوان عشوائي
response = supabase.table(TABLE_NAME)\
    .select('id, name, address, governorate, city, district')\
    .limit(20)\
    .execute()

if response.data:
    print("\n🔍 عينة من البيانات الحالية:\n")
    for i, record in enumerate(response.data, 1):
        print(f"{i}. #{record['id']}")
        print(f"   الصيدلية: {record.get('name', 'غير معروف')}")
        print(f"   المحافظة: {record.get('governorate', '-')}")
        print(f"   المدينة: {record.get('city', '-')}")
        print(f"   المنطقة: {record.get('district', '-')}")
        print(f"   📍 العنوان: {record.get('address', 'غير موجود')}")
        print("-" * 70)
else:
    print("❌ لم يتم العثور على بيانات")
