// Script to append missing functions to voice-input.js
const fs = require('fs');

// Read the current file
const filePath = 'voice-input.js';
let content = fs.readFileSync(filePath, 'utf8');

// Check if functions already exist
if (content.includes('correctMedicineName')) {
  console.log('Functions already exist in the file');
  process.exit(0);
}

// Find the end of the VoiceInputProcessor class (before CSS styles)
const cssMarker = '// إضافة أنماط CSS للرسائل المتحركة';
const splitIndex = content.lastIndexOf(cssMarker);

if (splitIndex === -1) {
  console.log('Could not find the CSS marker in the file');
  process.exit(1);
}

// Split the content
const jsPart = content.substring(0, splitIndex);
const cssPart = content.substring(splitIndex);

// Add the missing functions before the CSS
const newFunctions = `
    // تصحيح اسم الدواء باستخدام قائمة أدوية معروفة
    correctMedicineName(name) {
        const medicineNames = [
            'Paracetamol', 'Ibuprofen', 'Aspirin', 'Amoxicillin', 'Metformin',
            'Lisinopril', 'Atorvastatin', 'Omeprazole', 'Albuterol', 'Prednisone',
            'Metoprolol', 'Simvastatin', 'Losartan', 'Gabapentin', 'Sertraline',
            'Levothyroxine', 'Warfarin', 'Citalopram', 'Furosemide', 'Hydrochlorothiazide',
            'Amlodipine', 'Hydrocodone', 'Tramadol', 'Pantoprazole', 'Doxycycline',
            'Azithromycin', 'Ciprofloxacin', 'Clindamycin', 'Diazepam', 'Oxycodone',
            'Morphine', 'Codeine', 'Acetaminophen', 'Diclofenac', 'Naproxen',
            'Celecoxib', 'Etanercept', 'Infliximab', 'Adalimumab', 'Certolizumab',
            'Rituximab', 'Abatacept', 'Tocilizumab', 'Anakinra', 'Canakinumab',
            'Colchicine', 'Probenecid', 'Allopurinol', 'Febuxostat', 'Benzbromarone',
            'Probenecid', 'Sulfasalazine', 'Mesalamine', 'Balsalazide', 'Olsalazine',
            'Dapsone', 'Sulfapyridine', 'Sulfamethoxazole', 'Trimethoprim', 'Pyrazinamide',
            'Ethambutol', 'Isoniazid', 'Rifampin', 'Rifabutin', 'Rifapentine',
            'Bedaquiline', 'Delamanid', 'Linezolid', 'Clofazimine', 'Cycloserine',
            'Terizidone', 'Streptomycin', 'Amikacin', 'Kanamycin', 'Capreomycin',
            'Viagra', 'Cialis', 'Levitra', 'Stendra', 'Staxyn', 'Spedra',
            'Adderall', 'Ritalin', 'Concerta', 'Vyvanse', 'Focalin', 'Strattera',
            'Intuniv', 'Kapvay', 'Tenex', 'Catapres', 'Aldomet', 'Methyldopa',
            'Clonidine', 'Guanfacine', 'Reserpine', 'Minoxidil', 'Diazoxide',
            'Hydralazine', 'Isosorbide', 'Nitroglycerin', 'Amyl nitrite', 'Nitroprusside',
            'Epoprostenol', 'Treprostinil', 'Iloprost', 'Beraprost', 'Selexipag',
            'Macitentan', 'Bosentan', 'Ambrisentan', 'Sitaxsentan', 'Sildenafil',
            'Tadalafil', 'Vardenafil', 'Avanafil', 'Phentolamine', 'Yohimbine',
            'Apomorphine', 'Cabergoline', 'Pramipexole', 'Ropinirole', 'Rotigotine',
            'Piribedil', 'Bromocriptine', 'Pergolide', 'Lisuride', 'Carbidopa',
            'Entacapone', 'Tolcapone', 'Safinamide', 'Opicapone', 'Monoamine',
            'Selegiline', 'Rasagiline', 'Safinamide', 'Amantadine', 'Memantine',
            'Donepezil', 'Galantamine', 'Rivastigmine', 'Tacrine', 'Huperzine',
            'Propentofylline', 'Nicergoline', 'Xanomeline', 'Citicoline', 'Piracetam',
            'Oxiracetam', 'Pramiracetam', 'Aniracetam', 'Fasoracetam', 'Phenylpiracetam',
            'Levetiracetam', 'Brivaracetam', 'Perampanel', 'Topiramate', 'Zonisamide',
            'Acetazolamide', 'Methazolamide', 'Dichlorphenamide', 'Ethoxzolamide', 'Methicillin',
            'Nafcillin', 'Oxacillin', 'Cloxacillin', 'Dicloxacillin', 'Flucloxacillin',
            'Penicillin G', 'Penicillin V', 'Procaine', 'Benzathine', 'Methicillin',
            'Cloxacillin', 'Ticarcillin', 'Piperacillin', 'Mezlocillin', 'Azlocillin'
        ];
        
        const threshold = 0.7; // حد التشابه المطلوب
        let bestMatch = name;
        let highestSimilarity = 0;
        
        for (const med of medicineNames) {
            const similarity = this.stringSimilarity(name.toLowerCase(), med.toLowerCase());
            if (similarity > threshold && similarity > highestSimilarity) {
                bestMatch = med;
                highestSimilarity = similarity;
            }
        }
        
        if (highestSimilarity > 0) {
            console.log(\`💊 تم تصحيح اسم الدواء: \${name} → \${bestMatch} (تشابه: \${(highestSimilarity * 100).toFixed(1)}%)\`);
            return bestMatch;
        }
        
        return name;
    }

    // حساب تشابه النصوص باستخدام مسافة ليفنشتاين
    stringSimilarity(str1, str2) {
        const longer = str1.length > str2.length ? str1 : str2;
        const shorter = str1.length > str2.length ? str2 : str1;
        if (longer.length === 0) return 1.0;
        const editDistance = this.levenshteinDistance(longer, shorter);
        return (longer.length - editDistance) / longer.length;
    }

    // حساب مسافة ليفنشتاين بين نصين
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
                if (b.charAt(i-1) === a.charAt(j-1)) {
                    matrix[i][j] = matrix[i-1][j-1];
                } else {
                    matrix[i][j] = Math.min(
                        matrix[i-1][j-1] + 1, // استبدال
                        matrix[i][j-1] + 1,    // إضافة
                        matrix[i-1][j] + 1     // حذف
                    );
                }
            }
        }
        return matrix[b.length][a.length];
    }
`;

// Combine everything
const newContent = jsPart + newFunctions + cssPart;

// Write the updated content back to the file
fs.writeFileSync(filePath, newContent, 'utf8');

console.log('Functions successfully appended to voice-input.js');