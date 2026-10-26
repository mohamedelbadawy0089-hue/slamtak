// ============================================
// Salamtak Drug Search Web Worker
// Handles high-speed searching for 17,000+ items
// ============================================

let drugDatabase = [];
let indexedSearch = null;

// Listen for messages from the main thread
self.onmessage = function(e) {
    const { action, data } = e.data;

    switch (action) {
        case 'INITIALIZE':
            drugDatabase = data.drugs || [];
            console.log(`[Worker] Initialized with ${drugDatabase.length} drugs`);
            self.postMessage({ action: 'READY' });
            break;

        case 'SEARCH':
            const { query, options } = data;
            const results = performSearch(query, options);
            self.postMessage({ 
                action: 'SEARCH_RESULTS', 
                data: results,
                query: query 
            });
            break;

        case 'UPDATE_DATA':
            drugDatabase = data.drugs;
            console.log(`[Worker] Database updated: ${drugDatabase.length} items`);
            break;
    }
};

function performSearch(query, options = {}) {
    const { limit = 10, threshold = 0.35 } = options;
    if (!query || query.length < 2) return [];

    const normalizedQuery = query.toLowerCase().trim();
    const queryPhonetics = generatePhoneticCodes(normalizedQuery);

    const matches = drugDatabase.map(drug => {
        let score = 0;
        const tradeName = (drug.tradeName || '').toLowerCase();
        
        // 1. Exact match (Score: 1.0)
        if (tradeName === normalizedQuery) {
            score = 1.0;
        }
        // 2. Starts with (Score: 0.9)
        else if (tradeName.startsWith(normalizedQuery)) {
            score = 0.9;
        }
        // 3. Phonetic match (Score: 0.85)
        else if (drug.phoneticCodes?.some(code => queryPhonetics.includes(code))) {
            score = 0.85;
        }
        // 4. Fuzzy match (Levenshtein)
        else {
            const similarity = calculateSimilarity(normalizedQuery, tradeName);
            if (similarity > 0.5) {
                score = similarity * 0.75;
            } else {
                // Check scientific name as fallback
                const sciName = (drug.scientificName || '').toLowerCase();
                const sciSimilarity = calculateSimilarity(normalizedQuery, sciName);
                score = sciSimilarity * 0.4;
            }
        }
        
        return { drug, score };
    })
    .filter(r => r.score >= threshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

    return matches;
}

function calculateSimilarity(a, b) {
    if (a === b) return 1.0;
    if (a.length === 0 || b.length === 0) return 0;

    const matrix = [];
    for (let i = 0; i <= b.length; i++) matrix[i] = [i];
    for (let j = 0; j <= a.length; j++) matrix[0][j] = j;

    for (let i = 1; i <= b.length; i++) {
        for (let j = 1; j <= a.length; j++) {
            if (b.charAt(i - 1) === a.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(
                    matrix[i - 1][j - 1] + 1,
                    matrix[i][j - 1] + 1,
                    matrix[i - 1][j] + 1
                );
            }
        }
    }

    const distance = matrix[b.length][a.length];
    const maxLength = Math.max(a.length, b.length);
    return 1.0 - (distance / maxLength);
}

function generatePhoneticCodes(name) {
    const codes = new Set();
    const normalized = name.toLowerCase().replace(/[^a-z]/g, '');
    if (!normalized) return [];
    
    let phonetic = normalized
        .replace(/p/g, 'b')
        .replace(/v/g, 'f')
        .replace(/ph/g, 'f')
        .replace(/gh/g, 'g')
        .replace(/th/g, 't')
        .replace(/sh/g, 's')
        .replace(/tion/g, 'sn')
        .replace(/ce/g, 'se')
        .replace(/ci/g, 'si')
        .replace(/cy/g, 'sy');

    const first = phonetic[0];
    const noVowels = first + phonetic.substring(1).replace(/[aeiouyhwy]/g, '');
    
    codes.add(noVowels.substring(0, 3));
    codes.add(noVowels.substring(0, 4));
    codes.add(normalized.substring(0, 3));
    
    return Array.from(codes);
}
