#!/usr/bin/env python3
# -*- coding: utf-8 -*-

def fix_remaining_arabic():
    """Fix remaining corrupted Arabic text in products.html"""
    
    # Read the file with proper encoding
    with open('products.html', 'r', encoding='utf-8') as f:
        content = f.read()
    
    # Fix the remaining corrupted table headers
    replacements = {
        '?????': '?????',
        '????': '????',
        '??????': '??????',
        '??????': '??????',
        '??????': '??????',
    }
    
    # Apply replacements
    for old, new in replacements.items():
        content = content.replace(old, new)
    
    # Write back with UTF-8 BOM
    with open('products.html', 'w', encoding='utf-8-sig') as f:
        f.write(content)
    
    print("Fixed remaining Arabic text in products.html")
    print("Saved with UTF-8 BOM encoding")

if __name__ == "__main__":
    fix_remaining_arabic()
