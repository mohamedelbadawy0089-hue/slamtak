import re

filepath = r'C:\Users\My PC\Desktop\slamtak\register-warehouse.min.js'
with open(filepath, 'r', encoding='utf-8') as f:
    content = f.read()

target = r"localStorage.setItem('warehouseData',JSON.stringify({...formData,user_id:authData.user.id}));"
replacement = target + r"localStorage.setItem('slamtak-user-id', authData.user.id);localStorage.setItem('slamtak-user-email', formData.email);localStorage.setItem('slamtak-auth-status', 'authenticated');localStorage.setItem('current_warehouse_id', authData.user.id);localStorage.setItem('slamtak-warehouse-id', authData.user.id);localStorage.setItem('localAuth', 'true');if (authData.session) {const session = authData.session;localStorage.setItem('slamtak-auth-token', JSON.stringify({access_token: session.access_token,refresh_token: session.refresh_token,expires_at: session.expires_at}));localStorage.setItem('hybrid-auth-session', JSON.stringify(session));localStorage.setItem('hybrid-auth-user', JSON.stringify(authData.user));localStorage.setItem('hybrid-auth-warehouse', authData.user.id);}const currentUserData = {id: authData.user.id,email: formData.email,phone: formData.phone,warehouseId: authData.user.id,userType: 'admin'};localStorage.setItem('currentUser', JSON.stringify(currentUserData));sessionStorage.setItem('currentUser', JSON.stringify(currentUserData));"

if target in content:
    content = content.replace(target, replacement)
    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(content)
    print('Updated register-warehouse.min.js')
else:
    print('Target not found in register-warehouse.min.js')
