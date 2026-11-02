/**
 * tenant-helper.js
 * Helper untuk mendapatkan tenant_id dari session yang disimpan di localStorage
 * Digunakan oleh app.js untuk multi-tenant filtering
 */

// Mendapatkan tenant_id dari session yang disimpan
function getTenantIdFromSession() {
  try {
    const sessionRaw = localStorage.getItem('session');
    if (!sessionRaw) return null;
    
    const session = JSON.parse(sessionRaw);
    return session.tenant_id || null;
  } catch (e) {
    console.warn(' tenant-helper: gagal membaca session:', e.message);
    return null;
  }
}

// Mendapatkan warehouse_id dari session yang disimpan
function getWarehouseIdFromSession() {
  try {
    const sessionRaw = localStorage.getItem('session');
    if (!sessionRaw) return null;
    
    const session = JSON.parse(sessionRaw);
    return session.warehouse_id || null;
  } catch (e) {
    console.warn(' tenant-helper: gagal membaca session:', e.message);
    return null;
  }
}

// Mendapatkan konteks lengkap tenant
function getTenantContext() {
  return {
    tenant_id: getTenantIdFromSession(),
    warehouse_id: getWarehouseIdFromSession()
  };
}

// Cek apakah user memiliki tenant_id yang valid
function hasValidTenant() {
  const tenantId = getTenantIdFromSession();
  return tenantId !== null && tenantId !== undefined && tenantId !== '';
}

// Untuk digunakan oleh Supabase client sebagai default filter
// Dapat dipanggil sebelum setiap query ke tabel yang mengandung tenant_id
function getTenantFilter() {
  const tenantId = getTenantIdFromSession();
  if (!tenantId) {
    console.warn(' tenant-helper: tidak ada tenant_id dalam session');
    return null;
  }
  return { tenant_id: tenantId };
}

// Filter untuk query Supabase - contoh penggunaan:
// const query = supabase.from('products').eq('tenant_id', getTenantFilter()?.tenant_id)
// atau menggunakan withTenantFilter dari tenant-context.js

// Ekspor ke window untuk akses global
window.tenantHelper = {
  getTenantId: getTenantIdFromSession,
  getWarehouseId: getWarehouseIdFromSession,
  getContext: getTenantContext,
  hasValidTenant,
  getFilter: getTenantFilter
};

console.log(' tenant-helper loaded - ready for multi-tenant operations');
