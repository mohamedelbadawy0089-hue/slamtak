import re

filepath = r'C:\Users\My PC\Desktop\slamtak\register-warehouse.min.js'
with open(filepath, 'r', encoding='utf-8') as f:
    content = f.read()

target = r"localStorage.setItem('slamtak-auth-token', JSON.stringify({access_token: session.access_token,refresh_token: session.refresh_token,expires_at: session.expires_at}));"
replacement = r"localStorage.setItem('slamtak-auth-token', JSON.stringify(session));"

if target in content:
    content = content.replace(target, replacement)
    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(content)
    print('Updated register-warehouse.min.js')
else:
    print('Target not found in register-warehouse.min.js')
