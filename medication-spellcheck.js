// Enhanced Medication Spell Check Module with RxNav API Integration
// Provides automatic spell checking and correction for medication names

class MedicationSpellChecker {
    constructor() {
        this.cache = new Map();
        this.cacheTimeout = 5 * 60 * 1000; // 5 minutes cache
        this.retryAttempts = 3;
        this.retryDelay = 1000; // 1 second
        
        // Common medication misspellings and corrections
        this.commonCorrections = {
            'panadol': 'panadol',
            'paracitamol': 'paracetamol',
            'paracitamal': 'paracetamol',
            'paracitomal': 'paracetamol',
            'ibuprofen': 'ibuprofen',
            'ibuprophen': 'ibuprofen',
            'advil': 'advil',
            'tylenol': 'tylenol',
            'aspirin': 'aspirin',
            'asprin': 'aspirin',
            'amoxicillin': 'amoxicillin',
            'amoxycillin': 'amoxicillin',
            'augmentin': 'augmentin',
            'voltaren': 'voltaren',
            'diclofenac': 'diclofenac',
            'diclofanac': 'diclofenac',
            'ketofan': 'ketofan',
            'ketoprofen': 'ketoprofen',
            'cataflam': 'cataflam',
            'concor': 'concor',
            'bisoprolol': 'bisoprolol',
            'exforge': 'exforge',
            'amlodipine': 'amlodipine',
            'omega3': 'omega-3',
            'omega 3': 'omega-3',
            'centrum': 'centrum',
            'vitamax': 'vitamax',
            'kerovit': 'kerovit',
            'claritin': 'claritin',
            'zyrtec': 'zyrtec',
            'cetrizine': 'cetirizine',
            'cetirizine': 'cetirizine',
            'telfast': 'telfast'
        };
    }

    // Main spell checking function with multiple fallback strategies
    async checkSpelling(medicationName) {
        if (!medicationName || typeof medicationName !== 'string') {
            return medicationName;
        }

        const cleanName = medicationName.trim().toLowerCase();
        
        // Check cache first
        const cached = this.getFromCache(cleanName);
        if (cached) {
            console.log('📦 Using cached result for:', cleanName);
            return cached;
        }

        // Strategy 1: Common corrections dictionary
        const localCorrection = this.checkLocalDictionary(cleanName);
        if (localCorrection) {
            this.setCache(cleanName, localCorrection);
            return localCorrection;
        }

        // Strategy 2: RxNav API with retry logic
        try {
            const rxnavResult = await this.checkWithRxNav(medicationName);
            if (rxnavResult && rxnavResult !== medicationName) {
                this.setCache(cleanName, rxnavResult);
                return rxnavResult;
            }
        } catch (error) {
            console.warn('⚠️ RxNav API failed:', error.message);
        }

        // Strategy 3: Fuzzy matching with local database
        const fuzzyMatch = this.fuzzyMatch(cleanName);
        if (fuzzyMatch) {
            this.setCache(cleanName, fuzzyMatch);
            return fuzzyMatch;
        }

        // Strategy 4: Return original if no corrections found
        this.setCache(cleanName, medicationName);
        return medicationName;
    }

    // Check against local dictionary of common corrections
    checkLocalDictionary(name) {
        return this.commonCorrections[name] || null;
    }

    // Enhanced RxNav API integration with retry logic and better error handling
    async checkWithRxNav(medicationName, attempt = 1) {
        try {
            console.log(`🔍 Checking RxNav API (attempt ${attempt}):`, medicationName);
            
            // First try spell check
            const spellCheckUrl = `https://rxnav.nlm.nih.gov/REST/spellcheck?name=${encodeURIComponent(medicationName)}`;
            const spellResponse = await this.fetchWithTimeout(spellCheckUrl, 5000);
            
            if (!spellResponse.ok) {
                throw new Error(`RxNav API error: ${spellResponse.status}`);
            }
            
            const spellData = await spellResponse.json();
            
            if (spellData.suggestions?.suggestion?.length > 0) {
                const suggestedTerm = spellData.suggestions.suggestion[0].suggestedTerm;
                console.log('✅ RxNav suggested correction:', suggestedTerm);
                
                // Verify the suggestion with approximate match
                const verified = await this.verifyWithApproximateMatch(suggestedTerm);
                return verified || suggestedTerm;
            }

            // If no spell check suggestions, try approximate match directly
            return await this.verifyWithApproximateMatch(medicationName);
            
        } catch (error) {
            console.error(`❌ RxNav API attempt ${attempt} failed:`, error.message);
            
            if (attempt < this.retryAttempts) {
                await this.delay(this.retryDelay * attempt);
                return this.checkWithRxNav(medicationName, attempt + 1);
            }
            
            throw error;
        }
    }

    // Verify medication name using RxNav approximate match API
    async verifyWithApproximateMatch(medicationName) {
        try {
            const approxUrl = `https://rxnav.nlm.nih.gov/REST/approximateMatch?term=${encodeURIComponent(medicationName)}`;
            const approxResponse = await this.fetchWithTimeout(approxUrl, 5000);
            
            if (!approxResponse.ok) {
                return null;
            }
            
            const approxData = await approxResponse.json();
            
            if (approxData.approximateMatch?.candidate?.length > 0) {
                // Get the best match (first result usually has highest score)
                const bestMatch = approxData.approximateMatch.candidate[0];
                if (bestMatch.score > 70) { // Confidence threshold
                    console.log('🎯 RxNav approximate match found:', bestMatch.name);
                    return bestMatch.name;
                }
            }
            
            return null;
        } catch (error) {
            console.warn('⚠️ Approximate match failed:', error.message);
            return null;
        }
    }

    // Fuzzy matching with local medication database
    fuzzyMatch(name) {
        const medications = Object.keys(this.commonCorrections);
        let bestMatch = null;
        let bestScore = 0;
        
        for (const med of medications) {
            const score = this.calculateSimilarity(name, med);
            if (score > bestScore && score > 0.8) { // 80% similarity threshold
                bestScore = score;
                bestMatch = this.commonCorrections[med];
            }
        }
        
        if (bestMatch) {
            console.log('🎯 Fuzzy match found:', bestMatch, '(similarity:', bestScore + ')');
        }
        
        return bestMatch;
    }

    // Calculate string similarity using Levenshtein distance
    calculateSimilarity(str1, str2) {
        const longer = str1.length > str2.length ? str1 : str2;
        const shorter = str1.length > str2.length ? str2 : str1;
        
        if (longer.length === 0) return 1.0;
        
        const distance = this.levenshteinDistance(longer, shorter);
        return (longer.length - distance) / longer.length;
    }

    // Calculate Levenshtein distance between two strings
    levenshteinDistance(str1, str2) {
        const matrix = [];
        
        for (let i = 0; i <= str2.length; i++) {
            matrix[i] = [i];
        }
        
        for (let j = 0; j <= str1.length; j++) {
            matrix[0][j] = j;
        }
        
        for (let i = 1; i <= str2.length; i++) {
            for (let j = 1; j <= str1.length; j++) {
                if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
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
        
        return matrix[str2.length][str1.length];
    }

    // Cache management
    getFromCache(name) {
        const cached = this.cache.get(name);
        if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
            return cached.value;
        }
        this.cache.delete(name);
        return null;
    }

    setCache(name, value) {
        this.cache.set(name, {
            value: value,
            timestamp: Date.now()
        });
    }

    // Helper function for fetch with timeout
    async fetchWithTimeout(url, timeout = 5000) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);
        
        try {
            const response = await fetch(url, {
                signal: controller.signal,
                headers: {
                    'User-Agent': 'MedicationSpellChecker/1.0'
                }
            });
            clearTimeout(timeoutId);
            return response;
        } catch (error) {
            clearTimeout(timeoutId);
            throw error;
        }
    }

    // Helper function for delays
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // Clear cache
    clearCache() {
        this.cache.clear();
        console.log('🗑️ Spell check cache cleared');
    }

    // Get cache statistics
    getCacheStats() {
        return {
            size: this.cache.size,
            timeout: this.cacheTimeout
        };
    }
}

// Global instance
window.MedicationSpellChecker = MedicationSpellChecker;

// Auto-initialize
if (typeof window !== 'undefined') {
    window.medicationSpellChecker = new MedicationSpellChecker();
    console.log('✅ Medication Spell Checker initialized');
}

// Export for Node.js (if needed)
if (typeof module !== 'undefined' && module.exports) {
    module.exports = MedicationSpellChecker;
}
