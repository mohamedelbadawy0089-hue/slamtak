#!/usr/bin/env python3
# -*- coding: utf-8 -*-

def manual_fix():
    """Manual fix for Arabic encoding issues"""
    
    # Read the file
    with open('products.html', 'r', encoding='utf-8') as f:
        content = f.read()
    
    # Manual fixes for each specific corrupted text
    content = content.replace('Ø§Ø¶ØºØ· ÙÙØØ¯ÙØ« Ø§ÙØ¥Ø¬Ù Ø§ÙÙ', '????? ???????')
    content = content.replace('Ø¥Ø¬Ù Ø§ÙÙÙØªØ¬Ø§Øª', '????? ???????')
    content = content.replace('Ø§ÙÙÙØªØ¬Ø§Øª ØºÙØ± ÙØØ¯ÙØ¯Ø©', '????? ??????')
    content = content.replace('Ø§ÙÙÙØªØ¬Ø§Øª Ø§ÙÙØØ¯ÙØ¯Ø©', '????? ???????')
    content = content.replace('Ø§ÙÙÙØªØ¬Ø§Øª ÙÙØªÙÙØ© Ø§ÙØµÙØ§ØÙÙØ©', '????? ??????')
    
    # Fix the click-to-load text
    content = content.replace('????? ??????', '????? ??????')
    
    # Write back
    with open('products.html', 'w', encoding='utf-8') as f:
        f.write(content)
    
    print("Manual Arabic fix completed!")

if __name__ == "__main__":
    manual_fix()
