// تحليل قاعدة بيانات الأدوية المصرية
const fs = require('fs');
const path = require('path');

// قائمة الشركات المصرية المعروفة
const egyptianCompanies = [
    'Amoun', 'EIPICO', 'Pharco', 'Eva Pharma', 'Global Napi', 'Sedico', 
    'Medical Union', 'CID', 'Chemipharm', 'Hikma Egypt', 'Spimaco',
    'Tabuk', 'Sigma', 'Julphar Egypt', 'GlaxoSmithKline Egypt',
    'Novartis Egypt', 'Sanofi Egypt', 'Merck Egypt', 'Bayer Egypt',
    'Pfizer Egypt', 'Abbott Egypt', 'Takeda Egypt', 'AstraZeneca Egypt',
    'Boehringer Ingelheim Egypt', 'Servier Egypt', 'LEO Pharma Egypt',
    'Bristol-Myers Egypt', 'Reckitt Benckiser Egypt', 'Himalaya Egypt',
    'Valeant Egypt', 'Sandoz Egypt'
];

// قائمة الشركات الأجنبية (غير المصرية)
const foreignCompanies = [
    'GSK', 'Novartis', 'Abbott', 'Sanofi', 'Merck', 'Pfizer', 'AstraZeneca',
    'Takeda', 'Bayer', 'Boehringer Ingelheim', 'Servier', 'LEO Pharma',
    'Bristol-Myers', 'Reckitt Benckiser', 'Himalaya', 'Valeant', 'Sandoz',
    'Janssen', 'Julphar', 'Cipla', 'Ranbaxy', 'Dr. Reddy\'s', 'Lupin',
    'Sun Pharma', 'Teva', 'Mylan', 'Actavis', 'Watson', 'Apotex'
];

function analyzeDrugDatabase(filePath) {
    try {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        const drugs = data.drugs || [];
        
        const stats = {
            total: drugs.length,
            egyptian: 0,
            foreign: 0,
            unknown: 0,
            egyptianDrugs: [],
            foreignDrugs: [],
            unknownDrugs: []
        };
        
        drugs.forEach(drug => {
            const company = drug.company || '';
            const tradeName = drug.tradeName || '';
            const scientificName = drug.scientificName || '';
            
            // تحليل الشركة المصنعة
            let companyType = 'unknown';
            
            // التحقق من الشركات المصرية
            if (egyptianCompanies.some(egyptian => 
                company.toLowerCase().includes(egyptian.toLowerCase()) ||
                company.toLowerCase().includes('egypt') ||
                company.toLowerCase().includes('cairo') ||
                company.toLowerCase().includes('alex') ||
                company.toLowerCase().includes('giza'))) {
                companyType = 'egyptian';
            }
            // التحقق من الشركات الأجنبية
            else if (foreignCompanies.some(foreign => 
                company.toLowerCase().includes(foreign.toLowerCase()))) {
                companyType = 'foreign';
            }
            // تحليل إضافي بناءً على اسم الدواء التجاري
            else if (tradeName.match(/^(Cetal|Antinal|Ketofan|Alphintern|Spasmo|Milga|Fludrex|Congestal|Grip|Levostiv|Spasmo-free|Rowatinex|Thiotacid|Urosolvine|Coloverin|Diamicron|Uralyt|Cystone|Maalox|Gaviscon|Primperan|Otrivin|Fucicort|Kenacomb|Beta-val|Tusskan|Bronchicum|Neurobion|Centrum|Zyloric|Lasix|Librax|Night|Day|Flurest|1,2,3|Adol|Abimol|Para-plus|E-Mox|Hibiotic|Megamox|Klavox|Curam|Ambezim|Visceralgine)/i)) {
                companyType = 'egyptian';
            }
            else if (tradeName.match(/^(Panadol|Augmentin|Voltaren|Brufen|Daflon|Concor|Amaryl|Glucophage|Nexium|Controloc|Maxilase|Buscopan|Motilium|Catafast|Cataflam|Zithromax|Telfast|Claritine|Zyrtec|Fucidin|Betnovate|Flagyl|Duspatalin|Coloverin|Uralyt|Rowatinex|Gaviscon|Maalox|Thiotacid|Urosolvine|Cystone|Diamicron|Uralyt|Centrum|Neurobion|Zyloric|Lasix|Librax|Otrivin|Fucicort|Kenacomb|Beta-val|Tusskan|Bronchicum|Primperan|Catafast|Cataflam)/i)) {
                companyType = 'foreign';
            }
            
            // إضافة الدواء للفئة المناسبة
            const drugInfo = {
                tradeName,
                scientificName,
                company,
                price: drug.price || 0,
                category: drug.category || 'Unknown'
            };
            
            if (companyType === 'egyptian') {
                stats.egyptian++;
                stats.egyptianDrugs.push(drugInfo);
            } else if (companyType === 'foreign') {
                stats.foreign++;
                stats.foreignDrugs.push(drugInfo);
            } else {
                stats.unknown++;
                stats.unknownDrugs.push(drugInfo);
            }
        });
        
        return stats;
    } catch (error) {
        console.error(`Error analyzing ${filePath}:`, error.message);
        return null;
    }
}

function analyzeAllDatabases() {
    const dataDir = path.join(__dirname, 'data');
    const databases = [
        'egyptian-master-database.json',
        'eda-drugs.json',
        'master-encyclopedia.json',
        'seifeldeen.json'
    ];
    
    console.log('🔍 تحليل قواعد بيانات الأدوية المصرية...\n');
    
    databases.forEach(dbFile => {
        const filePath = path.join(dataDir, dbFile);
        if (fs.existsSync(filePath)) {
            console.log(`📊 تحليل ${dbFile}:`);
            const stats = analyzeDrugDatabase(filePath);
            
            if (stats) {
                console.log(`   إجمالي الأدوية: ${stats.total}`);
                console.log(`   🇪🇬 أدوية مصرية: ${stats.egyptian} (${((stats.egyptian/stats.total)*100).toFixed(1)}%)`);
                console.log(`   🌍 أدوية أجنبية: ${stats.foreign} (${((stats.foreign/stats.total)*100).toFixed(1)}%)`);
                console.log(`   ❓ غير معروف: ${stats.unknown} (${((stats.unknown/stats.total)*100).toFixed(1)}%)`);
                
                if (stats.egyptianDrugs.length > 0) {
                    console.log('\n   🏭 أمثلة للأدوية المصرية:');
                    stats.egyptianDrugs.slice(0, 5).forEach(drug => {
                        console.log(`      • ${drug.tradeName} (${drug.company}) - ${drug.scientificName}`);
                    });
                }
                
                if (stats.foreignDrugs.length > 0) {
                    console.log('\n   🏢 أمثلة للأدوية الأجنبية:');
                    stats.foreignDrugs.slice(0, 5).forEach(drug => {
                        console.log(`      • ${drug.tradeName} (${drug.company}) - ${drug.scientificName}`);
                    });
                }
                
                if (stats.unknownDrugs.length > 0) {
                    console.log('\n   ❓ أدوية تحتاج تصنيف:');
                    stats.unknownDrugs.slice(0, 3).forEach(drug => {
                        console.log(`      • ${drug.tradeName} (${drug.company})`);
                    });
                }
            }
            console.log('\n' + '='.repeat(60) + '\n');
        } else {
            console.log(`❌ الملف غير موجود: ${dbFile}\n`);
        }
    });
}

// تحليل إضافي للشركات
function analyzeCompanies() {
    const dataDir = path.join(__dirname, 'data');
    const mainDB = path.join(dataDir, 'egyptian-master-database.json');
    
    if (fs.existsSync(mainDB)) {
        const stats = analyzeDrugDatabase(mainDB);
        if (stats) {
            console.log('🏢 تحليل الشركات المصنعة:\n');
            
            // تجميع الشركات المصرية
            const egyptianCompaniesMap = {};
            stats.egyptianDrugs.forEach(drug => {
                if (!egyptianCompaniesMap[drug.company]) {
                    egyptianCompaniesMap[drug.company] = [];
                }
                egyptianCompaniesMap[drug.company].push(drug);
            });
            
            console.log('🇪🇬 الشركات المصرية:');
            Object.entries(egyptianCompaniesMap)
                .sort((a, b) => b[1].length - a[1].length)
                .slice(0, 10)
                .forEach(([company, drugs]) => {
                    console.log(`   ${company}: ${drugs.length} دواء`);
                    drugs.slice(0, 3).forEach(drug => {
                        console.log(`      • ${drug.tradeName} - ${drug.price} جنيه`);
                    });
                });
            
            // تجميع الشركات الأجنبية
            const foreignCompaniesMap = {};
            stats.foreignDrugs.forEach(drug => {
                if (!foreignCompaniesMap[drug.company]) {
                    foreignCompaniesMap[drug.company] = [];
                }
                foreignCompaniesMap[drug.company].push(drug);
            });
            
            console.log('\n🌍 الشركات الأجنبية:');
            Object.entries(foreignCompaniesMap)
                .sort((a, b) => b[1].length - a[1].length)
                .slice(0, 10)
                .forEach(([company, drugs]) => {
                    console.log(`   ${company}: ${drugs.length} دواء`);
                    drugs.slice(0, 3).forEach(drug => {
                        console.log(`      • ${drug.tradeName} - ${drug.price} جنيه`);
                    });
                });
        }
    }
}

// تشغيل التحليل
if (require.main === module) {
    analyzeAllDatabases();
    analyzeCompanies();
}

module.exports = { analyzeDrugDatabase, analyzeAllDatabases, analyzeCompanies };
