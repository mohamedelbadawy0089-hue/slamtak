#!/usr/bin/env python3
# -*- coding: utf-8 -*-

def fix_arabic_ultimate():
    """Ultimate fix for Arabic encoding - create fresh HTML section"""
    
    # Read the file
    with open('products.html', 'r', encoding='utf-8') as file:
        lines = file.readlines()
    
    # Find the stats section and replace it completely
    start_line = None
    end_line = None
    
    for i, line in enumerate(lines):
        if '<div class="stats">' in line:
            start_line = i
        elif start_line is not None and '</div>' in line and 'actions' in lines[i+1] if i+1 < len(lines) else False:
            end_line = i
            break
    
    if start_line is not None and end_line is not None:
        # Create new stats section with proper Arabic
        new_stats_lines = [
            '        <div class="stats">\n',
            '            <div class="stat-card total" onclick="loadStats()" style="cursor: pointer;" title="???? ??? ????? ???????">\n',
            '                <div class="stat-number" id="totalCount">\n',
            '                    <span class="click-to-load">???? ??? ?????</span>\n',
            '                    <span class="loading-spinner" style="display: none;">...</span>\n',
            '                </div>\n',
            '                <div class="stat-label">??? ??????</div>\n',
            '            </div>\n',
            '            <div class="stat-card unlimited" onclick="loadStats()" style="cursor: pointer;" title="???? ??? ????? ???????">\n',
            '                <div class="stat-number" id="unlimitedCount">\n',
            '                    <span class="click-to-load">???? ??? ?????</span>\n',
            '                    <span class="loading-spinner" style="display: none;">...</span>\n',
            '                </div>\n',
            '                <div class="stat-label">????? ??????</div>\n',
            '            </div>\n',
            '            <div class="stat-card limited" onclick="window.location.replace(\'limited-products.html\')" style="cursor: pointer;" title="???? ??? ???????">\n',
            '                <div class="stat-number" id="limitedCount">\n',
            '                    <span class="click-to-load">???? ??? ?????</span>\n',
            '                    <span class="loading-spinner" style="display: none;">...</span>\n',
            '                </div>\n',
            '                <div class="stat-label">???? ???????</div>\n',
            '            </div>\n',
            '            <div class="stat-card expiring" onclick="window.location.replace(\'expiring-products.html\')" style="cursor: pointer;" title="???? ??? ???????">\n',
            '                <div class="stat-number" id="expiringCount">\n',
            '                    <span class="click-to-load">???? ??? ?????</span>\n',
            '                    <span class="loading-spinner" style="display: none;">...</span>\n',
            '                </div>\n',
            '                <div class="stat-label">??? ????? ????????</div>\n',
            '            </div>\n',
            '        </div>\n',
            '\n'
        ]
        
        # Replace the lines
        lines[start_line:end_line+1] = new_stats_lines
        
        # Write back to file
        with open('products.html', 'w', encoding='utf-8') as file:
            file.writelines(lines)
        
        print(f"Replaced lines {start_line} to {end_line} with fresh Arabic content")
    else:
        print("Could not find stats section boundaries")
    
    print("Ultimate Arabic encoding fix completed")

if __name__ == "__main__":
    fix_arabic_ultimate()
