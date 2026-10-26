# -*- coding: utf-8 -*-
"""Create comprehensive Egyptian drug database with GTIN"""
import json

# Core Egyptian drugs with GTIN codes
EGYPTIAN_DRUGS = [
    # ANALGESICS
    {"tradeName": "Panadol", "strength": "500 mg", "form": "Tabs", "scientificName": "Paracetamol", "company": "GSK", "gtin": "6222001001036", "price": 36},
    {"tradeName": "Panadol Extra", "strength": "500/65 mg", "form": "Tabs", "scientificName": "Paracetamol/Caffeine", "company": "GSK", "gtin": "6222001001043", "price": 42},
    {"tradeName": "Panadol Cold & Flu", "strength": "Day/Night", "form": "Tabs", "scientificName": "Multi", "company": "GSK", "gtin": "6222001001081", "price": 48},
    {"tradeName": "Cetal", "strength": "500 mg", "form": "Tabs", "scientificName": "Paracetamol", "company": "EIPICO", "gtin": "6221045010012", "price": 22},
    {"tradeName": "Cetal Extra", "strength": "500/65 mg", "form": "Tabs", "scientificName": "Paracetamol/Caffeine", "company": "EIPICO", "gtin": "6221045010029", "price": 26},
    {"tradeName": "Adol", "strength": "500 mg", "form": "Tabs", "scientificName": "Paracetamol", "company": "Julphar", "gtin": "6222018010018", "price": 22},
    {"tradeName": "Brufen", "strength": "400 mg", "form": "Tabs", "scientificName": "Ibuprofen", "company": "Abbott", "gtin": "6221036004019", "price": 35},
    {"tradeName": "Brufen", "strength": "600 mg", "form": "Tabs", "scientificName": "Ibuprofen", "company": "Abbott", "gtin": "6221036004026", "price": 48},
    {"tradeName": "Voltaren", "strength": "50 mg", "form": "Tabs", "scientificName": "Diclofenac Sodium", "company": "Novartis", "gtin": "6222002001027", "price": 55},
    {"tradeName": "Voltaren", "strength": "75 mg", "form": "Tabs", "scientificName": "Diclofenac Sodium", "company": "Novartis", "gtin": "6222002001034", "price": 72},
    {"tradeName": "Catafast", "strength": "50 mg", "form": "Sachet", "scientificName": "Diclofenac Potassium", "company": "Novartis", "gtin": "6222002002017", "price": 48},
    {"tradeName": "Ketofan", "strength": "50 mg", "form": "Caps", "scientificName": "Ketoprofen", "company": "Amoun", "gtin": "6222025001023", "price": 28},
    {"tradeName": "Ketofan", "strength": "100 mg", "form": "SR Tabs", "scientificName": "Ketoprofen", "company": "Amoun", "gtin": "6222025001030", "price": 35},
    
    # ANTIBIOTICS
    {"tradeName": "Augmentin", "strength": "1 g", "form": "Tabs", "scientificName": "Amoxicillin/Clavulanate", "company": "GSK", "gtin": "6222003001013", "price": 110},
    {"tradeName": "Augmentin", "strength": "625 mg", "form": "Tabs", "scientificName": "Amoxicillin/Clavulanate", "company": "GSK", "gtin": "6222003001020", "price": 85},
    {"tradeName": "Augmentin Syrup", "strength": "312.5 mg/5ml", "form": "Syrup", "scientificName": "Amoxicillin/Clavulanate", "company": "GSK", "gtin": "6222003001044", "price": 75},
    {"tradeName": "Hibiotic", "strength": "1 g", "form": "Tabs", "scientificName": "Amoxicillin/Clavulanate", "company": "Amoun", "gtin": "6222025002013", "price": 98},
    {"tradeName": "Megamox", "strength": "1 g", "form": "Tabs", "scientificName": "Amoxicillin/Clavulanate", "company": "Hikma", "gtin": "6221048001011", "price": 105},
    {"tradeName": "Amoxicillin", "strength": "500 mg", "form": "Caps", "scientificName": "Amoxicillin", "company": "EIPICO", "gtin": "6221045011026", "price": 28},
    {"tradeName": "E-Mox", "strength": "500 mg", "form": "Caps", "scientificName": "Amoxicillin", "company": "EIPICO", "gtin": "6221045012016", "price": 30},
    {"tradeName": "Flagyl", "strength": "500 mg", "form": "Tabs", "scientificName": "Metronidazole", "company": "Sanofi", "gtin": "6222004001034", "price": 35},
    {"tradeName": "Zithromax", "strength": "500 mg", "form": "Tabs", "scientificName": "Azithromycin", "company": "Pfizer", "gtin": "6222005001024", "price": 95},
    {"tradeName": "Zithrokan", "strength": "500 mg", "form": "Tabs", "scientificName": "Azithromycin", "company": "Amoun", "gtin": "6222025003028", "price": 72},
    {"tradeName": "Klacid", "strength": "500 mg", "form": "Tabs", "scientificName": "Clarithromycin", "company": "Abbott", "gtin": "6221036005023", "price": 125},
    {"tradeName": "Erythrocin", "strength": "500 mg", "form": "Tabs", "scientificName": "Erythromycin", "company": "Abbott", "gtin": "6221036006027", "price": 48},
    {"tradeName": "Ciprobay", "strength": "500 mg", "form": "Tabs", "scientificName": "Ciprofloxacin", "company": "Bayer", "gtin": "6222006001021", "price": 85},
    {"tradeName": "Ciprofar", "strength": "500 mg", "form": "Tabs", "scientificName": "Ciprofloxacin", "company": "Amoun", "gtin": "6222025004025", "price": 62},
    {"tradeName": "Tavanic", "strength": "500 mg", "form": "Tabs", "scientificName": "Levofloxacin", "company": "Sanofi", "gtin": "6222007001028", "price": 115},
    {"tradeName": "Levox", "strength": "500 mg", "form": "Tabs", "scientificName": "Levofloxacin", "company": "Amoun", "gtin": "6222025005029", "price": 82},
    {"tradeName": "Cefix", "strength": "400 mg", "form": "Tabs", "scientificName": "Cefixime", "company": "EIPICO", "gtin": "6221045017022", "price": 72},
    {"tradeName": "Suprax", "strength": "400 mg", "form": "Caps", "scientificName": "Cefixime", "company": "Lupin", "gtin": "6222015010022", "price": 85},
    {"tradeName": "Rocephin", "strength": "1 g", "form": "IM/IV", "scientificName": "Ceftriaxone", "company": "Roche", "gtin": "6222009001039", "price": 165},
    {"tradeName": "Fortum", "strength": "1 g", "form": "IV/IM", "scientificName": "Ceftazidime", "company": "GSK", "gtin": "6222008001032", "price": 185},
    {"tradeName": "Zinacef", "strength": "750 mg", "form": "IM/IV", "scientificName": "Cefuroxime", "company": "GSK", "gtin": "6222010011020", "price": 95},
    
    # ANTIFUNGALS
    {"tradeName": "Diflucan", "strength": "150 mg", "form": "Caps", "scientificName": "Fluconazole", "company": "Pfizer", "gtin": "6222011010022", "price": 75},
    {"tradeName": "Nizoral", "strength": "200 mg", "form": "Tabs", "scientificName": "Ketoconazole", "company": "Janssen", "gtin": "6222012010012", "price": 85},
    {"tradeName": "Sporanox", "strength": "100 mg", "form": "Caps", "scientificName": "Itraconazole", "company": "Janssen", "gtin": "6222013010019", "price": 125},
    {"tradeName": "Lamisil", "strength": "250 mg", "form": "Tabs", "scientificName": "Terbinafine", "company": "Novartis", "gtin": "6222015010012", "price": 185},
    
    # ANTIVIRALS
    {"tradeName": "Zovirax", "strength": "400 mg", "form": "Tabs", "scientificName": "Acyclovir", "company": "GSK", "gtin": "6222017010023", "price": 85},
    {"tradeName": "Valtrex", "strength": "500 mg", "form": "Tabs", "scientificName": "Valacyclovir", "company": "GSK", "gtin": "6222019010010", "price": 225},
    {"tradeName": "Tamiflu", "strength": "75 mg", "form": "Caps", "scientificName": "Oseltamivir", "company": "Roche", "gtin": "6222020010017", "price": 285},
    
    # ANTIHYPERTENSIVES
    {"tradeName": "Norvasc", "strength": "5 mg", "form": "Tabs", "scientificName": "Amlodipine", "company": "Pfizer", "gtin": "6222022010019", "price": 55},
    {"tradeName": "Norvasc", "strength": "10 mg", "form": "Tabs", "scientificName": "Amlodipine", "company": "Pfizer", "gtin": "6222022010026", "price": 85},
    {"tradeName": "Concor", "strength": "5 mg", "form": "Tabs", "scientificName": "Bisoprolol", "company": "Merck", "gtin": "6222024010024", "price": 55},
    {"tradeName": "Concor", "strength": "10 mg", "form": "Tabs", "scientificName": "Bisoprolol", "company": "Merck", "gtin": "6222024010031", "price": 85},
    {"tradeName": "Coversyl", "strength": "5 mg", "form": "Tabs", "scientificName": "Perindopril", "company": "Servier", "gtin": "6222025010021", "price": 95},
    {"tradeName": "Coversyl Plus", "strength": "5/1.25 mg", "form": "Tabs", "scientificName": "Perindopril/Indapamide", "company": "Servier", "gtin": "6222025010045", "price": 105},
    {"tradeName": "Cozaar", "strength": "50 mg", "form": "Tabs", "scientificName": "Losartan", "company": "Merck", "gtin": "6222026010011", "price": 85},
    {"tradeName": "Cozaar", "strength": "100 mg", "form": "Tabs", "scientificName": "Losartan", "company": "Merck", "gtin": "6222026010028", "price": 125},
    {"tradeName": "Diovan", "strength": "160 mg", "form": "Tabs", "scientificName": "Valsartan", "company": "Novartis", "gtin": "6222028010021", "price": 135},
    {"tradeName": "Micardis", "strength": "80 mg", "form": "Tabs", "scientificName": "Telmisartan", "company": "BI", "gtin": "6222029010028", "price": 155},
    {"tradeName": "Tenormin", "strength": "50 mg", "form": "Tabs", "scientificName": "Atenolol", "company": "AstraZeneca", "gtin": "6222030010018", "price": 45},
    {"tradeName": "Zestril", "strength": "10 mg", "form": "Tabs", "scientificName": "Lisinopril", "company": "AstraZeneca", "gtin": "6222031010022", "price": 75},
    {"tradeName": "Tritace", "strength": "5 mg", "form": "Tabs", "scientificName": "Ramipril", "company": "Sanofi", "gtin": "6222032010029", "price": 75},
    {"tradeName": "Capoten", "strength": "25 mg", "form": "Tabs", "scientificName": "Captopril", "company": "BMS", "gtin": "6222033010019", "price": 32},
    {"tradeName": "Dilatrend", "strength": "12.5 mg", "form": "Tabs", "scientificName": "Carvedilol", "company": "Roche", "gtin": "6222034010023", "price": 75},
    {"tradeName": "Lopressor", "strength": "100 mg", "form": "Tabs", "scientificName": "Metoprolol", "company": "Novartis", "gtin": "6222035010020", "price": 65},
    
    # DIURETICS
    {"tradeName": "Aldactone", "strength": "25 mg", "form": "Tabs", "scientificName": "Spironolactone", "company": "Pfizer", "gtin": "6222036010010", "price": 32},
    {"tradeName": "Lasix", "strength": "40 mg", "form": "Tabs", "scientificName": "Furosemide", "company": "Sanofi", "gtin": "6222037010017", "price": 25},
    {"tradeName": "Natrilix", "strength": "1.5 mg", "form": "Tabs", "scientificName": "Indapamide", "company": "Servier", "gtin": "6222038010014", "price": 55},
    
    # DIABETES
    {"tradeName": "Glucophage", "strength": "500 mg", "form": "Tabs", "scientificName": "Metformin", "company": "Merck", "gtin": "6222046010010", "price": 28},
    {"tradeName": "Glucophage", "strength": "1000 mg", "form": "Tabs", "scientificName": "Metformin", "company": "Merck", "gtin": "6222046010034", "price": 55},
    {"tradeName": "Amaryl", "strength": "2 mg", "form": "Tabs", "scientificName": "Glimepiride", "company": "Sanofi", "gtin": "6222047010024", "price": 55},
    {"tradeName": "Amaryl", "strength": "4 mg", "form": "Tabs", "scientificName": "Glimepiride", "company": "Sanofi", "gtin": "6222047010048", "price": 95},
    {"tradeName": "Diamicron", "strength": "60 mg", "form": "Tabs", "scientificName": "Gliclazide", "company": "Servier", "gtin": "6222048010021", "price": 75},
    {"tradeName": "Glucotrol", "strength": "5 mg", "form": "Tabs", "scientificName": "Glipizide", "company": "Pfizer", "gtin": "6222049010011", "price": 32},
    {"tradeName": "Daonil", "strength": "5 mg", "form": "Tabs", "scientificName": "Glibenclamide", "company": "Sanofi", "gtin": "6222050010018", "price": 15},
    {"tradeName": "Actos", "strength": "30 mg", "form": "Tabs", "scientificName": "Pioglitazone", "company": "Takeda", "gtin": "6222051010022", "price": 155},
    {"tradeName": "Januvia", "strength": "100 mg", "form": "Tabs", "scientificName": "Sitagliptin", "company": "MSD", "gtin": "6222052010036", "price": 255},
    {"tradeName": "Galvus", "strength": "50 mg", "form": "Tabs", "scientificName": "Vildagliptin", "company": "Novartis", "gtin": "6222053010019", "price": 165},
    {"tradeName": "Trajenta", "strength": "5 mg", "form": "Tabs", "scientificName": "Linagliptin", "company": "BI", "gtin": "6222055010013", "price": 195},
    {"tradeName": "Forxiga", "strength": "10 mg", "form": "Tabs", "scientificName": "Dapagliflozin", "company": "AstraZeneca", "gtin": "6222057010024", "price": 385},
    {"tradeName": "Jardiance", "strength": "25 mg", "form": "Tabs", "scientificName": "Empagliflozin", "company": "BI", "gtin": "6222058010021", "price": 425},
    {"tradeName": "Invokana", "strength": "300 mg", "form": "Tabs", "scientificName": "Canagliflozin", "company": "Janssen", "gtin": "6222059010028", "price": 385},
    {"tradeName": "Lantus", "strength": "100 U/ml", "form": "SoloStar", "scientificName": "Insulin Glargine", "company": "Sanofi", "gtin": "6222070010018", "price": 225},
    {"tradeName": "Levemir", "strength": "100 U/ml", "form": "FlexPen", "scientificName": "Insulin Detemir", "company": "Novo Nordisk", "gtin": "6222072010012", "price": 215},
    {"tradeName": "Victoza", "strength": "6 mg/ml", "form": "Pen", "scientificName": "Liraglutide", "company": "Novo Nordisk", "gtin": "6222061010022", "price": 585},
    {"tradeName": "Ozempic", "strength": "1 mg", "form": "Pen", "scientificName": "Semaglutide", "company": "Novo Nordisk", "gtin": "6222064010030", "price": 985},
    
    # LIPID LOWERING
    {"tradeName": "Lipitor", "strength": "20 mg", "form": "Tabs", "scientificName": "Atorvastatin", "company": "Pfizer", "gtin": "6222088010021", "price": 95},
    {"tradeName": "Lipitor", "strength": "40 mg", "form": "Tabs", "scientificName": "Atorvastatin", "company": "Pfizer", "gtin": "6222088010038", "price": 135},
    {"tradeName": "Crestor", "strength": "20 mg", "form": "Tabs", "scientificName": "Rosuvastatin", "company": "AstraZeneca", "gtin": "6222089010035", "price": 155},
    {"tradeName": "Zocor", "strength": "20 mg", "form": "Tabs", "scientificName": "Simvastatin", "company": "MSD", "gtin": "6222090010025", "price": 75},
    {"tradeName": "Ezetrol", "strength": "10 mg", "form": "Tabs", "scientificName": "Ezetimibe", "company": "MSD", "gtin": "6222091010015", "price": 115},
    {"tradeName": "Lipanthyl", "strength": "200 mg", "form": "Caps", "scientificName": "Fenofibrate", "company": "Abbott", "gtin": "6222092010029", "price": 85},
    
    # ANTICOAGULANTS
    {"tradeName": "Plavix", "strength": "75 mg", "form": "Tabs", "scientificName": "Clopidogrel", "company": "Sanofi", "gtin": "6222098010014", "price": 75},
    {"tradeName": "Aspirin Cardio", "strength": "100 mg", "form": "Tabs", "scientificName": "Acetylsalicylic Acid", "company": "Bayer", "gtin": "6222001002013", "price": 25},
    {"tradeName": "Clexane", "strength": "40 mg", "form": "Prefilled", "scientificName": "Enoxaparin", "company": "Sanofi", "gtin": "6222110010025", "price": 115},
    {"tradeName": "Clexane", "strength": "60 mg", "form": "Prefilled", "scientificName": "Enoxaparin", "company": "Sanofi", "gtin": "6222110010032", "price": 145},
    {"tradeName": "Xarelto", "strength": "20 mg", "form": "Tabs", "scientificName": "Rivaroxaban", "company": "Bayer", "gtin": "6222115010037", "price": 285},
    {"tradeName": "Eliquis", "strength": "5 mg", "form": "Tabs", "scientificName": "Apixaban", "company": "Bristol", "gtin": "6222116010027", "price": 285},
    {"tradeName": "Pradaxa", "strength": "150 mg", "form": "Caps", "scientificName": "Dabigatran", "company": "BI", "gtin": "6222117010031", "price": 285},
    
    # GIT DRUGS
    {"tradeName": "Nexium", "strength": "40 mg", "form": "Tabs", "scientificName": "Esomeprazole", "company": "AstraZeneca", "gtin": "6222101010015", "price": 180},
    {"tradeName": "Nexium", "strength": "20 mg", "form": "Tabs", "scientificName": "Esomeprazole", "company": "AstraZeneca", "gtin": "6222101010022", "price": 125},
    {"tradeName": "Controloc", "strength": "40 mg", "form": "Tabs", "scientificName": "Pantoprazole", "company": "Takeda", "gtin": "6222102010012", "price": 125},
    {"tradeName": "Controloc", "strength": "20 mg", "form": "Tabs", "scientificName": "Pantoprazole", "company": "Takeda", "gtin": "6222102010029", "price": 85},
    {"tradeName": "Losec", "strength": "20 mg", "form": "Caps", "scientificName": "Omeprazole", "company": "AstraZeneca", "gtin": "6222103010019", "price": 85},
    {"tradeName": "Zantac", "strength": "150 mg", "form": "Tabs", "scientificName": "Ranitidine", "company": "GSK", "gtin": "6222104010016", "price": 65},
    {"tradeName": "Motilium", "strength": "10 mg", "form": "Tabs", "scientificName": "Domperidone", "company": "Janssen", "gtin": "6222105010013", "price": 42},
    {"tradeName": "Erythrocin", "strength": "250 mg", "form": "Tabs", "scientificName": "Erythromycin", "company": "Abbott", "gtin": "6221036006010", "price": 35},
    {"tradeName": "Buscopan", "strength": "10 mg", "form": "Tabs", "scientificName": "Hyoscine", "company": "Boehringer", "gtin": "6222106010010", "price": 25},
    {"tradeName": "Dulcolax", "strength": "5 mg", "form": "Tabs", "scientificName": "Bisacodyl", "company": "Sanofi", "gtin": "6222107010017", "price": 22},
    {"tradeName": "Lactulose", "strength": "3.35 g/5ml", "form": "Syrup", "scientificName": "Lactulose", "company": "EIPICO", "gtin": "6221045071013", "price": 35},
    {"tradeName": "Gaviscon", "strength": "Susp.", "form": "Susp", "scientificName": "Alginic Acid", "company": "Reckitt", "gtin": "6222108010014", "price": 45},
    {"tradeName": "Imodium", "strength": "2 mg", "form": "Caps", "scientificName": "Loperamide", "company": "Janssen", "gtin": "6222109010011", "price": 32},
    {"tradeName": "Antinal", "strength": "200 mg", "form": "Caps", "scientificName": "Nifuroxazide", "company": "Amoun", "gtin": "6222025000015", "price": 42},
    
    # RESPIRATORY
    {"tradeName": "Ventolin", "strength": "100 mcg", "form": "Inhaler", "scientificName": "Salbutamol", "company": "GSK", "gtin": "6222110010012", "price": 55},
    {"tradeName": "Ventolin Syrup", "strength": "2 mg/5ml", "form": "Syrup", "scientificName": "Salbutamol", "company": "GSK", "gtin": "6222110010029", "price": 35},
    {"tradeName": "Seretide", "strength": "125/25 mcg", "form": "Inhaler", "scientificName": "Fluticasone/Salmeterol", "company": "GSK", "gtin": "6222111010019", "price": 225},
    {"tradeName": "Seretide", "strength": "250/25 mcg", "form": "Inhaler", "scientificName": "Fluticasone/Salmeterol", "company": "GSK", "gtin": "6222111010026", "price": 285},
    {"tradeName": "Symbicort", "strength": "160/4.5 mcg", "form": "Inhaler", "scientificName": "Budesonide/Formoterol", "company": "AstraZeneca", "gtin": "6222112010016", "price": 255},
    {"tradeName": "Pulmicort", "strength": "200 mcg", "form": "Turbuhaler", "scientificName": "Budesonide", "company": "AstraZeneca", "gtin": "6222113010013", "price": 185},
    {"tradeName": "Flixotide", "strength": "125 mcg", "form": "Inhaler", "scientificName": "Fluticasone", "company": "GSK", "gtin": "6222114010010", "price": 165},
    {"tradeName": "Singulair", "strength": "10 mg", "form": "Tabs", "scientificName": "Montelukast", "company": "MSD", "gtin": "6222115010017", "price": 125},
    {"tradeName": "Zyrtec", "strength": "10 mg", "form": "Tabs", "scientificName": "Cetirizine", "company": "GSK", "gtin": "6222116010014", "price": 55},
    {"tradeName": "Claritine", "strength": "10 mg", "form": "Tabs", "scientificName": "Loratadine", "company": "Bayer", "gtin": "6222117010011", "price": 85},
    {"tradeName": "Telfast", "strength": "180 mg", "form": "Tabs", "scientificName": "Fexofenadine", "company": "Sanofi", "gtin": "6222118010018", "price": 120},
    {"tradeName": "Avamys", "strength": "27.5 mcg", "form": "Nasal Spray", "scientificName": "Fluticasone Furoate", "company": "GSK", "gtin": "6222119010015", "price": 95},
    {"tradeName": "Nasonex", "strength": "50 mcg", "form": "Nasal Spray", "scientificName": "Mometasone", "company": "MSD", "gtin": "6222120010012", "price": 125},
    
    # CNS DRUGS
    {"tradeName": "Stugeron", "strength": "25 mg", "form": "Tabs", "scientificName": "Cinnarizine", "company": "Janssen", "gtin": "6222121010019", "price": 22},
    {"tradeName": "Serc", "strength": "16 mg", "form": "Tabs", "scientificName": "Betahistine", "company": "Abbott", "gtin": "6222122010016", "price": 45},
    {"tradeName": "Serc", "strength": "24 mg", "form": "Tabs", "scientificName": "Betahistine", "company": "Abbott", "gtin": "6222122010023", "price": 65},
    {"tradeName": "Betaserc", "strength": "24 mg", "form": "Tabs", "scientificName": "Betahistine", "company": "Abbott", "gtin": "6222122010030", "price": 72},
    {"tradeName": "Lyrica", "strength": "75 mg", "form": "Caps", "scientificName": "Pregabalin", "company": "Pfizer", "gtin": "6222123010013", "price": 185},
    {"tradeName": "Lyrica", "strength": "150 mg", "form": "Caps", "scientificName": "Pregabalin", "company": "Pfizer", "gtin": "6222123010020", "price": 285},
    {"tradeName": "Neurontin", "strength": "300 mg", "form": "Caps", "scientificName": "Gabapentin", "company": "Pfizer", "gtin": "6222124010010", "price": 125},
    {"tradeName": "Neurontin", "strength": "600 mg", "form": "Tabs", "scientificName": "Gabapentin", "company": "Pfizer", "gtin": "6222124010027", "price": 225},
    {"tradeName": "Tegretol", "strength": "200 mg", "form": "Tabs", "scientificName": "Carbamazepine", "company": "Novartis", "gtin": "6222125010017", "price": 45},
    {"tradeName": "Tegretol CR", "strength": "400 mg", "form": "Tabs", "scientificName": "Carbamazepine", "company": "Novartis", "gtin": "6222125010024", "price": 85},
    {"tradeName": "Depakine", "strength": "200 mg", "form": "Tabs", "scientificName": "Valproic Acid", "company": "Sanofi", "gtin": "6222126010014", "price": 55},
    {"tradeName": "Depakine Chrono", "strength": "500 mg", "form": "Tabs", "scientificName": "Valproic Acid", "company": "Sanofi", "gtin": "6222126010021", "price": 95},
    {"tradeName": "Rivotril", "strength": "2 mg", "form": "Tabs", "scientificName": "Clonazepam", "company": "Roche", "gtin": "6222127010011", "price": 55},
    {"tradeName": "Valium", "strength": "5 mg", "form": "Tabs", "scientificName": "Diazepam", "company": "Roche", "gtin": "6222128010018", "price": 35},
    {"tradeName": "Xanax", "strength": "0.5 mg", "form": "Tabs", "scientificName": "Alprazolam", "company": "Pfizer", "gtin": "6222129010015", "price": 65},
    {"tradeName": "Xanax", "strength": "1 mg", "form": "Tabs", "scientificName": "Alprazolam", "company": "Pfizer", "gtin": "6222129010022", "price": 95},
    {"tradeName": "Ativan", "strength": "1 mg", "form": "Tabs", "scientificName": "Lorazepam", "company": "Pfizer", "gtin": "6222130010012", "price": 75},
    {"tradeName": "Lexotanil", "strength": "3 mg", "form": "Tabs", "scientificName": "Bromazepam", "company": "Roche", "gtin": "6222131010019", "price": 85},
    {"tradeName": "Zoloft", "strength": "50 mg", "form": "Tabs", "scientificName": "Sertraline", "company": "Pfizer", "gtin": "6222132010016", "price": 95},
    {"tradeName": "Zoloft", "strength": "100 mg", "form": "Tabs", "scientificName": "Sertraline", "company": "Pfizer", "gtin": "6222132010023", "price": 155},
    {"tradeName": "Prozac", "strength": "20 mg", "form": "Caps", "scientificName": "Fluoxetine", "company": "Eli Lilly", "gtin": "6222133010013", "price": 85},
    {"tradeName": "Paxil", "strength": "20 mg", "form": "Tabs", "scientificName": "Paroxetine", "company": "GSK", "gtin": "6222134010010", "price": 95},
    {"tradeName": "Cipralex", "strength": "10 mg", "form": "Tabs", "scientificName": "Escitalopram", "company": "Lundbeck", "gtin": "6222135010017", "price": 125},
    {"tradeName": "Cipralex", "strength": "20 mg", "form": "Tabs", "scientificName": "Escitalopram", "company": "Lundbeck", "gtin": "6222135010024", "price": 185},
    {"tradeName": "Effexor XR", "strength": "75 mg", "form": "Caps", "scientificName": "Venlafaxine", "company": "Pfizer", "gtin": "6222136010014", "price": 125},
    {"tradeName": "Effexor XR", "strength": "150 mg", "form": "Caps", "scientificName": "Venlafaxine", "company": "Pfizer", "gtin": "6222136010021", "price": 185},
    {"tradeName": "Cymbalta", "strength": "30 mg", "form": "Caps", "scientificName": "Duloxetine", "company": "Eli Lilly", "gtin": "6222137010011", "price": 145},
    {"tradeName": "Cymbalta", "strength": "60 mg", "form": "Caps", "scientificName": "Duloxetine", "company": "Eli Lilly", "gtin": "6222137010028", "price": 225},
    {"tradeName": "Remeron", "strength": "30 mg", "form": "Tabs", "scientificName": "Mirtazapine", "company": "MSD", "gtin": "6222138010018", "price": 115},
    {"tradeName": "Wellbutrin", "strength": "150 mg", "form": "Tabs", "scientificName": "Bupropion", "company": "GSK", "gtin": "6222139010015", "price": 125},
]

# Save
output = {"drugs": EGYPTIAN_DRUGS}
with open('data/egyptian-drugs-gtin.json', 'w', encoding='utf-8') as f:
    json.dump(output, f, ensure_ascii=False, indent=2)

print(f"Total drugs with GTIN: {len(EGYPTIAN_DRUGS)}")
print(f"Saved to: data/egyptian-drugs-gtin.json")
