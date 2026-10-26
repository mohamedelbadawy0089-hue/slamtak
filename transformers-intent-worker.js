/**
 * Transformers.js Intent Classification Web Worker
 * Offloads AI model processing from main thread
 * 
 * Features:
 * - Loads Xenova/distilbert-base-uncased-finetuned-sst-2-english model
 * - Classifies pharmacy-related intents from voice input
 * - Communicates with main thread via postMessage
 * - Runs completely offline after initial model load
 */

// Global variables
let classifier = null;
let modelLoaded = false;
let intentCache = new Map(); // Cache for faster repeated queries

// Intent Categories for Pharmacy System
const INTENT_CATEGORIES = {
    ADD_PRODUCT: 'add_product',         // إضافة منتج/دواء
    UPDATE_QUANTITY: 'update_quantity', // تحديث الكمية
    SEARCH_PRODUCT: 'search_product',   // البحث عن منتج
    DELETE_PRODUCT: 'delete_product',   // حذف منتج
    SHOW_INVENTORY: 'show_inventory',   // عرض المخزون
    CHECK_EXPIRY: 'check_expiry',       // فحص الصلاحية
    UNKNOWN: 'unknown'                  // غير معروف
};

// Intent training phrases (simple pattern matching fallback)
const INTENT_PATTERNS = {
    [INTENT_CATEGORIES.ADD_PRODUCT]: [
        'add', 'new', 'product', 'medicine', 'drug', 'أضف', 'جديد', 'منتج', 'دواء',
        'حط', 'ضيف', 'إضافة', 'ادخل', 'سجل', 'احفظ'
    ],
    [INTENT_CATEGORIES.UPDATE_QUANTITY]: [
        'update', 'quantity', 'stock', 'amount', 'كمية', 'تحديث', 'زيادة', 'نقص',
        'غير', 'عدل', 'تعديل'
    ],
    [INTENT_CATEGORIES.SEARCH_PRODUCT]: [
        'search', 'find', 'lookup', 'where', 'search for', 'ابحث', 'دور', 'فين',
        'وين', 'لقى', 'هلقيت', 'ابحث عن'
    ],
    [INTENT_CATEGORIES.DELETE_PRODUCT]: [
        'delete', 'remove', 'clear', 'حذف', 'شيل', 'امسح', 'نقل', 'شطب'
    ],
    [INTENT_CATEGORIES.SHOW_INVENTORY]: [
        'show', 'inventory', 'list', 'display', 'view', 'show me', 'عرض', 'استعرض',
        'وريني', 'أرني', 'قائمة', 'كل المنتجات'
    ],
    [INTENT_CATEGORIES.CHECK_EXPIRY]: [
        'expiry', 'expired', 'expiration', 'date', 'check expiry', 'صلاحية', 'منتهي',
        'انتهى', 'تاريخ', 'فحص'
    ]
};

/**
 * Initialize Transformers.js and load the model
 */
async function initializeModel() {
    try {
        self.postMessage({ type: 'status', message: 'Loading Transformers.js...' });
        
        // Dynamically import Transformers.js from CDN
        importScripts('https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2/dist/transformers.min.js');
        
        self.postMessage({ type: 'status', message: 'Loading DistilBERT model...' });
        
        // Configure Transformers.js to use local cache
        const { pipeline, env } = self.transformers;
        
        // Set cache directory to IndexedDB for offline persistence
        env.allowLocalModels = true;
        env.useBrowserCache = true;
        
        // Create a text classification pipeline
        // Using a small, fast model suitable for intent classification
        classifier = await pipeline(
            'text-classification',
            'Xenova/distilbert-base-uncased-finetuned-sst-2-english',
            { 
                quantized: true, // Use quantized model for faster inference
                revision: 'main',
                cache_dir: 'indexeddb://transformers-cache'
            }
        );
        
        modelLoaded = true;
        self.postMessage({ type: 'ready', message: 'Model loaded successfully' });
        
    } catch (error) {
        console.error('Failed to load model:', error);
        self.postMessage({ 
            type: 'error', 
            message: 'Model load failed, using fallback mode',
            error: error.message 
        });
        // Continue in fallback mode with pattern matching
        modelLoaded = false;
    }
}

/**
 * Classify intent using the model or fallback patterns
 */
async function classifyIntent(text) {
    // Check cache first
    const cached = intentCache.get(text.toLowerCase());
    if (cached) {
        return cached;
    }
    
    let result;
    
    if (modelLoaded && classifier) {
        try {
            // Use the AI model
            const modelResult = await classifier(text);
            result = interpretModelResult(modelResult, text);
        } catch (error) {
            console.error('Model inference failed:', error);
            result = fallbackIntentClassification(text);
        }
    } else {
        // Use pattern matching fallback
        result = fallbackIntentClassification(text);
    }
    
    // Cache the result
    intentCache.set(text.toLowerCase(), result);
    
    return result;
}

/**
 * Interpret model output and map to pharmacy intents
 */
function interpretModelResult(modelResult, originalText) {
    // Model returns sentiment (POSITIVE/NEGATIVE)
    // We need to map this to pharmacy intents using keyword analysis
    const text = originalText.toLowerCase();
    
    // Extract additional features for intent classification
    const hasAddKeywords = /\b(add|new|put|save|enter|ضيف|أضف|جديد|حط|سجل|احفظ|ادخل)\b/i.test(text);
    const hasUpdateKeywords = /\b(update|change|modify|edit|غير|عدل|تحديث|زود|نقص)\b/i.test(text);
    const hasSearchKeywords = /\b(search|find|look|where|ابحث|دور|فين|وين|لقى)\b/i.test(text);
    const hasDeleteKeywords = /\b(delete|remove|clear|حذف|شيل|امسح|نقل|شطب)\b/i.test(text);
    const hasShowKeywords = /\b(show|display|list|view|عرض|استعرض|وريني|قائمة)\b/i.test(text);
    const hasExpiryKeywords = /\b(expir|date|valid|صلاحية|منتهي|تاريخ|انتهى)\b/i.test(text);
    
    // Determine intent based on keyword presence
    let intent = INTENT_CATEGORIES.UNKNOWN;
    let confidence = 0.5;
    
    if (hasAddKeywords) {
        intent = INTENT_CATEGORIES.ADD_PRODUCT;
        confidence = 0.85;
    } else if (hasUpdateKeywords) {
        intent = INTENT_CATEGORIES.UPDATE_QUANTITY;
        confidence = 0.80;
    } else if (hasSearchKeywords) {
        intent = INTENT_CATEGORIES.SEARCH_PRODUCT;
        confidence = 0.80;
    } else if (hasDeleteKeywords) {
        intent = INTENT_CATEGORIES.DELETE_PRODUCT;
        confidence = 0.85;
    } else if (hasShowKeywords) {
        intent = INTENT_CATEGORIES.SHOW_INVENTORY;
        confidence = 0.75;
    } else if (hasExpiryKeywords) {
        intent = INTENT_CATEGORIES.CHECK_EXPIRY;
        confidence = 0.80;
    }
    
    // Adjust confidence based on model sentiment
    if (modelResult && modelResult[0]) {
        const sentiment = modelResult[0].label;
        const sentimentScore = modelResult[0].score;
        
        // If model is confident and sentiment is positive, boost confidence
        if (sentiment === 'POSITIVE' && sentimentScore > 0.8) {
            confidence = Math.min(confidence + 0.1, 0.95);
        }
    }
    
    return {
        intent,
        confidence,
        originalText,
        modelOutput: modelResult,
        timestamp: Date.now()
    };
}

/**
 * Fallback intent classification using pattern matching
 */
function fallbackIntentClassification(text) {
    const lowerText = text.toLowerCase();
    let bestIntent = INTENT_CATEGORIES.UNKNOWN;
    let bestScore = 0;
    
    // Score each intent category
    for (const [intent, patterns] of Object.entries(INTENT_PATTERNS)) {
        let score = 0;
        for (const pattern of patterns) {
            if (lowerText.includes(pattern.toLowerCase())) {
                score += 1;
            }
        }
        
        // Normalize by pattern count
        const normalizedScore = score / patterns.length;
        
        if (normalizedScore > bestScore) {
            bestScore = normalizedScore;
            bestIntent = intent;
        }
    }
    
    // Require minimum threshold
    if (bestScore < 0.1) {
        bestIntent = INTENT_CATEGORIES.UNKNOWN;
    }
    
    return {
        intent: bestIntent,
        confidence: Math.min(bestScore * 2, 0.9), // Scale up but cap at 0.9
        originalText: text,
        modelOutput: null,
        fallback: true,
        timestamp: Date.now()
    };
}

/**
 * Extract entities from text (quantities, drug names, etc.)
 */
function extractEntities(text) {
    const entities = {
        quantity: null,
        drugName: null,
        price: null,
        dates: []
    };
    
    // Extract numbers (quantities)
    const numberMatches = text.match(/\b(\d+)\b/g);
    if (numberMatches) {
        entities.quantity = parseInt(numberMatches[0]);
    }
    
    // Extract Arabic numbers
    const arabicNumbers = {
        'صفر': 0, 'واحد': 1, 'واحدة': 1, 'اثنان': 2, 'اثنين': 2,
        'ثلاثة': 3, 'ثلاث': 3, 'أربعة': 4, 'أربع': 4,
        'خمسة': 5, 'خمس': 5, 'ستة': 6, 'ست': 6,
        'سبعة': 7, 'سبع': 7, 'ثمانية': 8, 'ثمان': 8,
        'تسعة': 9, 'تسع': 9, 'عشرة': 10, 'عشر': 10,
        'عشرين': 20, 'ثلاثين': 30, 'أربعين': 40,
        'خمسين': 50, 'مئة': 100, 'مية': 100, 'ألف': 1000
    };
    
    for (const [word, num] of Object.entries(arabicNumbers)) {
        if (text.includes(word)) {
            entities.quantity = num;
            break;
        }
    }
    
    // Extract price patterns
    const priceMatch = text.match(/(\d+(?:\.\d+)?)\s*(جنيه|ج|egp|pound|price|بسعر|سعر)/i);
    if (priceMatch) {
        entities.price = parseFloat(priceMatch[1]);
    }
    
    // Extract potential drug names (capitalized words in English)
    const drugNameMatch = text.match(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\b/);
    if (drugNameMatch) {
        entities.drugName = drugNameMatch[1];
    }
    
    // Extract dates (simple patterns)
    const dateMatches = text.match(/\b(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})\b/g);
    if (dateMatches) {
        entities.dates = dateMatches;
    }
    
    return entities;
}

/**
 * Main message handler
 */
self.onmessage = async function(e) {
    const { type, payload, id } = e.data;
    
    switch (type) {
        case 'initialize':
            await initializeModel();
            break;
            
        case 'classify':
            const text = payload.text;
            const intent = await classifyIntent(text);
            const entities = extractEntities(text);
            
            self.postMessage({
                type: 'classification',
                id,
                result: {
                    intent,
                    entities,
                    processingTime: Date.now() - intent.timestamp
                }
            });
            break;
            
        case 'classify-batch':
            const texts = payload.texts;
            const results = [];
            
            for (const t of texts) {
                const intentResult = await classifyIntent(t);
                const entitiesResult = extractEntities(t);
                results.push({
                    text: t,
                    intent: intentResult,
                    entities: entitiesResult
                });
            }
            
            self.postMessage({
                type: 'classification-batch',
                id,
                results
            });
            break;
            
        case 'clear-cache':
            intentCache.clear();
            self.postMessage({ type: 'status', message: 'Cache cleared' });
            break;
            
        case 'ping':
            self.postMessage({ 
                type: 'pong', 
                modelLoaded,
                cacheSize: intentCache.size 
            });
            break;
            
        default:
            self.postMessage({ 
                type: 'error', 
                message: `Unknown command: ${type}` 
            });
    }
};

// Auto-initialize when worker starts
self.postMessage({ type: 'status', message: 'Worker started, initializing...' });
initializeModel();
