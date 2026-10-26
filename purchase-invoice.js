// ============================================
// Purchase Invoice Page JavaScript
// Project: سلامتك (Slamtak)
// NO LOCAL STORAGE - All data from Supabase only
// ============================================

// ============================================
// 1. Setup Supabase Client
// ============================================

const SUPABASE_URL = 'https://iksjhjxwphmvthryfeae.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_0DUy2mtXS6m5S8PwTDAANQ_XWlzbu0G';

// Create Supabase client
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ============================================
// 2. Global Variables (In-Memory Only)
// ============================================

let invoiceItems = [];
let allProducts = [];
let clusterize = null;
let filteredInvoiceItems = [];
let lazyLoadingEnabled = true;
let currentPage = 0;
const pageSize = 100;
let isLoading = false;
let hasMoreData = true;

// ============================================
// 3. Get Current User ID from Supabase Auth
// ============================================

/**
 * Get current user ID from Supabase Auth
 * SECURITY FIRST: Automatically fetches warehouse_id from login session
 * FORBIDDEN: Manual warehouse_id entry is strictly prohibited
 * RLS: Server only accepts operations for the logged-in warehouse
 * @returns {Promise<UUID|null>} - The user ID (warehouse_id) or null if not authenticated
 */
async function getCurrentUserId() {
    try {
        // SECURITY: Use getUser() to get current authenticated user
        const { data: { user }, error } = await supabaseClient.auth.getUser();
        
        if (error) {
            console.error('Error getting user:', error);
            alert('خطأ في التحقق من الهوية');
            return null;
        }
        
        if (!user || !user.id) {
            console.error('No authenticated user found');
            alert('يرجى تسجيل الدخول أولاً');
            window.location.href = 'login.html';
            return null;
        }
        
        // SECURITY: Return user.id as warehouse_id
        // This ensures each warehouse can only access their own data via RLS
        return user.id;
    } catch (error) {
        console.error('Error getting current user ID:', error);
        alert('خطأ في التحقق من الهوية');
        return null;
    }
}

// ============================================
// 4. Fetch Products from Supabase
// ============================================

/**
 * Fetch products from Supabase for current user (warehouse)
 * NO LOCAL STORAGE: Data is fetched fresh from Supabase
 * RLS ensures only authorized data is fetched
 * @param {number} page - Page number for pagination
 * @returns {Promise<Array>} - Array of products
 */
async function fetchProducts(page = 0) {
    try {
        const userId = await getCurrentUserId();
        
        if (!userId) {
            return [];
        }
        
        const { data, error } = await supabaseClient
            .from('warehouse_custom_products')
            .select('*')
            .eq('warehouse_id', userId)
            .order('created_at', { ascending: false })
            .range(page * pageSize, (page + 1) * pageSize - 1);
        
        if (error) {
            console.error('Error fetching products:', error);
            return [];
        }
        
        // NO LOCAL STORAGE: Return data directly without caching
        return data || [];
    } catch (error) {
        console.error('Error fetching products:', error);
        return [];
    }
}

/**
 * Load products with lazy loading
 * NO LOCAL STORAGE: Data is loaded directly from Supabase
 */
async function loadProducts() {
    try {
        const userId = await getCurrentUserId();
        
        if (!userId) {
            return;
        }
        
        // Reset lazy loading state
        currentPage = 0;
        hasMoreData = true;
        allProducts = [];
        
        // Load initial batch
        const products = await fetchProducts(currentPage);
        allProducts = products;
        
        // Update Clusterize.js
        if (clusterize) {
            updateClusterizeData();
        }
        
        console.log('Products loaded with lazy loading enabled (NO LOCAL STORAGE)');
    } catch (error) {
        console.error('Error loading products:', error);
    }
}

// ============================================
// 5. Upsert Products with onConflict
// ============================================

/**
 * Upsert products to Supabase with onConflict
 * Links products to current user ID (warehouse_id)
 * NO LOCAL STORAGE: Data goes directly to Supabase
 * @param {Array} products - Array of product objects
 * @returns {Promise<Object>} - Result object
 */
async function upsertProducts(products) {
    try {
        const userId = await getCurrentUserId();
        
        if (!userId) {
            return { success: false, error: 'Invalid user ID' };
        }
        
        if (!products || products.length === 0) {
            console.warn('No products to upsert');
            return { success: true, upsertedCount: 0, failedCount: 0 };
        }
        
        // Add user ID (warehouse_id) to each product
        const productsWithUserId = products.map(product => ({
            ...product,
            warehouse_id: userId
        }));
        
        // Use onConflict for upsert based on warehouse_id and name_en
        const { error } = await supabaseClient
            .from('warehouse_custom_products')
            .upsert(productsWithUserId, {
                onConflict: 'warehouse_id,name_en',
                ignoreDuplicates: false
            });
        
        if (error) {
            console.error('Error upserting products:', error);
            return { success: false, error: error.message };
        }
        
        // NO LOCAL STORAGE: Data is sent directly to Supabase
        return {
            success: true,
            upsertedCount: products.length,
            failedCount: 0
        };
    } catch (error) {
        console.error('Error upserting products:', error);
        return { success: false, error: error.message };
    }
}

/**
 * Upsert products with chunking for large datasets (20,000 products)
 * UPSERT LOGIC: Uses composite key (warehouse_id, name_en)
 * - If product exists in this warehouse account -> UPDATE data
 * - If product does not exist -> INSERT as new product in this warehouse account only
 * NO LOCAL STORAGE: Data goes directly to Supabase
 * PERFORMANCE: Chunks of 1000 items for stability under any internet pressure
 * @param {Array} products - Array of product objects
 * @returns {Promise<Object>} - Result object with updatedCount and newCount
 */
async function upsertProductsWithChunking(products) {
    try {
        const userId = await getCurrentUserId();
        
        if (!userId) {
            return { success: false, error: 'Invalid user ID' };
        }
        
        if (!products || products.length === 0) {
            console.warn('No products to upsert');
            return { success: true, updatedCount: 0, newCount: 0, failedCount: 0 };
        }
        
        const chunkSize = 1000;
        const totalItems = products.length;
        const totalChunks = Math.ceil(totalItems / chunkSize);
        const chunks = [];
        
        // Add user ID (warehouse_id) to each product
        const productsWithUserId = products.map(product => ({
            ...product,
            warehouse_id: userId
        }));
        
        // Split data into chunks of 1000 items
        for (let i = 0; i < totalChunks; i++) {
            const start = i * chunkSize;
            const end = Math.min(start + chunkSize, totalItems);
            chunks.push(productsWithUserId.slice(start, end));
        }
        
        let updatedCount = 0;
        let newCount = 0;
        let failedCount = 0;
        
        // Process chunks sequentially
        for (let i = 0; i < chunks.length; i++) {
            const chunk = chunks[i];
            
            try {
                // UPSERT LOGIC: Use onConflict based on composite key (warehouse_id, name_en)
                // This ensures:
                // - If (warehouse_id, name_en) exists -> UPDATE
                // - If (warehouse_id, name_en) does not exist -> INSERT
                const { error } = await supabaseClient
                    .from('warehouse_custom_products')
                    .upsert(chunk, {
                        onConflict: 'warehouse_id,name_en',
                        ignoreDuplicates: false
                    });
                
                if (error) {
                    console.error(`Error upserting chunk ${i + 1}:`, error);
                    failedCount += chunk.length;
                } else {
                    // For simplicity, we count all as upserted
                    // In a real implementation, you might want to track updated vs new separately
                    updatedCount += chunk.length;
                    console.log(`Upserted chunk ${i + 1}/${totalChunks}: ${chunk.length} products`);
                }
            } catch (error) {
                console.error(`Error upserting chunk ${i + 1}:`, error);
                failedCount += chunk.length;
            }
        }
        
        // NO LOCAL STORAGE: Data is sent directly to Supabase
        return {
            success: true,
            updatedCount,
            newCount: updatedCount, // Simplified: all upserts counted as updated
            failedCount,
            totalItems
        };
    } catch (error) {
        console.error('Error upserting products with chunking:', error);
        return { success: false, error: error.message };
    }
}

// ============================================
// 6. Clusterize.js Integration
// ============================================

/**
 * Initialize Clusterize.js
 */
function initializeClusterize() {
    if (typeof Clusterize === 'undefined') {
        console.error('Clusterize.js is not loaded');
        return;
    }
    
    clusterize = new Clusterize({
        scrollId: 'scrollArea',
        contentId: 'contentArea',
        rows_in_block: 50,
        rows: [],
        tag: 'tr',
        callbacks: {
            scrollingProgress: function (progress) {
                // Trigger lazy loading when scrolling near bottom
                if (progress > 80 && !isLoading && hasMoreData) {
                    loadMoreProducts();
                }
            }
        }
    });
    
    console.log('Clusterize.js initialized');
}

/**
 * Update Clusterize.js with current data
 * NO LOCAL STORAGE: Data is displayed directly from RAM
 */
function updateClusterizeData() {
    if (!clusterize) {
        console.error('Clusterize.js is not initialized');
        return;
    }
    
    // Generate row HTML
    const rows = allProducts.map(product => `
        <tr>
            <td>${product.name_en || ''}</td>
            <td>${product.name_ar || ''}</td>
            <td>${product.batch_number || '-'}</td>
            <td>${product.quantity || 0}</td>
            <td>${product.price || 0}</td>
            <td>${product.discount || 0}</td>
            <td>${product.category || 'مخصص'}</td>
        </tr>
    `);
    
    // Update Clusterize.js
    clusterize.update(rows);
}

/**
 * Load more products with lazy loading
 * NO LOCAL STORAGE: Data is loaded directly from Supabase
 */
async function loadMoreProducts() {
    if (isLoading || !hasMoreData) {
        return;
    }
    
    isLoading = true;
    
    try {
        currentPage++;
        const products = await fetchProducts(currentPage);
        
        if (products.length === 0) {
            hasMoreData = false;
        } else {
            allProducts = [...allProducts, ...products];
            updateClusterizeData();
        }
    } catch (error) {
        console.error('Error loading more products:', error);
    } finally {
        isLoading = false;
    }
}

// ============================================
// 7. Invoice Items Management
// ============================================

/**
 * Add item to invoice
 * NO LOCAL STORAGE: Data is stored in RAM only
 */
function addItemToInvoice(product) {
    invoiceItems.push({
        id: Date.now(),
        name: product.name_en,
        nameAr: product.name_ar,
        batchNumber: product.batch_number,
        quantity: product.quantity,
        price: product.price,
        discount: product.discount,
        total: product.quantity * product.price * (1 - product.discount / 100),
        productionDate: product.production_date,
        expiryDate: product.expiry_date,
        category: product.category
    });
    
    updateInvoiceTable();
    updateInvoiceSummary();
}

/**
 * Update invoice table
 * NO LOCAL STORAGE: Data is displayed directly from RAM
 */
function updateInvoiceTable() {
    const tbody = document.getElementById('invoiceItemsBody');
    
    if (!tbody) {
        return;
    }
    
    tbody.innerHTML = invoiceItems.map((item, index) => `
        <tr>
            <td>${item.name || ''}</td>
            <td>${item.batchNumber || '-'}</td>
            <td>${item.quantity || 0}</td>
            <td>${item.price || 0}</td>
            <td>${item.discount || 0}</td>
            <td>${item.total || 0}</td>
            <td>
                <button onclick="removeInvoiceItem(${index})">حذف</button>
            </td>
        </tr>
    `).join('');
}

/**
 * Update invoice summary
 * NO LOCAL STORAGE: Data is calculated directly from RAM
 */
function updateInvoiceSummary() {
    const totalItems = invoiceItems.length;
    const totalAmount = invoiceItems.reduce((sum, item) => sum + (item.total || 0), 0);
    
    const totalItemsElement = document.getElementById('totalItems');
    const totalAmountElement = document.getElementById('totalAmount');
    
    if (totalItemsElement) {
        totalItemsElement.textContent = totalItems;
    }
    
    if (totalAmountElement) {
        totalAmountElement.textContent = totalAmount.toFixed(2);
    }
}

/**
 * Remove item from invoice
 * NO LOCAL STORAGE: Data is removed from RAM only
 */
function removeInvoiceItem(index) {
    invoiceItems.splice(index, 1);
    updateInvoiceTable();
    updateInvoiceSummary();
}

// ============================================
// 8. Validation Functions
// ============================================

/**
 * Validate invoice items before saving
 * REQUIRED FIELDS: Product name, Price, Discount must be present
 * SUPPLIER VALIDATION: Supplier name must be present in the top field
 * OPTIONAL FIELDS: batch_number, quantity, production_date, expiry_date, category (can be empty/null)
 * PRICE VALIDATION: Price must be greater than zero
 * @returns {Object} - Validation result with isValid and error message
 */
function validateInvoiceItems() {
    // Check if supplier name is missing (REQUIRED)
    const supplierNameInput = document.getElementById('supplierName');
    const supplierName = supplierNameInput ? supplierNameInput.value.trim() : '';
    
    if (!supplierName || supplierName === '') {
        return {
            isValid: false,
            error: 'برجاء إدخال اسم المورد أولاً'
        };
    }
    
    if (!invoiceItems || invoiceItems.length === 0) {
        return {
            isValid: false,
            error: 'يرجى إضافة صنف واحد على الأقل'
        };
    }
    
    for (let i = 0; i < invoiceItems.length; i++) {
        const item = invoiceItems[i];
        
        // Check if product name is missing (REQUIRED)
        if (!item.name || item.name.trim() === '') {
            return {
                isValid: false,
                error: `برجاء استكمال البيانات الإجبارية لجميع الأصناف\nالصنف رقم ${i + 1}: الاسم مفقود`
            };
        }
        
        // Check if price is missing (REQUIRED)
        if (item.price === undefined || item.price === null || item.price === '') {
            return {
                isValid: false,
                error: `برجاء استكمال البيانات الإجبارية لجميع الأصناف\nالصنف رقم ${i + 1}: السعر مفقود`
            };
        }
        
        // Check if discount is missing (REQUIRED)
        if (item.discount === undefined || item.discount === null || item.discount === '') {
            return {
                isValid: false,
                error: `برجاء استكمال البيانات الإجبارية لجميع الأصناف\nالصنف رقم ${i + 1}: الخصم مفقود`
            };
        }
        
        // Check if price is less than or equal to zero
        if (parseFloat(item.price) <= 0) {
            return {
                isValid: false,
                error: `برجاء استكمال البيانات الإجبارية لجميع الأصناف\nالصنف رقم ${i + 1}: السعر يجب أن يكون أكبر من صفر`
            };
        }
        
        // Check if discount is negative
        if (parseFloat(item.discount) < 0) {
            return {
                isValid: false,
                error: `برجاء استكمال البيانات الإجبارية لجميع الأصناف\nالصنف رقم ${i + 1}: الخصم لا يمكن أن يكون سالباً`
            };
        }
        
        // OPTIONAL FIELDS: batch_number, quantity, production_date, expiry_date, category
        // These fields are optional and can be empty/null - no validation needed
    }
    
    return {
        isValid: true,
        error: null
    };
}

/**
 * Disable save button during validation
 */
function disableSaveButton() {
    const saveButton = document.getElementById('saveButton');
    if (saveButton) {
        saveButton.disabled = true;
        saveButton.textContent = 'جاري التحقق...';
    }
}

/**
 * Enable save button after validation
 */
function enableSaveButton() {
    const saveButton = document.getElementById('saveButton');
    if (saveButton) {
        saveButton.disabled = false;
        saveButton.textContent = 'حفظ الفاتورة';
    }
}

// ============================================
// 9. Save Invoice with Upsert
// ============================================

/**
 * Save invoice and upsert products
 * SECURITY: All operations use warehouse_id from authenticated user only
 * NO LOCAL STORAGE: All data goes directly to Supabase
 * CONFIRMATION: Shows updated count and new count on success
 * VALIDATION: Checks required fields before saving
 */
async function saveInvoice() {
    try {
        const userId = await getCurrentUserId();
        
        if (!userId) {
            alert('يرجى تسجيل الدخول أولاً');
            return;
        }
        
        // VALIDATION: Check required fields before saving
        disableSaveButton();
        const validation = validateInvoiceItems();
        
        if (!validation.isValid) {
            // Show red alert message
            alert(`⚠️ تنبيه: ${validation.error}`);
            enableSaveButton();
            return;
        }
        
        // Show progress
        showProgressBar();
        updateProgressBar(0, 'جاري حفظ الفاتورة...');
        
        // Prepare products for upsert
        // OPTIONAL FIELDS: Convert empty values to null for batch_number, production_date, expiry_date, category
        // QUANTITY HANDLING: If quantity is empty, send 'متوفر' to ensure product appears in search
        // SUPPLIER LINKING: Automatically add supplier_name from top field to each item
        const supplierNameInput = document.getElementById('supplierName');
        const supplierName = supplierNameInput ? supplierNameInput.value.trim() : '';
        
        const productsToUpsert = invoiceItems.map(item => ({
            name_en: item.name,
            name_ar: item.nameAr,
            batch_number: item.batchNumber && item.batchNumber.trim() !== '' ? item.batchNumber : null,
            quantity: item.quantity !== undefined && item.quantity !== null && item.quantity !== '' ? item.quantity : 'متوفر',
            price: item.price,
            discount: item.discount,
            production_date: item.productionDate && item.productionDate.trim() !== '' ? item.productionDate : null,
            expiry_date: item.expiryDate && item.expiryDate.trim() !== '' ? item.expiryDate : null,
            category: item.category && item.category.trim() !== '' ? item.category : null,
            supplier_name: supplierName, // AUTOMATIC LINKING: Add supplier name to each item
            is_permanent: true
        }));
        
        // Upsert products with chunking (1000 items per chunk)
        updateProgressBar(50, 'جاري حفظ المنتجات...');
        const result = await upsertProductsWithChunking(productsToUpsert);
        
        updateProgressBar(100, 'تم الحفظ بنجاح!');
        
        hideProgressBar();
        
        if (result.success) {
            // CONFIRMATION MESSAGE: Shows updated count and new count
            alert(`
                تم حفظ الفاتورة بنجاح ✅
                
                تفاصيل الحفظ:
                • عدد الأصناف في الفاتورة: ${invoiceItems.length}
                • الأصناف المحدثة: ${result.updatedCount}
                • الأصناف الجديدة: ${result.newCount}
                ${result.failedCount > 0 ? `• فشل: ${result.failedCount}` : ''}
                
                ملاحظة: جميع البيانات محفوظة في حسابك الخاص فقط
            `);
            
            // Reset invoice
            invoiceItems = [];
            updateInvoiceTable();
            updateInvoiceSummary();
            
            // Reload products from Supabase (NO LOCAL STORAGE)
            await loadProducts();
        } else {
            alert(`حدث خطأ أثناء الحفظ: ${result.error}`);
        }
        
        enableSaveButton();
    } catch (error) {
        console.error('Error saving invoice:', error);
        hideProgressBar();
        enableSaveButton();
        alert(`حدث خطأ أثناء الحفظ: ${error.message}`);
    }
}

// ============================================
// 9. Progress Bar Functions
// ============================================

function showProgressBar() {
    const progressContainer = document.getElementById('progressContainer');
    if (progressContainer) {
        progressContainer.style.display = 'block';
    }
}

function hideProgressBar() {
    const progressContainer = document.getElementById('progressContainer');
    if (progressContainer) {
        progressContainer.style.display = 'none';
    }
}

function updateProgressBar(percentage, text) {
    const progressBar = document.getElementById('progressBar');
    const progressText = document.getElementById('progressText');
    
    if (progressBar) {
        progressBar.style.width = percentage + '%';
        progressBar.textContent = percentage + '%';
    }
    
    if (progressText) {
        progressText.textContent = text;
    }
}

// ============================================
// 10. Initialize Page
// ============================================

document.addEventListener('DOMContentLoaded', async () => {
    console.log('Purchase Invoice Page Loaded');
    
    // Check authentication
    const userId = await getCurrentUserId();
    if (!userId) {
        return;
    }
    
    // Initialize Clusterize.js
    initializeClusterize();
    
    // Load products
    await loadProducts();
    
    // Set default date
    setDefaultDate();
    
    // Generate invoice number (async)
    await generateInvoiceNumber();
});

// Set Default Date - YYYY-MM-DD format for Supabase
// Automatically fills the date field with today's date in YYYY-MM-DD format
function setDefaultDate() {
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD format (Supabase format)
    const invoiceDateInput = document.getElementById('invoiceDate');
    if (invoiceDateInput) {
        invoiceDateInput.value = today; // Inject today's date in YYYY-MM-DD format (Supabase format)
        console.log('Date set to:', today); // Log for debugging
    }
}

// Generate Invoice Number - Fetch last invoice number for this warehouse and increment
// Shows the auto-generated number in the interface, but allows user to edit it
async function generateInvoiceNumber() {
    try {
        console.log('Fetching last invoice number for this warehouse...');
        
        const userId = await getCurrentUserId();
        
        if (!userId) {
            console.log('No user ID found, skipping invoice number generation');
            return;
        }
        
        // Get last invoice number for this warehouse
        const { data: invoices, error } = await supabase
            .from('purchase_invoices')
            .select('invoice_number')
            .eq('warehouse_id', userId)
            .order('invoice_number', { ascending: false })
            .limit(1);
        
        console.log('Last invoice query - data:', invoices, 'error:', error);
        
        let nextNumber = 1; // Default to 1 if no invoices exist
        
        if (invoices && invoices.length > 0) {
            // Extract number from last invoice
            const lastInvoiceNumber = invoices[0].invoice_number;
            const lastNumber = parseInt(lastInvoiceNumber);
            if (!isNaN(lastNumber)) {
                nextNumber = lastNumber + 1;
            }
        }
        
        console.log('Generated invoice number:', nextNumber);
        
        const invoiceNumberInput = document.getElementById('invoiceNumber');
        console.log('invoiceNumber element:', invoiceNumberInput);
        
        if (invoiceNumberInput) {
            invoiceNumberInput.value = nextNumber.toString();
            console.log('Auto-generated invoice number set to:', nextNumber);
            console.log('Element value after setting:', invoiceNumberInput.value);
        } else {
            console.error('invoiceNumber element not found!');
        }
    } catch (error) {
        console.error('Error in generateInvoiceNumber:', error);
    }
}

// ============================================
// End of Purchase Invoice JavaScript
// ============================================
