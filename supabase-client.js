// ============================================
// Supabase Client for Purchase Invoice System
// Project: سلامتك (Slamtak)
// Supports 20,000 products per warehouse
// NO LOCAL STORAGE - All data from Supabase only
// ============================================

// ============================================
// 1. Setup Supabase Client
// ============================================

const SUPABASE_URL = 'YOUR_SUPABASE_URL_HERE';
const SUPABASE_ANON_KEY = 'YOUR_SUPABASE_ANON_KEY_HERE';

// Create Supabase client
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ============================================
// 2. Validation Functions
// ============================================

/**
 * Validate warehouse_id before any operation
 * Ensures data privacy for Egyptian warehouses
 * @param {UUID} warehouseId - The warehouse ID to validate
 * @returns {boolean} - True if valid, false otherwise
 */
function validateWarehouseId(warehouseId) {
    if (!warehouseId) {
        console.error('Invalid warehouse_id: warehouse_id is required');
        return false;
    }
    
    // Check if warehouseId is a valid UUID
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(warehouseId)) {
        console.error('Invalid warehouse_id: must be a valid UUID');
        return false;
    }
    
    return true;
}

/**
 * Get current warehouse_id from authenticated user
 * @returns {Promise<UUID|null>} - The warehouse_id or null if not found
 */
async function getCurrentWarehouseId() {
    try {
        const { data: { session }, error } = await supabaseClient.auth.getSession();
        
        if (error) {
            console.error('Error getting session:', error);
            return null;
        }
        
        if (!session || !session.user) {
            console.error('No authenticated user found');
            return null;
        }
        
        // Get warehouse_id from user metadata or query
        const warehouseId = session.user.user_metadata?.warehouse_id || session.user.id;
        
        if (!validateWarehouseId(warehouseId)) {
            return null;
        }
        
        return warehouseId;
    } catch (error) {
        console.error('Error getting current warehouse_id:', error);
        return null;
    }
}

// ============================================
// 3. Fetch Data Functions
// ============================================

/**
 * Fetch products from Supabase for current warehouse
 * NO LOCAL STORAGE: Data is fetched fresh from Supabase
 * RLS ensures only authorized data is fetched
 * @param {Object} options - Fetch options
 * @param {number} options.page - Page number for pagination (default: 0)
 * @param {number} options.pageSize - Number of items per page (default: 100)
 * @param {string} options.category - Filter by category (optional)
 * @param {string} options.search - Search term (optional)
 * @returns {Promise<Array>} - Array of products
 */
async function fetchProducts(options = {}) {
    const {
        page = 0,
        pageSize = 100,
        category = null,
        search = null
    } = options;
    
    try {
        const warehouseId = await getCurrentWarehouseId();
        
        if (!warehouseId) {
            console.error('Cannot fetch products: invalid warehouse_id');
            return [];
        }
        
        let query = supabaseClient
            .from('warehouse_custom_products')
            .select('*')
            .eq('warehouse_id', warehouseId)
            .order('created_at', { ascending: false })
            .range(page * pageSize, (page + 1) * pageSize - 1);
        
        // Apply category filter if provided
        if (category) {
            query = query.eq('category', category);
        }
        
        // Apply search filter if provided
        if (search) {
            query = query.or(`name_en.ilike.%${search}%,name_ar.ilike.%${search}%`);
        }
        
        const { data, error } = await query;
        
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
 * Fetch products with lazy loading for Clusterize.js
 * NO LOCAL STORAGE: Data is loaded directly from Supabase
 * @param {number} page - Page number
 * @param {number} pageSize - Number of items per page
 * @returns {Promise<Object>} - Object with data and pagination info
 */
async function fetchProductsWithLazyLoading(page = 0, pageSize = 100) {
    try {
        const warehouseId = await getCurrentWarehouseId();
        
        if (!warehouseId) {
            console.error('Cannot fetch products: invalid warehouse_id');
            return { data: [], hasMore: false };
        }
        
        const { data, error, count } = await supabaseClient
            .from('warehouse_custom_products')
            .select('*', { count: 'exact' })
            .eq('warehouse_id', warehouseId)
            .order('created_at', { ascending: false })
            .range(page * pageSize, (page + 1) * pageSize - 1);
        
        if (error) {
            console.error('Error fetching products with lazy loading:', error);
            return { data: [], hasMore: false };
        }
        
        const hasMore = (page + 1) * pageSize < (count || 0);
        
        // NO LOCAL STORAGE: Return data directly without caching
        return { data: data || [], hasMore };
    } catch (error) {
        console.error('Error fetching products with lazy loading:', error);
        return { data: [], hasMore: false };
    }
}

// ============================================
// 4. Upsert Functions
// ============================================

/**
 * Upsert products to Supabase with onConflict
 * NO LOCAL STORAGE: Data goes directly to Supabase
 * Supports 20,000 products with chunking
 * @param {Array} products - Array of product objects
 * @param {Object} options - Upsert options
 * @param {number} options.chunkSize - Size of chunks for bulk upsert (default: 1000)
 * @param {number} options.parallelBatches - Number of parallel batches (default: 3)
 * @returns {Promise<Object>} - Result object with success and failed counts
 */
async function upsertProducts(products, options = {}) {
    const {
        chunkSize = 1000,
        parallelBatches = 3
    } = options;
    
    try {
        const warehouseId = await getCurrentWarehouseId();
        
        if (!warehouseId) {
            console.error('Cannot upsert products: invalid warehouse_id');
            return { success: false, error: 'Invalid warehouse_id' };
        }
        
        if (!products || products.length === 0) {
            console.warn('No products to upsert');
            return { success: true, upsertedCount: 0, failedCount: 0 };
        }
        
        // Add warehouse_id to each product if not present
        const productsWithWarehouseId = products.map(product => ({
            ...product,
            warehouse_id: product.warehouse_id || warehouseId
        }));
        
        const totalItems = productsWithWarehouseId.length;
        const totalChunks = Math.ceil(totalItems / chunkSize);
        const chunks = [];
        
        // Split data into chunks
        for (let i = 0; i < totalChunks; i++) {
            const start = i * chunkSize;
            const end = Math.min(start + chunkSize, totalItems);
            chunks.push(productsWithWarehouseId.slice(start, end));
        }
        
        // Process chunks in parallel batches
        let processedChunks = 0;
        let upsertedCount = 0;
        let failedCount = 0;
        const successfulChunks = new Set();
        
        for (let i = 0; i < chunks.length; i += parallelBatches) {
            const batchChunks = chunks.slice(i, i + parallelBatches);
            
            const batchPromises = batchChunks.map(async (chunk, batchIndex) => {
                const chunkIndex = i + batchIndex;
                
                if (successfulChunks.has(chunkIndex)) {
                    return { success: true, skipped: true };
                }
                
                try {
                    // Use onConflict for upsert based on warehouse_id and name_en
                    const { error } = await supabaseClient
                        .from('warehouse_custom_products')
                        .upsert(chunk, {
                            onConflict: 'warehouse_id,name_en',
                            ignoreDuplicates: false
                        });
                    
                    if (error) throw error;
                    
                    successfulChunks.add(chunkIndex);
                    processedChunks++;
                    upsertedCount += chunk.length;
                    
                    console.log(`Upserted chunk ${chunkIndex + 1}/${totalChunks}: ${chunk.length} products`);
                    
                    return { success: true };
                } catch (error) {
                    console.error(`Failed to upsert chunk ${chunkIndex}:`, error);
                    failedCount += chunk.length;
                    return { success: false, error, chunkIndex };
                }
            });
            
            const results = await Promise.all(batchPromises);
            
            const failedChunks = results.filter(r => !r.success && !r.skipped);
            if (failedChunks.length > 0) {
                console.error(`${failedChunks.length} chunks failed permanently`);
            }
        }
        
        // NO LOCAL STORAGE: Data is sent directly to Supabase
        return {
            success: true,
            upsertedCount,
            failedCount,
            totalItems
        };
    } catch (error) {
        console.error('Error upserting products:', error);
        return { success: false, error: error.message };
    }
}

/**
 * Upsert products with Auto-Retry
 * NO LOCAL STORAGE: Data goes directly to Supabase
 * @param {Array} products - Array of product objects
 * @param {Object} options - Upsert options
 * @param {number} options.chunkSize - Size of chunks for bulk upsert (default: 1000)
 * @param {number} options.parallelBatches - Number of parallel batches (default: 3)
 * @param {number} options.maxRetries - Maximum number of retries per chunk (default: 3)
 * @returns {Promise<Object>} - Result object with success and failed counts
 */
async function upsertProductsWithRetry(products, options = {}) {
    const {
        chunkSize = 1000,
        parallelBatches = 3,
        maxRetries = 3
    } = options;
    
    try {
        const warehouseId = await getCurrentWarehouseId();
        
        if (!warehouseId) {
            console.error('Cannot upsert products: invalid warehouse_id');
            return { success: false, error: 'Invalid warehouse_id' };
        }
        
        if (!products || products.length === 0) {
            console.warn('No products to upsert');
            return { success: true, upsertedCount: 0, failedCount: 0 };
        }
        
        // Add warehouse_id to each product if not present
        const productsWithWarehouseId = products.map(product => ({
            ...product,
            warehouse_id: product.warehouse_id || warehouseId
        }));
        
        const totalItems = productsWithWarehouseId.length;
        const totalChunks = Math.ceil(totalItems / chunkSize);
        const chunks = [];
        
        // Split data into chunks
        for (let i = 0; i < totalChunks; i++) {
            const start = i * chunkSize;
            const end = Math.min(start + chunkSize, totalItems);
            chunks.push(productsWithWarehouseId.slice(start, end));
        }
        
        // Promise-Retry wrapper function
        const promiseRetry = async (fn, retries, chunkIndex) => {
            let lastError;
            
            for (let i = 0; i < retries; i++) {
                try {
                    return await fn();
                } catch (error) {
                    lastError = error;
                    console.error(`Retry ${i + 1}/${retries} for chunk ${chunkIndex}:`, error.message);
                    
                    if (i < retries - 1) {
                        // Exponential backoff: 1s, 2s, 4s
                        const backoffTime = Math.pow(2, i) * 1000;
                        await new Promise(resolve => setTimeout(resolve, backoffTime));
                    }
                }
            }
            
            throw lastError;
        };
        
        // Process chunks in parallel batches
        let processedChunks = 0;
        let upsertedCount = 0;
        let failedCount = 0;
        const successfulChunks = new Set();
        
        for (let i = 0; i < chunks.length; i += parallelBatches) {
            const batchChunks = chunks.slice(i, i + parallelBatches);
            
            const batchPromises = batchChunks.map(async (chunk, batchIndex) => {
                const chunkIndex = i + batchIndex;
                
                if (successfulChunks.has(chunkIndex)) {
                    return { success: true, skipped: true };
                }
                
                try {
                    await promiseRetry(async () => {
                        // Use onConflict for upsert based on warehouse_id and name_en
                        const { error } = await supabaseClient
                            .from('warehouse_custom_products')
                            .upsert(chunk, {
                                onConflict: 'warehouse_id,name_en',
                                ignoreDuplicates: false
                            });
                        
                        if (error) throw error;
                        
                        successfulChunks.add(chunkIndex);
                        processedChunks++;
                        upsertedCount += chunk.length;
                        
                        console.log(`Upserted chunk ${chunkIndex + 1}/${totalChunks}: ${chunk.length} products`);
                        
                        return { success: true };
                    }, maxRetries, chunkIndex);
                    
                    return { success: true };
                } catch (error) {
                    console.error(`Failed to upsert chunk ${chunkIndex} after ${maxRetries} retries:`, error);
                    failedCount += chunk.length;
                    return { success: false, error, chunkIndex };
                }
            });
            
            const results = await Promise.all(batchPromises);
            
            const failedChunks = results.filter(r => !r.success && !r.skipped);
            if (failedChunks.length > 0) {
                console.error(`${failedChunks.length} chunks failed permanently`);
            }
        }
        
        // NO LOCAL STORAGE: Data is sent directly to Supabase
        return {
            success: true,
            upsertedCount,
            failedCount,
            totalItems
        };
    } catch (error) {
        console.error('Error upserting products with retry:', error);
        return { success: false, error: error.message };
    }
}

// ============================================
// 5. Clusterize.js Integration
// ============================================

/**
 * Initialize Clusterize.js with data from Supabase
 * NO LOCAL STORAGE: Data is loaded directly from Supabase
 * @param {string} scrollId - ID of scroll container
 * @param {string} contentId - ID of content container
 * @param {number} rowsInBlock - Number of rows per block (default: 50)
 * @returns {Object} - Clusterize.js instance
 */
function initializeClusterize(scrollId, contentId, rowsInBlock = 50) {
    // Load Clusterize.js from CDN if not loaded
    if (typeof Clusterize === 'undefined') {
        console.error('Clusterize.js is not loaded. Please include the script.');
        return null;
    }
    
    const clusterize = new Clusterize({
        scrollId: scrollId,
        contentId: contentId,
        rows_in_block: rowsInBlock,
        rows: [],
        tag: 'tr',
        callbacks: {
            scrollingProgress: function (progress) {
                // Trigger lazy loading when scrolling near bottom
                if (progress > 80) {
                    // Dispatch custom event for lazy loading
                    window.dispatchEvent(new CustomEvent('lazyLoadMore'));
                }
            }
        }
    });
    
    return clusterize;
}

/**
 * Update Clusterize.js with data from Supabase
 * NO LOCAL STORAGE: Data is loaded directly from Supabase
 * @param {Object} clusterize - Clusterize.js instance
 * @param {Array} data - Array of data rows
 * @param {Function} rowTemplate - Function to generate row HTML
 */
function updateClusterizeData(clusterize, data, rowTemplate) {
    if (!clusterize || !data) {
        console.error('Invalid clusterize instance or data');
        return;
    }
    
    // Convert data to HTML rows
    const rows = data.map(rowTemplate);
    
    // Update Clusterize.js
    clusterize.update(rows);
    
    // NO LOCAL STORAGE: Data is displayed directly without caching
}

// ============================================
// 6. Export Functions
// ============================================

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        supabaseClient,
        validateWarehouseId,
        getCurrentWarehouseId,
        fetchProducts,
        fetchProductsWithLazyLoading,
        upsertProducts,
        upsertProductsWithRetry,
        initializeClusterize,
        updateClusterizeData
    };
}

// Make available globally for browser use
window.SlamtakSupabase = {
    supabaseClient,
    validateWarehouseId,
    getCurrentWarehouseId,
    fetchProducts,
    fetchProductsWithLazyLoading,
    upsertProducts,
    upsertProductsWithRetry,
    initializeClusterize,
    updateClusterizeData
};

// ============================================
// End of Supabase Client Code
// ============================================
