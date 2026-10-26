#!/usr/bin/env python3
# -*- coding: utf-8 -*-

def restore_products_html():
    """Restore products.html from backup with proper encoding"""
    
    # Read the backup file
    with open('products-backup.html', 'r', encoding='utf-8') as file:
        content = file.read()
    
    # Fix only the stats section with proper Arabic
    stats_section = '''        <div class="stats">
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
    
    # Find the stats section and replace it
    import re
    pattern = r'<div class="stats">.*?</div>\s*</div>\s*<div class="actions">'
    match = re.search(pattern, content, re.DOTALL)
    
    if match:
        old_section = match.group(0)
        new_section = stats_section + '\n\n        <div class="actions">'
        content = content.replace(old_section, new_section)
        print("Stats section replaced successfully")
    else:
        print("Could not find stats section, trying manual replacement...")
        # Manual replacement of common issues
        content = content.replace('<span class="click-to-load">?</span>', '<span class="click-to-load">???? ??? ?????</span>')
        content = content.replace('<span class="click-to-load">???? ??? ?????</span>', '<span class="click-to-load">???? ??? ?????</span>')
        content = content.replace('<div class="stat-label">? ?</div>', '<div class="stat-label">??? ??????</div>')
        content = content.replace('<div class="stat-label">? ? ?</div>', '<div class="stat-label">????? ??????</div>')
        content = content.replace('<div class="stat-label">? ? ? ?</div>', '<div class="stat-label">??? ????? ????????</div>')
    
    # Write the restored content
    with open('products.html', 'w', encoding='utf-8') as file:
        file.write(content)
    
    print("Products.html restored from backup with proper Arabic encoding")

if __name__ == "__main__":
    restore_products_html()
