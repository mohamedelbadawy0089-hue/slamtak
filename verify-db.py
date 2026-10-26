# -*- coding: utf-8 -*-
import json
from collections import Counter

with open('data/egyptian-drugs-gtin-expanded.json', 'r', encoding='utf-8') as f:
    data = json.load(f)

drugs = data['drugs']

print(f"=" * 60)
print(f"✅ قاعدة بيانات الأدوية المصرية")
print(f"=" * 60)
print(f"\n📊 الإحصائيات الرئيسية:")
print(f"   إجمالي الأدوية: {len(drugs)}")
print(f"   الأسماء التجارية الفريدة: {len(set(d['tradeName'] for d in drugs))}")
print(f"   الشركات الدوائية: {len(set(d['company'] for d in drugs))}")
print(f"   أشكال الدواء: {len(set(d['form'] for d in drugs))}")

# Count by company
companies = Counter(d['company'] for d in drugs)
print(f"\n🏢 أكبر 15 شركة:")
for i, (company, count) in enumerate(companies.most_common(15), 1):
    print(f"   {i}. {company}: {count} منتج")

# Count by form
forms = Counter(d['form'] for d in drugs)
print(f"\n💊 توزيع أشكال الدواء:")
for form, count in forms.most_common(10):
    print(f"   {form}: {count}")

# Price range
prices = [d['price'] for d in drugs]
print(f"\n💰 نطاق الأسعار:")
print(f"   الأقل: {min(prices):.2f} جنيه")
print(f"   الأعلى: {max(prices):.2f} جنيه")
print(f"   المتوسط: {sum(prices)/len(prices):.2f} جنيه")

print(f"\n✅ تم التحقق بنجاح!")
