/**
 * Fuse.js Medicine Search
 * نظام البحث الضبابي الذكي للأدوية
 * 
 * Features:
 * - Fuzzy search using Fuse.js for pronunciation matching
 * - Automatic correction to official trade names
 * - Weighted search with multiple keys
 * - Phonetic-aware matching
 */

class FuseMedicineSearch {
    constructor(options = {}) {
        this.fuse = null;
        this.medicines = [];
        this.index = null;
        
        // Fuse.js configuration optimized for medicine names
        // Stricter threshold (0.25) for accurate pronunciation matching
        this.config = {
            keys: [
                { name: 'tradeName', weight: 0.7 },  // Higher weight for trade names
                { name: 'scientificName', weight: 0.2 },
                { name: 'company', weight: 0.1 }
            ],
            includeScore: true,
            includeMatches: true,
            threshold: 0.25,        // Stricter matching (was 0.4)
            distance: 50,           // Reduced for stricter matching
            minMatchCharLength: 3,  // Require at least 3 chars
            shouldSort: true,
            findAllMatches: false,
            isCaseSensitive: false,
            ignoreLocation: true,   // Match anywhere in string
            ignoreFieldNorm: true,
            useExtendedSearch: true,
            ...options
        };
        
        this.searchHistory = [];
        this.maxHistorySize = 50;
    }

    // ============================================
    // Initialize with Medicine Data
    // ============================================
    
    initialize(medicines) {
        this.medicines = medicines || [];
        
        if (this.medicines.length === 0) {
            console.warn('⚠️ No medicines to index');
            return false;
        }
        
        // Create Fuse index
        this.fuse = new Fuse(this.medicines, this.config);
        
        console.log(`✅ Fuse index created with ${this.medicines.length} medicines`);
        return true;
    }

    updateIndex(medicines) {
        return this.initialize(medicines);
    }

    // ============================================
    // Smart Voice Search with Auto-Correction
    // ============================================
    
    search(query, options = {}) {
        if (!this.fuse) {
            console.error('❌ Fuse not initialized');
            return [];
        }
        
        if (!query || query.length < 2) {
            return [];
        }
        
        const limit = options.limit || 10;
        const threshold = options.threshold || this.config.threshold;
        
        // Pre-process query for voice recognition variations
        const processedQuery = this.preprocessVoiceQuery(query);
        
        // Perform search
        const results = this.fuse.search(processedQuery, {
            limit,
            ...options
        });
        
        // Post-process results
        const processed = this.postprocessResults(results, query);
        
        // Add to history
        this.addToHistory(query, processed);
        
        return processed;
    }

    // Find best match with auto-correction
    findBestMatch(query, minScore = 0.6) {
        const results = this.search(query, { limit: 5 });
        
        if (results.length === 0) {
            return null;
        }
        
        const bestMatch = results[0];
        
        // Only return if score is good enough
        if (bestMatch.score < minScore) {
            return {
                ...bestMatch,
                isCorrected: true,
                originalQuery: query,
                confidence: Math.round((1 - bestMatch.score) * 100)
            };
        }
        
        return null;
    }

    // ============================================
    // Voice Query Preprocessing
    // ============================================
    
    preprocessVoiceQuery(query) {
        console.log('🎤 Voice Preprocessing:', { original: query });
        
        let processed = query.toLowerCase().trim();
        
        // Common pronunciation fixes for Egyptian dialects
        // These map common mispronunciations to the correct forms
        const pronunciationMap = {
            // Panadol variations (HIGH PRIORITY)
            'panadol': ['panadol', 'penadol', 'panedol', 'bernard', 'bernardo', 'barnardo', 'panadole', 'benidorm', 'benidor', 'benidol', 'panador', 'penador'],
            'panadol extra': ['panadol extra', 'bernardo extra', 'panedol extra'],
            
            // Other common medicines
            'advil': ['advil', 'adfill', 'advile', 'advel'],
            'brufen': ['brufen', 'brofen', 'brufin', 'barafin', 'profen'],
            'augmentin': ['augmentin', 'augmentine', 'ogmentin', 'augmentine'],
            'amoxicillin': ['amoxicillin', 'amox', 'amoxicilin', 'amoksicilin'],
            'cataflam': ['cataflam', 'kataflam', 'katafram', 'catafram'],
            'doliprane': ['doliprane', 'dolabran', 'dolibran', 'dolabrine'],
            'nexium': ['nexium', 'nexum', 'nexiom', 'neksium'],
            'zantac': ['zantac', 'zantak', 'zantec', 'zantack'],
            'flagyl': ['flagyl', 'flajil', 'flajel', 'flagil'],
            'concor': ['concor', 'concore', 'konkor'],
            'lipitor': ['lipitor', 'lipitore', 'lepetor'],
            
            // Arabic common mispronunciations
            'بنادول': ['panadol', 'benadol', 'panedol', 'bernardo'],
            'أدفيل': ['advil', 'adfill', 'advile'],
            'بروفين': ['brufen', 'brofen', 'brufin', 'barafin'],
            'أوجمنتين': ['augmentin', 'augmentine', 'ogmentin'],
            'كاتافلام': ['cataflam', 'kataflam', 'katafram'],
            'دوليبران': ['doliprane', 'dolabran', 'dolibran']
        };
        
        // Check for pronunciation variations and replace
        let replaced = false;
        for (const [standard, variations] of Object.entries(pronunciationMap)) {
            for (const variation of variations) {
                if (processed.includes(variation.toLowerCase())) {
                    console.log(`🔄 Replacing "${variation}" → "${standard}"`);
                    processed = processed.replace(
                        new RegExp(variation.toLowerCase(), 'gi'),
                        standard
                    );
                    replaced = true;
                    break;
                }
            }
        }
        
        // Remove common filler words in speech
        const fillerWords = ['the', 'a', 'an', 'this', 'that', 'please', 'um', 'uh', 'tablet', 'tablets', 'mg'];
        processed = processed.split(' ')
            .filter(word => !fillerWords.includes(word))
            .join(' ');
        
        console.log('✅ Preprocessed:', { original: query, processed, replaced });
        
        return processed;
    }

    // ============================================
    // Result Post-processing
    // ============================================
    
    postprocessResults(results, originalQuery) {
        return results.map(result => {
            const item = result.item;
            const score = result.score;
            const matches = result.matches || [];
            
            // Calculate confidence percentage
            const confidence = Math.round((1 - score) * 100);
            
            // Determine match type
            let matchType = 'partial';
            if (score < 0.2) matchType = 'exact';
            else if (score < 0.4) matchType = 'high';
            else if (score < 0.6) matchType = 'medium';
            
            // Check if it's an official price from Egyptian Drug Authority
            const isOfficial = item.isOfficialPrice || item.is_official_price || false;
            
            // Build match details
            const matchDetails = matches.map(m => ({
                key: m.key,
                indices: m.indices,
                value: m.value
            }));
            
            return {
                ...item,
                score,
                confidence,
                matchType,
                isOfficial,
                matchDetails,
                originalQuery,
                // Highlight which part matched
                highlightedTradeName: this.highlightMatches(item.tradeName, matches.filter(m => m.key === 'tradeName')),
                highlightedScientificName: this.highlightMatches(item.scientificName, matches.filter(m => m.key === 'scientificName'))
            };
        });
    }

    highlightMatches(text, matches) {
        if (!text || !matches || matches.length === 0) return text;
        
        let highlighted = text;
        let offset = 0;
        
        // Sort matches by start index (descending) to insert from end
        const sortedMatches = matches
            .flatMap(m => m.indices)
            .sort((a, b) => b[0] - a[0]);
        
        for (const [start, end] of sortedMatches) {
            const before = highlighted.substring(0, start);
            const match = highlighted.substring(start, end + 1);
            const after = highlighted.substring(end + 1);
            
            highlighted = `${before}<mark>${match}</mark>${after}`;
        }
        
        return highlighted;
    }

    // ============================================
    // Smart Correction for Voice Input
    // ============================================
    
    correctVoiceInput(spokenText, options = {}) {
        const {
            autoCorrect = true,
            minConfidence = 70,
            showAlternatives = true
        } = options;
        
        // Search for matches
        const results = this.search(spokenText, { limit: 5 });
        
        if (results.length === 0) {
            return {
                found: false,
                original: spokenText,
                message: 'لا توجد نتائج مطابقة'
            };
        }
        
        const bestMatch = results[0];
        
        // If confidence is high enough, auto-correct
        if (autoCorrect && bestMatch.confidence >= minConfidence) {
            return {
                found: true,
                corrected: true,
                original: spokenText,
                result: bestMatch,
                alternatives: showAlternatives ? results.slice(1, 4) : [],
                message: `تم تصحيح "${spokenText}" إلى "${bestMatch.tradeName}"`
            };
        }
        
        // Return best match but don't auto-correct
        return {
            found: true,
            corrected: false,
            original: spokenText,
            result: bestMatch,
            alternatives: results.slice(1, 4),
            message: `هل تقصد: "${bestMatch.tradeName}"؟`
        };
    }

    // Batch correction for multiple voice inputs
    batchCorrect(voiceInputs) {
        return voiceInputs.map(input => ({
            original: input,
            ...this.correctVoiceInput(input)
        }));
    }

    // ============================================
    // Advanced Search Features
    // ============================================
    
    searchByPriceRange(minPrice, maxPrice, options = {}) {
        // Filter by price then search
        const filtered = this.medicines.filter(m => {
            const price = parseFloat(m.price) || 0;
            return price >= minPrice && price <= maxPrice;
        });
        
        if (options.query) {
            // Create temporary fuse with filtered list
            const tempFuse = new Fuse(filtered, this.config);
            const results = tempFuse.search(options.query, { limit: options.limit || 10 });
            return results.map(r => ({ ...r.item, score: r.score }));
        }
        
        return filtered;
    }

    searchByCompany(companyName, options = {}) {
        const filtered = this.medicines.filter(m => 
            m.company?.toLowerCase().includes(companyName.toLowerCase())
        );
        
        if (options.query) {
            const tempFuse = new Fuse(filtered, this.config);
            const results = tempFuse.search(options.query, { limit: options.limit || 10 });
            return results.map(r => ({ ...r.item, score: r.score }));
        }
        
        return filtered;
    }

    getSuggestions(partialQuery, limit = 5) {
        if (!partialQuery || partialQuery.length < 2) return [];
        
        return this.search(partialQuery, { 
            limit,
            threshold: 0.5  // More lenient for suggestions
        });
    }

    // ============================================
    // History & Analytics
    // ============================================
    
    addToHistory(query, results) {
        this.searchHistory.push({
            query,
            resultCount: results.length,
            topResult: results[0]?.tradeName || null,
            timestamp: new Date()
        });
        
        // Keep only last N searches
        if (this.searchHistory.length > this.maxHistorySize) {
            this.searchHistory.shift();
        }
    }

    getSearchHistory() {
        return this.searchHistory;
    }

    getPopularSearches() {
        const counts = {};
        this.searchHistory.forEach(h => {
            const key = h.topResult || h.query;
            counts[key] = (counts[key] || 0) + 1;
        });
        
        return Object.entries(counts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10);
    }

    // ============================================
    // Statistics & Info
    // ============================================
    
    getStats() {
        const total = this.medicines.length;
        const withOfficialPrice = this.medicines.filter(m => 
            m.isOfficialPrice || m.is_official_price
        ).length;
        const withPrice = this.medicines.filter(m => 
            (parseFloat(m.price) || 0) > 0
        ).length;
        
        const companies = [...new Set(this.medicines.map(m => m.company).filter(Boolean))];
        
        return {
            total,
            withOfficialPrice,
            withPrice,
            companyCount: companies.length,
            indexed: this.fuse !== null
        };
    }

    // ============================================
    // Export/Import
    // ============================================
    
    exportIndex() {
        return {
            medicines: this.medicines,
            config: this.config,
            timestamp: new Date().toISOString()
        };
    }

    importIndex(data) {
        if (data.medicines) {
            this.medicines = data.medicines;
        }
        if (data.config) {
            this.config = { ...this.config, ...data.config };
        }
        return this.initialize(this.medicines);
    }
}

// ============================================
// Export for use
// ============================================

if (typeof module !== 'undefined' && module.exports) {
    module.exports = FuseMedicineSearch;
} else {
    window.FuseMedicineSearch = FuseMedicineSearch;
}

console.log('✅ FuseMedicineSearch loaded - Fuzzy search ready');
