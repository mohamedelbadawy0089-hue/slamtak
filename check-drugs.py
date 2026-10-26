# -*- coding: utf-8 -*-
import json

with open('data/egyptian-drugs-gtin-expanded.json', 'r', encoding='utf-8') as f:
    data = json.load(f)

print(f"Total drugs: {len(data['drugs'])}")
print("\nFirst 3:")
for d in data['drugs'][:3]:
    print(f"  - {d['tradeName']} ({d['gtin']})")
print("\nLast 3:")
for d in data['drugs'][-3:]:
    print(f"  - {d['tradeName']} ({d['gtin']})")
