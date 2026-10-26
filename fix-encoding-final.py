#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import re
import os

def fix_arabic_encoding_final():
    """Final fix for Arabic encoding issues in products.html"""
    
    # Read the file with UTF-8 encoding
    with open('products.html', 'r', encoding='utf-8') as file:
        content = file.read()
    
    print("Original content sample:")
    print(content[270:300])
    print("\n" + "="*50 + "\n")
    
    # Create a completely new stats section with proper Arabic
    new_stats_section = '''        <div class="stats">
            <div class="stat-card total" onclick="loadStats()" style="cursor: pointer;" title="???? ??? ????? ???????">
                <div class="stat-number" id="totalCount">
                    <span class="click-to-load">???? ??? ?????</span>
                    <span class="loading-spinner" style="display: none;">...</span>
                </div>
                <div class="stat-label">??? ??????</div>
            </div>
            <div class="stat-card unlimited" onclick="loadStats()" style="cursor: pointer;" title="???? ??? ????? ???????">
                <div class="stat-number" id="unlimitedCount">
                    <span class="click-to-load">???? ??? ?????</span>
                    <span class="loading-spinner" style="display: none;">...</span>
                </div>
                <div class="stat-label">????? ??????</div>
            </div>
            <div class="stat-card limited" onclick="window.location.replace('limited-products.html')" style="cursor: pointer;" title="???? ??? ???????">
                <div class="stat-number" id="limitedCount">
                    <span class="click-to-load">???? ??? ?????</span>
                    <span class="loading-spinner" style="display: none;">...</span>
                </div>
                <div class="stat-label">???? ???????</div>
            </div>
            <div class="stat-card expiring" onclick="window.location.replace('expiring-products.html')" style="cursor: pointer;" title="???? ??? ???????">
                <div class="stat-number" id="expiringCount">
                    <span class="click-to-load">???? ??? ?????</span>
                    <span class="loading-spinner" style="display: none;">...</span>
                </div>
                <div class="stat-label">??? ????? ????????</div>
            </div>
        </div>'''
    
    # Find and replace the entire stats section
    stats_pattern = r'<div class="stats">.*?</div>\s*</div>\s*<div class="actions">'
    
    # Use DOTALL flag to match across newlines
    match = re.search(stats_pattern, content, re.DOTALL)
    
    if match:
        print("Found stats section, replacing...")
        old_section = match.group(0)
        # Keep the closing div and actions div start
        new_section = new_stats_section + '\n\n        <div class="actions">'
        content = content.replace(old_section, new_section)
        print("Stats section replaced successfully")
    else:
        print("Could not find stats section pattern")
        # Try alternative approach - replace specific parts
        content = content.replace('<span class="click-to-load">???? ??? ?????</span>', '<span class="click-to-load">???? ??? ?????</span>')
        content = content.replace('<span class="click-to-load">?</span>', '<span class="click-to-load">???? ??? ?????</span>')
        content = content.replace('<div class="stat-label">? ?</div>', '<div class="stat-label">??? ??????</div>')
        content = content.replace('<div class="stat-label">? ? ?</div>', '<div class="stat-label">????? ??????</div>')
        content = content.replace('<div class="stat-label">? ? ? ?</div>', '<div class="stat-label">??? ????? ????????</div>')
    
    # Write back with UTF-8 encoding
    with open('products.html', 'w', encoding='utf-8') as file:
        file.write(content)
    
    print("Fixed Arabic encoding issues in products.html")
    
    # Verify the fix
    with open('products.html', 'r', encoding='utf-8') as file:
        updated_content = file.read()
    
    print("\nUpdated content sample:")
    print(updated_content[270:300])

if __name__ == "__main__":
    fix_arabic_encoding_final()
