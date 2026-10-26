#!/usr/bin/env python3
# -*- coding: utf-8 -*-

def save_with_bom():
    """Save products.html with UTF-8 BOM to ensure Arabic text is preserved"""
    
    # Read the current file
    with open('products.html', 'r', encoding='utf-8') as f:
        content = f.read()
    
    # Add UTF-8 BOM and save
    with open('products.html', 'w', encoding='utf-8-sig') as f:
        f.write(content)
    
    print("✅ File saved with UTF-8 BOM successfully!")
    print("📄 products.html now has proper UTF-8 BOM encoding")
    print("🔒 Arabic text is now protected from corruption")

if __name__ == "__main__":
    save_with_bom()
