// ============================================
// Gemini AI Voice Processor
// AI-Powered First Filter for Drug Recognition
// ============================================

class GeminiVoiceProcessor {
    constructor(config = {}) {
        this.config = {
            apiKey: config.apiKey || localStorage.getItem('gemini_api_key') || '',
            apiEndpoint: config.apiEndpoint || 'https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent',
            confidenceThreshold: config.confidenceThreshold || 0.7,
            maxRetries: config.maxRetries || 3,
            timeout: config.timeout || 5000,
            ...config
        };
        
        this.isAvailable = false;
        this.cache = new Map(); // Cache Gemini results
        this.stats = {
            apiCalls: 0,
            cacheHits: 0,
            avgResponseTime: 0,
            corrections: 0
        };
        
        // Common mispronunciations mapping
        this.commonMispronunciations = {
            'bndol': 'panadol',
            'bendol': 'panadol',
            'benedol': 'panadol',
            'benidorm': 'panadol',
            'bernardo': 'panadol',
            'banadol': 'panadol',
            'ogmentin': 'augmentin',
            'agmentin': 'augmentin',
            'ogmantin': 'augmentin',
            'brofen': 'brufen',
            'broofen': 'brufen',
            'kataflam': 'cataflam',
            'cataflom': 'cataflam',
            'amoxil': 'amoxicillin',
            'amox': 'amoxicillin',
            'kontrex': 'comtrex',
            'ketal': 'cetal',
            'adool': 'adol'
        };
    }
    
    // Check if Gemini API is available
    async checkAvailability() {
        if (!this.config.apiKey) {
            console.warn('⚠️ Gemini API key not configured');
            this.isAvailable = false;
            return false;
        }
        
        try {
            // Quick test call
            const testResult = await this.callGeminiAPI('panadol');
            this.isAvailable = !!testResult;
            console.log(`🤖 Gemini API: ${this.isAvailable ? 'Available' : 'Unavailable'}`);
            return this.isAvailable;
        } catch (error) {
            console.warn('⚠️ Gemini API unavailable:', error.message);
            this.isAvailable = false;
            return false;
        }
    }
    
    // Set API key
    setApiKey(apiKey) {
        this.config.apiKey = apiKey;
        localStorage.setItem('gemini_api_key', apiKey);
        this.checkAvailability();
    }

    // Process voice input through Gemini
    async processVoiceInput(transcripts, availableEntities = [], contextType = 'drug') {
        const startTime = performance.now();
        
        // Ensure transcripts is an array
        if (!Array.isArray(transcripts)) {
            transcripts = [transcripts];
        }
        
        console.log(`🤖 Gemini Processor [Context: ${contextType}] evaluating:`, transcripts);

        // 1. Check cache first
        const cacheKey = `${contextType}:${transcripts[0].toLowerCase().trim()}`;
        if (this.cache.has(cacheKey)) {
            this.stats.cacheHits++;
            return {
                ...this.cache.get(cacheKey),
                fromCache: true,
                responseTime: performance.now() - startTime
            };
        }
        
        // 2. Try local correction (fast path)
        for (const t of transcripts) {
            const local = this.findLocalCorrection(t);
            if (local) {
                const exactMatch = this.findExactMatch(local, availableEntities);
                if (exactMatch) {
                    return {
                        correctedDrug: exactMatch.tradeName || exactMatch.pharmacyName,
                        confidence: 0.95,
                        reasoning: 'Local phonetic mapping matched exactly.',
                        drugData: exactMatch
                    };
                }
            }
        }

        // 3. API Call with Context
        if (!this.config.apiKey) return null;
        
        const result = await this.callGeminiWithContext(transcripts, availableEntities, contextType);
        
        if (result) {
            this.cache.set(cacheKey, result);
            result.responseTime = performance.now() - startTime;
        }
        
        return result;
    }
    
    // Apply local correction based on common mispronunciations
    findLocalCorrection(input) {
        const normalized = input.toLowerCase().trim().replace(/[^a-z]/g, '');
        return this.commonMispronunciations[normalized] || null;
    }
    
    // Find exact match in available entities
    findExactMatch(name, availableEntities) {
        const normalized = name.toLowerCase().trim();
        
        return availableEntities.find(entity => {
            // Check tradeName (for drugs) or pharmacyName (if passed through as tradeName)
            if (entity.tradeName?.toLowerCase() === normalized) return true;
            if (entity.pharmacyName?.toLowerCase() === normalized) return true;
            
            // Check voice aliases
            if (entity.voiceAliases?.some(alias => 
                alias.toLowerCase() === normalized
            )) return true;
            
            return false;
        });
    }

    // Dynamic Prompting based on Context
    getDynamicPrompt(transcripts, entityNames, contextType) {
        const transcriptString = transcripts.map((t, i) => `${i+1}. "${t}"`).join('\n');
        
        if (contextType === 'pharmacy') {
            return `
You are a highly accurate location & entity recognition assistant for an Egyptian Pharmacy Management system.
A user spoke a pharmacy name into the system in English.
The speech recognition software provided several alternative transcripts. Some contain phonetic errors from Egyptian accents.

DATABASE OF REGISTERED PHARMACIES: ${entityNames}

TRANSCRIPTS:
${transcriptString}

YOUR TASK:
1. Identify which pharmacy from the DATABASE the user said.
2. The user is speaking in English, but the pharmacy might be an Egyptian name (e.g. "Seed-alya" for "Pharmacy" or "Ezaby").
3. Focus ONLY on matching names from the database above.
4. Return ONLY a valid JSON object:
{
  "correctedDrug": "exact pharmacy name from database",
  "confidence": 0.0 to 1.0,
  "reasoning": "Explain the phonetic connection."
}
If no reasonable match exists, return null.
`;
        }

        if (contextType === 'portal-order') {
            return `
You are a "Voice Commerce" assistant for a Pharmacy Portal.
The user wants to either SEARCH for a product or ORDER a specific quantity of a product.

DATABASE OF AVAILABLE PRODUCTS: ${entityNames}

TRANSCRIPTS:
${transcriptString}

YOUR TASK:
1. Determine if the user is ordering a SPECIFIC QUANTITY (e.g., "15 Panadol", "Ten Amrizole", "خمستاشر بانادول").
2. Extract the ACTION, the QUANTITY (as a number), and the PRODUCT NAME from the database.
3. If no quantity is mentioned, default to action: "search".
4. Handle numbers in English (Five, Ten, Twenty) and Arabic (واحدة, خمسة, عشرة, خمستاشر, عشرين).
5. Return ONLY a valid JSON object:
{
  "action": "order" | "search",
  "quantity": number,
  "correctedDrug": "exact product name from database",
  "confidence": 0.0 to 1.0,
  "reasoning": "Phonetic connection and intent analysis."
}
If no match exists, return null.
`;
        }

        // Default Drug Prompt
        return `
You are a pharmaceutical expert assistant. A user spoke a drug name in Egypt.
DATABASE OF DRUGS: ${entityNames}
TRANSCRIPTS:
${transcriptString}

YOUR TASK:
1. Identify the drug from the database.
2. Account for phonetic errors (e.g. "Benidorm" -> "Panadol").
3. Return ONLY a valid JSON object:
{
  "correctedDrug": "exact trade name",
  "confidence": 0.0 to 1.0,
  "reasoning": "Reasoning."
}
If no match exists, return null.
`;
    }
    
    // Call Gemini API with contextual prompt
    async callGeminiWithContext(transcripts, entities, contextType) {
        const entityNames = entities.map(e => e.tradeName || e.pharmacyName).join(', ');
        const prompt = this.getDynamicPrompt(transcripts, entityNames, contextType);
        
        try {
            const response = await fetch(`${this.config.apiEndpoint}?key=${this.config.apiKey}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: prompt }] }]
                })
            });
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            
            const data = await response.json();
            
            if (data.candidates && data.candidates[0]?.content?.parts[0]?.text) {
                const text = data.candidates[0].content.parts[0].text;
                
                // Extract JSON from response
                const jsonMatch = text.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                    const result = JSON.parse(jsonMatch[0]);
                    
                    // Verify the drug exists in our database
                    const matchedDrug = availableDrugs.find(d => 
                        d.tradeName.toLowerCase() === result.correctedDrug?.toLowerCase()
                    );
                    
                    if (matchedDrug && result.confidence >= this.config.confidenceThreshold) {
                        this.stats.corrections++;
                        return {
                            correctedDrug: matchedDrug.tradeName,
                            confidence: result.confidence,
                            reasoning: result.reasoning,
                            verifiedBy: 'Gemini AI',
                            drugData: matchedDrug
                        };
                    }
                }
            }
            
            return null;
            
        } catch (error) {
            console.error('Gemini API error:', error);
            throw error;
        }
    }
    
    // Simple Gemini API call (for testing)
    async callGeminiAPI(text) {
        try {
            const response = await fetch(`${this.config.apiEndpoint}?key=${this.config.apiKey}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    contents: [{
                        parts: [{ text: `Echo: ${text}` }]
                    }]
                })
            });
            
            return response.ok;
        } catch (error) {
            return false;
        }
    }
    
    // Fallback fuzzy matching
    fallbackMatching(voiceInput, availableDrugs, startTime) {
        const normalized = voiceInput.toLowerCase().trim();
        
        let bestMatch = null;
        let bestScore = 0;
        
        availableDrugs.forEach(drug => {
            // Check trade name similarity
            const tradeScore = this.calculateSimilarity(normalized, drug.tradeName.toLowerCase());
            
            // Check aliases
            let aliasScore = 0;
            drug.voiceAliases?.forEach(alias => {
                const score = this.calculateSimilarity(normalized, alias.toLowerCase());
                if (score > aliasScore) aliasScore = score;
            });
            
            const maxScore = Math.max(tradeScore, aliasScore);
            
            if (maxScore > bestScore && maxScore >= this.config.confidenceThreshold) {
                bestScore = maxScore;
                bestMatch = drug;
            }
        });
        
        if (bestMatch) {
            return {
                originalInput: voiceInput,
                correctedDrug: bestMatch.tradeName,
                confidence: bestScore,
                reasoning: `Fuzzy match: "${voiceInput}" → "${bestMatch.tradeName}"`,
                verifiedBy: 'Local AI (Fuzzy)',
                drugData: bestMatch,
                responseTime: performance.now() - startTime
            };
        }
        
        return {
            originalInput: voiceInput,
            correctedDrug: null,
            confidence: 0,
            reasoning: 'No matching drug found',
            verifiedBy: 'None',
            responseTime: performance.now() - startTime
        };
    }
    
    // Calculate string similarity
    calculateSimilarity(a, b) {
        if (a === b) return 1;
        if (a.length === 0 || b.length === 0) return 0;
        
        const distance = this.levenshteinDistance(a, b);
        const maxLength = Math.max(a.length, b.length);
        return 1 - (distance / maxLength);
    }
    
    levenshteinDistance(a, b) {
        const matrix = [];
        
        for (let i = 0; i <= b.length; i++) {
            matrix[i] = [i];
        }
        
        for (let j = 0; j <= a.length; j++) {
            matrix[0][j] = j;
        }
        
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
        
        return matrix[b.length][a.length];
    }
    
    // Update statistics
    updateStats(responseTime) {
        const alpha = 0.1;
        this.stats.avgResponseTime = 
            (alpha * responseTime) + ((1 - alpha) * this.stats.avgResponseTime);
    }
    
    // Get statistics
    getStats() {
        return {
            ...this.stats,
            isAvailable: this.isAvailable,
            cacheSize: this.cache.size,
            apiKeyConfigured: !!this.config.apiKey
        };
    }
    
    // Clear cache
    clearCache() {
        this.cache.clear();
        console.log('🧹 Gemini cache cleared');
    }
}

// ============================================
// Export
// ============================================

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { GeminiVoiceProcessor };
}

window.GeminiVoiceProcessor = GeminiVoiceProcessor;

console.log('🤖 Gemini Voice Processor loaded');
console.log('🎯 AI-powered first filter for drug recognition');
