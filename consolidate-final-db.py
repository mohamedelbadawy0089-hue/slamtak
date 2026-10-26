# -*- coding: utf-8 -*-
"""Consolidate and create final Egyptian drug database with GTIN"""
import json
from collections import Counter

# Load expanded database
with open('data/egyptian-drugs-gtin-expanded.json', 'r', encoding='utf-8') as f:
    data = json.load(f)

drugs = data['drugs']

# Create final consolidated database
final_db = {
    "database_name": "Egyptian Drug Database with GTIN",
    "version": "2024.1",
    "total_drugs": len(drugs),
    "source": "Egyptian pharmaceutical market",
    "last_updated": "2024",
    "drugs": drugs
}

# Save as main products file
with open('data/products-egyptian-drugs-gtin.json', 'w', encoding='utf-8') as f:
    json.dump(final_db, f, ensure_ascii=False, indent=2)

# Also copy to the main gtin file for backward compatibility
with open('data/egyptian-drugs-gtin.json', 'w', encoding='utf-8') as f:
    json.dump(final_db, f, ensure_ascii=False, indent=2)

# Count unique trade names and companies
trade_names = Counter(d['tradeName'] for d in drugs)
companies = Counter(d['company'] for d in drugs)
forms = Counter(d['form'] for d in drugs)

print(f"✅ FINAL DATABASE CREATED: {len(drugs)} drugs")
print(f"\n📊 Summary:")
print(f"   - Unique trade names: {len(trade_names)}")
print(f"   - Pharmaceutical companies: {len(companies)}")
print(f"   - Dosage forms: {len(forms)}")
print(f"\n🏢 Top 10 Companies:")
for company, count in companies.most_common(10):
    print(f"   {company}: {count} products")
print(f"\n💊 Top Dosage Forms:")
for form, count in forms.most_common():
    print(f"   {form}: {count}")
print(f"\n💰 Price Range:")
prices = [d['price'] for d in drugs]
print(f"   Min: {min(prices):.2f} EGP")
print(f"   Max: {max(prices):.2f} EGP")
print(f"   Average: {sum(prices)/len(prices):.2f} EGP")
print(f"\n✅ Files saved:")
print(f"   - data/products-egyptian-drugs-gtin.json (MAIN)")
print(f"   - data/egyptian-drugs-gtin.json (BACKUP)")
