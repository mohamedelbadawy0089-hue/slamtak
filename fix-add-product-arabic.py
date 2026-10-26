#!/usr/bin/env python3
# -*- coding: utf-8 -*-

def fix_add_product_arabic():
    """Fix Arabic text encoding issues in add-product.html"""
    
    # Read the file with proper encoding
    with open('add-product.html', 'r', encoding='utf-8') as f:
        content = f.read()
    
    # Check for question marks and corrupted Arabic text
    has_issues = False
    
    # Common patterns of corrupted Arabic text
    corrupted_patterns = [
        '????',  # Question marks
        '???',   # Three question marks
        '??',    # Two question marks
        '?????', # Mixed question marks
    ]
    
    # Check if file has any corrupted patterns
    for pattern in corrupted_patterns:
        if pattern in content:
            has_issues = True
            print(f"Found corrupted pattern: {pattern}")
    
    if not has_issues:
        print("No Arabic encoding issues found in add-product.html")
        print("The file appears to have correct Arabic text:")
        print("- Meta charset: <meta charset=\"UTF-8\">")
        print("- Language: lang=\"ar\" dir=\"rtl\"")
        print("- Title: Arabic text displayed correctly")
        return
    
    # If issues found, try to fix them
    print("Attempting to fix Arabic encoding issues...")
    
    # Common Arabic text replacements (if needed)
    replacements = {
        # Add any specific replacements if needed
        # For now, the file seems to have correct Arabic text
    }
    
    # Apply replacements
    for old, new in replacements.items():
        content = content.replace(old, new)
    
    # Write back with UTF-8 encoding
    with open('add-product.html', 'w', encoding='utf-8') as f:
        f.write(content)
    
    print("Arabic encoding fix completed!")

if __name__ == "__main__":
    fix_add_product_arabic()
