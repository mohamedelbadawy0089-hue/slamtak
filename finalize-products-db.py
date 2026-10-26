# -*- coding: utf-8 -*-
"""Create final products database with all 1662 drugs"""
import json
from collections import Counter
from datetime import datetime

# Load expanded database
with open('data/egyptian-drugs-gtin-expanded.json', 'r', encoding='utf-8') as f:
    data = json.load(f)

drugs = data['drugs']

# Create comprehensive final database
final_db = {
    "database_name": "Egyptian Drug Database with GTIN - Complete",
    "version": "2024.2",
    "total_drugs": len(drugs),
    "unique_trade_names": len(set(d['tradeName'] for d in drugs)),
    "companies": len(set(d['company'] for d in drugs)),
    "forms": len(set(d['form'] for d in drugs)),
    "source": "Egyptian pharmaceutical market",
    "last_updated": datetime.now().strftime("%Y-%m-%d"),
    "description": "Comprehensive Egyptian drug database with GTIN barcodes, concentrations, forms, companies, and prices",
    "drugs": drugs
}

# Save as main products file
with open('data/products-egyptian-drugs-gtin.json', 'w', encoding='utf-8') as f:
    json.dump(final_db, f, ensure_ascii=False, indent=2)

# Also copy to the main gtin file
with open('data/egyptian-drugs-gtin.json', 'w', encoding='utf-8') as f:
    json.dump(final_db, f, ensure_ascii=False, indent=2)

# Statistics
companies = Counter(d['company'] for d in drugs)
forms = Counter(d['form'] for d in drugs)
prices = [d['price'] for d in drugs]

print("=" * 70)
print("✅ تم إنشاء قاعدة بيانات الأدوية المصرية النهائية!")
print("=" * 70)
print(f"\n📊 الإحصائيات:")
print(f"   إجمالي الأدوية: {len(drugs)}")
print(f"   الأسماء التجارية: {len(set(d['tradeName'] for d in drugs))}")
print(f"   الشركات: {len(set(d['company'] for d in drugs))}")
print(f"   أشكال الدواء: {len(set(d['form'] for d in drugs))}")
print(f"\n🏢 أكبر 10 شركات:")
for i, (company, count) in enumerate(companies.most_common(10), 1):
    print(f"   {i}. {company}: {count} منتج")
print(f"\n💊 أكثر أشكال الدواء:")
for form, count in forms.most_common(8):
    print(f"   {form}: {count}")
print(f"\n💰 نطاق الأسعار:")
print(f"   الأقل: {min(prices):.2f} جنيه")
print(f"   الأعلى: {max(prices):.2f} جنيه")
print(f"   المتوسط: {sum(prices)/len(prices):.2f} جنيه")
print(f"\n📁 الملفات:")
print(f"   - data/products-egyptian-drugs-gtin.json")
print(f"   - data/egyptian-drugs-gtin.json")
print("=" * 70)
