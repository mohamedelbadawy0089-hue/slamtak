/**
 * 🤖 Advanced Salamtak AI Web Worker
 * Direct IndexedDB Access for Massive Data Support (20,000+ Items)
 */

let db = null;

function initDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open('SalamtakDB', 5); // Version 5 includes AI indexes
        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains('products')) {
                const store = db.createObjectStore('products', { keyPath: 'id', autoIncrement: true });
                store.createIndex('name', 'productName', { unique: false });
                store.createIndex('barcode', 'barcode', { unique: false });
                store.createIndex('expiry', 'expiryDate', { unique: false });
            }
        };
        request.onsuccess = (e) => {
            db = e.target.result;
            resolve(db);
        };
        request.onerror = (e) => reject(e);
    });
}

self.onmessage = async function(e) {
    if (!db) await initDB();

    const { action, query } = e.data;

    if (action === 'search') {
        const results = await dbSearch(query);
        self.postMessage({ action: 'searchResult', results: results });
    }

    if (action === 'audit') {
        const errors = await dbAudit();
        self.postMessage({ action: 'auditResult', errors: errors });
    }
};

/**
 * 🔍 Direct DB Search using Cursors for Scale
 */
async function dbSearch(query) {
    return new Promise((resolve) => {
        const q = query.toLowerCase().trim();
        const results = [];
        const transaction = db.transaction(['products'], 'readonly');
        const store = transaction.objectStore('products');
        const cursorRequest = store.openCursor();

        cursorRequest.onsuccess = (e) => {
            const cursor = e.target.result;
            if (cursor) {
                const p = cursor.value;
                const name = (p.productName || p.name || "").toLowerCase();
                
                if (name.includes(q)) {
                    results.push({ ...p, relevance: name.startsWith(q) ? 100 : 50 });
                }
                
                if (results.length < 50) cursor.continue();
                else resolve(sortResults(results));
            } else {
                resolve(sortResults(results));
            }
        };
    });
}

function sortResults(results) {
    return results.sort((a, b) => b.relevance - a.relevance).slice(0, 10);
}

/**
 * 🛡️ Full Database Audit (Proactive Oversight)
 */
async function dbAudit() {
    return new Promise((resolve) => {
        const issues = { expired: [], nearExpiry: [], missingPrice: [] };
        const now = new Date();
        const threeMonths = new Date();
        threeMonths.setMonth(now.getMonth() + 3);

        const transaction = db.transaction(['products'], 'readonly');
        const store = transaction.objectStore('products');
        const cursorRequest = store.openCursor();

        cursorRequest.onsuccess = (e) => {
            const cursor = e.target.result;
            if (cursor) {
                const p = cursor.value;
                if (p.expiryDate) {
                    const exp = new Date(p.expiryDate);
                    if (exp < now) issues.expired.push(p.productName);
                    else if (exp < threeMonths) issues.nearExpiry.push(p.productName);
                }
                if (!p.price || parseFloat(p.price) === 0) {
                    issues.missingPrice.push(p.productName);
                }
                cursor.continue();
            } else {
                resolve(issues);
            }
        };
    });
}
