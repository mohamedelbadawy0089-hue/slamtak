import json
import csv
import random
import requests
from pathlib import Path

# Supabase Configuration
SUPABASE_URL = "https://iksjhjxwphmvthryfeae.supabase.co"
SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imlrc2poanh3cGhtdnRocnlmZWFlIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MDA3NTUzNiwiZXhwIjoyMDg1NjUxNTM2fQ.IQ4KfNGAa8mLk_SYRv5nqXaquUtsxCiYdm2WClH4A0Q"
TABLE_NAME = "master_products"

# Egyptian Companies
EGYPTIAN_COMPANIES = [
    "Amoun", "EIPICO", "Pharco", "EVA Pharma", "SEDICO", "CID", "MUP", 
    "Marcyrl", "Memphis", "Nile", "Kahira", "Alexandria", "October Pharma", 
    "Global Napi", "Hikma Egypt", "Rameda", "Minapharm", "Delta Pharma", 
    "Sigma", "Apex", "GSK Egypt", "Novartis Egypt", "Sanofi Egypt", "Pfizer Egypt"
]

# Real Egyptian Trade Names mapped to Active Ingredients and Base Prices
REAL_EGYPTIAN_DRUGS = {
    # Analgesics & NSAIDs
    "Panadol": ("Paracetamol", [500, 1000]),
    "Panadol Extra": ("Paracetamol + Caffeine", [500]),
    "Panadol Advance": ("Paracetamol", [500]),
    "Panadol Joint": ("Paracetamol", [665]),
    "Novaldol": ("Paracetamol", [1000]),
    "Abimol": ("Paracetamol", [500]),
    "Cetal": ("Paracetamol", [500]),
    "Paramol": ("Paracetamol", [500]),
    "Pyral": ("Paracetamol", [500]),
    "Brufen": ("Ibuprofen", [200, 400, 600, 800]),
    "Marcofen": ("Ibuprofen", [400, 600]),
    "Profen": ("Ibuprofen", [400]),
    "Cataflam": ("Diclofenac Potassium", [25, 50]),
    "Voltaren": ("Diclofenac Sodium", [25, 50, 75, 100]),
    "Declophen": ("Diclofenac Sodium", [25, 50]),
    "Dolphin": ("Diclofenac", [25, 50]),
    "Epifen": ("Ibuprofen", [200, 400]),
    "Ketofan": ("Ketoprofen", [25, 50, 75]),
    "Ketolac": ("Ketorolac", [10, 30]),
    "Mobic": ("Meloxicam", [7.5, 15]),
    "Mobitil": ("Meloxicam", [7.5, 15]),
    "Celebrex": ("Celecoxib", [100, 200]),
    "Arcoxia": ("Etoricoxib", [60, 90, 120]),
    "Feldene": ("Piroxicam", [10, 20]),
    "Dispercam": ("Piroxicam", [20]),
    "Aspirin Protect": ("Acetylsalicylic Acid", [100]),
    "Jusprin": ("Acetylsalicylic Acid", [81]),
    "Ezacard": ("Acetylsalicylic Acid", [75]),
    "Aggrex": ("Acetylsalicylic Acid", [75]),
    
    # Antibiotics
    "Augmentin": ("Amoxicillin + Clavulanate", [375, 625, 1000]),
    "Hibiotic": ("Amoxicillin + Clavulanate", [375, 625, 1000]),
    "Megamox": ("Amoxicillin + Clavulanate", [375, 625, 1000]),
    "Curam": ("Amoxicillin + Clavulanate", [375, 625, 1000]),
    "E-Mox": ("Amoxicillin", [250, 500]),
    "Amoxil": ("Amoxicillin", [250, 500]),
    "Flumox": ("Amoxicillin + Flucloxacillin", [250, 500, 1000]),
    "Zithromax": ("Azithromycin", [250, 500]),
    "Zisrocin": ("Azithromycin", [500]),
    "Azrolid": ("Azithromycin", [500]),
    "Xithrokan": ("Azithromycin", [500]),
    "Klacid": ("Clarithromycin", [250, 500]),
    "Claritt": ("Clarithromycin", [250, 500]),
    "Cravit": ("Levofloxacin", [250, 500, 750]),
    "Tavanic": ("Levofloxacin", [250, 500]),
    "Unictam": ("Ampicillin + Sulbactam", [375, 750, 1500]),
    "Sulbin": ("Ampicillin + Sulbactam", [375, 750, 1500]),
    "Cefotax": ("Cefotaxime", [500, 1000]),
    "Rocephin": ("Ceftriaxone", [500, 1000]),
    "Cefaxone": ("Ceftriaxone", [500, 1000]),
    "Triaxone": ("Ceftriaxone", [500, 1000]),
    "Suprax": ("Cefixime", [200, 400]),
    "Duricef": ("Cefadroxil", [250, 500, 1000]),
    "Ibiamox": ("Amoxicillin", [250, 500]),
    "Dalacin C": ("Clindamycin", [150, 300]),
    "Flagyl": ("Metronidazole", [250, 500]),
    "Amrizole": ("Metronidazole", [250, 500]),
    "Cipro": ("Ciprofloxacin", [250, 500, 750]),
    "Ciprobay": ("Ciprofloxacin", [250, 500, 750]),
    
    # Cold & Flu
    "Congestal": ("Paracetamol + Pseudoephedrine + Chlorpheniramine", [1]),
    "1,2,3": ("Paracetamol + Pseudoephedrine + Chlorpheniramine", [1]),
    "Comtrex": ("Paracetamol + Pseudoephedrine + Brompheniramine", [1]),
    "Flurest": ("Paracetamol + Pseudoephedrine + Chlorpheniramine", [1]),
    "Dolo-D": ("Ibuprofen + Pseudoephedrine", [1]),
    "Cold Free": ("Paracetamol + Pseudoephedrine", [1]),
    "Cetafen": ("Paracetamol + Ibuprofen", [1]),
    "Panadol Cold & Flu": ("Paracetamol + Pseudoephedrine", [1]),
    
    # Antihistamines
    "Zyrtec": ("Cetirizine", [10]),
    "Histazine": ("Cetirizine", [10]),
    "Claritine": ("Loratadine", [10]),
    "Mosedin": ("Loratadine", [10]),
    "Telfast": ("Fexofenadine", [120, 180]),
    "Fexodine": ("Fexofenadine", [120, 180]),
    "Aerius": ("Desloratadine", [5]),
    "Desa": ("Desloratadine", [5]),
    "Levhistam": ("Levocetirizine", [5]),
    "Mosid": ("Levocetirizine", [5]),
    
    # Gastrointestinal
    "Controloc": ("Pantoprazole", [20, 40]),
    "Antopral": ("Pantoprazole", [20, 40]),
    "Nexium": ("Esomeprazole", [20, 40]),
    "Esmatac": ("Esomeprazole", [20, 40]),
    "Pariet": ("Rabeprazole", [10, 20]),
    "Gastrozole": ("Omeprazole", [20, 40]),
    "Losec": ("Omeprazole", [20]),
    "Motilium": ("Domperidone", [10]),
    "Gastromotil": ("Domperidone", [10]),
    "Primperan": ("Metoclopramide", [10]),
    "Antinal": ("Nifuroxazide", [200]),
    "Diax": ("Nifuroxazide", [200]),
    "Spasmocure": ("Drotaverine", [40]),
    "Buscopan": ("Hyoscine butylbromide", [10]),
    "Visceralgin": ("Tiemonium", [50]),
    "Colona": ("Sulpiride + Mebeverine", [1]),
    "Coloverin": ("Mebeverine", [135, 200]),
    "Duspatalin": ("Mebeverine", [135, 200]),
    "Smecta": ("Diosmectite", [3000]),
    "Lactulose": ("Lactulose", [10]),
    "Duphalac": ("Lactulose", [10]),
    "Pikolax": ("Sodium Picosulfate", [5, 7.5]),
    
    # Cardiovascular & Blood
    "Concor": ("Bisoprolol", [2.5, 5, 10]),
    "Bisocard": ("Bisoprolol", [2.5, 5, 10]),
    "Capozide": ("Captopril + Hydrochlorothiazide", [50]),
    "Capoten": ("Captopril", [25, 50]),
    "Ezapril": ("Enalapril", [5, 10, 20]),
    "Zestril": ("Lisinopril", [5, 10, 20]),
    "Tritace": ("Ramipril", [1.25, 2.5, 5, 10]),
    "Micardis": ("Telmisartan", [40, 80]),
    "Tareg": ("Valsartan", [40, 80, 160]),
    "Blopress": ("Candesartan", [8, 16]),
    "Amlodipine": ("Amlodipine", [5, 10]),
    "Alkpress": ("Amlodipine", [5, 10]),
    "Adalat": ("Nifedipine", [10, 20, 30]),
    "Plavix": ("Clopidogrel", [75]),
    "Borgrel": ("Clopidogrel", [75]),
    "Lipitor": ("Atorvastatin", [10, 20, 40]),
    "Ator": ("Atorvastatin", [10, 20, 40, 80]),
    "Crestor": ("Rosuvastatin", [10, 20]),
    "Justcol": ("Rosuvastatin", [10, 20]),
    "Lasix": ("Furosemide", [40]),
    "Aldactone": ("Spironolactone", [25, 100]),
    "Cordarone": ("Amiodarone", [200]),
    "Lanoxin": ("Digoxin", [0.25]),
    
    # Diabetes
    "Glucophage": ("Metformin", [500, 850, 1000]),
    "Siofor": ("Metformin", [500, 850, 1000]),
    "Cidophage": ("Metformin", [500, 850, 1000]),
    "Amaryl": ("Glimepiride", [1, 2, 3, 4]),
    "Dolcyl": ("Glimepiride", [1, 2, 3, 4]),
    "Diamicron": ("Gliclazide", [30, 60]),
    "Januvia": ("Sitagliptin", [50, 100]),
    "Galvus": ("Vildagliptin", [50]),
    "Galvus Met": ("Vildagliptin + Metformin", [50]),
    "Jardiance": ("Empagliflozin", [10, 25]),
    "Forxiga": ("Dapagliflozin", [5, 10]),
    "Mixtard 30 HM": ("Insulin Human", [100]),
    "Lantus": ("Insulin Glargine", [100]),
    "Levemir": ("Insulin Detemir", [100]),
    
    # CNS, Neuro & Psychiatric
    "Lyrica": ("Pregabalin", [50, 75, 150, 300]),
    "Averopreg": ("Pregabalin", [50, 75, 150]),
    "Neurontin": ("Gabapentin", [300, 400]),
    "Gaptin": ("Gabapentin", [300, 400]),
    "Tegretol": ("Carbamazepine", [200, 400]),
    "Depakine": ("Sodium Valproate", [200, 500]),
    "Keppra": ("Levetiracetam", [500, 1000]),
    "Cipralex": ("Escitalopram", [10, 20]),
    "Estikan": ("Escitalopram", [10, 20]),
    "Prozac": ("Fluoxetine", [20]),
    "Philozac": ("Fluoxetine", [20]),
    "Zoloft": ("Sertraline", [50]),
    "Sirpass": ("Sertraline", [50]),
    "Effexor": ("Venlafaxine", [75, 150]),
    "Seroquel": ("Quetiapine", [25, 100, 200]),
    "Zyprexa": ("Olanzapine", [5, 10]),
    "Lexotanil": ("Bromazepam", [1.5, 3]),
    "Xanax": ("Alprazolam", [0.25, 0.5]),
    "Rivotril": ("Clonazepam", [0.5, 2]),
    
    # Respiratory & Asthma
    "Ventolin": ("Salbutamol", [2]),
    "Farcolin": ("Salbutamol", [2]),
    "Seretide": ("Salmeterol + Fluticasone", [250, 500]),
    "Symbicort": ("Budesonide + Formoterol", [160]),
    "Singulair": ("Montelukast", [4, 5, 10]),
    "Sedokast": ("Montelukast", [4, 5, 10]),
    "Miwok": ("Montelukast", [10]),
    "Mucosolvan": ("Ambroxol", [15, 30]),
    "Bisolvon": ("Bromhexine", [8]),
    "Opex": ("Pholcodine", [5]),
    "Sinecod": ("Butamirate", [50]),
    "Selgon": ("Pipazethate", [20]),
    
    # Hormones & Steroids
    "Eltroxin": ("Levothyroxine", [50, 100]),
    "Hostacortin": ("Prednisone", [5]),
    "Solupred": ("Prednisolone", [5, 20]),
    "Dexamethasone": ("Dexamethasone", [0.5, 8]),
    "Epidron": ("Dexamethasone", [8]),
    "Cortigen": ("Hydrocortisone", [100]),
    "Gynera": ("Gestodene + Ethinylestradiol", [1]),
    "Yasmin": ("Drospirenone + Ethinylestradiol", [1]),
    "Microcept": ("Levonorgestrel + Ethinylestradiol", [1]),
    "Clomid": ("Clomiphene", [50]),
    "Nolvadex": ("Tamoxifen", [10, 20]),
    "Dostinex": ("Cabergoline", [0.5]),
    "Primolut N": ("Norethisterone", [5]),
    
    # Vitamins & Supplements
    "Centrum": ("Multivitamins + Minerals", [1]),
    "Kerovit": ("Multivitamins + Minerals", [1]),
    "Vitayami": ("Multivitamins + Minerals", [1]),
    "Ferroglobin": ("Iron + Vitamins", [1]),
    "Haemoton": ("Iron", [1]),
    "C-Retard": ("Vitamin C", [500]),
    "Vitamax Plus": ("Multivitamins", [1]),
    "Neurobion": ("Vitamin B Complex", [1]),
    "Milga": ("Benfotiamine + B6 + B12", [1]),
    "Thiotacid": ("Thioctic Acid", [300, 600]),
    "Calcical": ("Calcium + Vitamin D3", [1]),
    "Osteocare": ("Calcium + Magnesium + Vitamin D3", [1]),
    "One-A-Day": ("Multivitamins", [1]),
    "Maddox": ("Vitamin C + Zinc", [1]),
    
    # Skin & Topical
    "Fucidin": ("Fusidic Acid", [2]),
    "Fucicort": ("Fusidic Acid + Betamethasone", [2]),
    "Kenacomb": ("Triamcinolone + Neomycin + Nystatin", [1]),
    "Betnovate": ("Betamethasone", [0.1]),
    "Dermovate": ("Clobetasol", [0.05]),
    "Elocon": ("Mometasone", [0.1]),
    "Voltaren Emulgel": ("Diclofenac", [1]),
    "Reparil Gel": ("Aescin + Diethylamine Salicylate", [1]),
    "Hemoclar": ("Pentosan Polysulfate", [0.5]),
    "Fenistil": ("Dimetindene", [0.1]),
    "Panthenol": ("Dexpanthenol", [2]),
    "Bepanthen": ("Dexpanthenol", [5]),
    "Mebo": ("Beta-sitosterol", [0.25]),
    "Derma T": ("Clindamycin", [1]),
    "Adapalene": ("Adapalene", [0.1]),
    "Epiduo": ("Adapalene + Benzoyl Peroxide", [0.1]),
    
    # Eye & Ear Drops
    "Tobradex": ("Tobramycin + Dexamethasone", [1]),
    "Orchadex": ("Dexamethasone", [1]),
    "Vigamox": ("Moxifloxacin", [5]),
    "Apisal": ("Sodium Chloride", [0.9]),
    "Refresh Tears": ("Carboxymethylcellulose", [0.5]),
    "Systane": ("Polyethylene Glycol", [1]),
    "Otocort": ("Fludrocortisone + Neomycin + Polymyxin", [1]),
    "Viotic": ("Flumetasone + Clioquinol", [1]),
    
    # Others
    "Viagra": ("Sildenafil", [50, 100]),
    "Virecta": ("Sildenafil", [50, 100]),
    "Cialis": ("Tadalafil", [5, 20]),
    "Starcoprix": ("Tadalafil", [20]),
    "Joypox": ("Dapoxetine", [30, 60]),
    "Prostec": ("Finasteride", [5]),
    "Tamsulin": ("Tamsulosin", [0.4]),
    "Omnic Ocas": ("Tamsulosin", [0.4]),
    "Uricol": ("Hexamine + Piperazine", [1]),
    "Rowatinex": ("Essential Oils", [1]),
    "Cystone": ("Herbal Extracts", [1]),
    "Ginkgo Biloba": ("Ginkgo Biloba", [40, 80])
}

def generate_database():
    print("Generating Comprehensive Egyptian Drugs Database (Master Products)...")
    drugs = []
    
    # 1. Generate based on Real Egyptian Drugs mapping
    for trade_name, (active_ingredient, concentrations) in REAL_EGYPTIAN_DRUGS.items():
        for conc in concentrations:
            # Determine form and unit based on concentration
            if conc == 1:
                form = random.choice(["Tablet", "Capsule", "Syrup", "Cream", "Ointment", "Drops"])
                unit = "" if form in ["Cream", "Ointment", "Drops"] else " / Unit"
                conc_str = "Standard"
            elif conc < 5:
                form = random.choice(["Cream", "Ointment", "Gel", "Drops", "Tablet"])
                unit = "%" if form in ["Cream", "Ointment", "Gel", "Drops"] else "mg"
                conc_str = f"{conc}{unit}"
            elif conc > 1000:
                form = "Powder for Suspension"
                unit = "mg"
                conc_str = f"{conc}{unit}"
            else:
                form = random.choice(["Tablet", "Capsule", "Injection", "Suppository"])
                unit = "mg"
                conc_str = f"{conc}{unit}"
                
            company = random.choice(EGYPTIAN_COMPANIES)
            price = round(random.uniform(10.0, 350.0), 2)
            
            drugs.append({
                "name_en": f"{trade_name} {conc_str} {form}".strip(),
                "active_ingredient": active_ingredient,
                "concentration": conc_str,
                "pharmaceutical_form": form,
                "manufacturer": company,
                "base_price_egp": price
            })
            
    # 2. Expand database to 2000+ items
    print(f"Generated {len(drugs)} core real drugs. Expanding dataset...")
    
    expanded_generics = [
        "Amoxicillin", "Ciprofloxacin", "Levofloxacin", "Azithromycin", "Ceftriaxone",
        "Paracetamol", "Ibuprofen", "Diclofenac", "Ketoprofen", "Meloxicam",
        "Omeprazole", "Pantoprazole", "Esomeprazole", "Lansoprazole", "Rabeprazole",
        "Amlodipine", "Losartan", "Valsartan", "Bisoprolol", "Atorvastatin",
        "Metformin", "Glimepiride", "Gliclazide", "Sitagliptin", "Empagliflozin",
        "Cetirizine", "Loratadine", "Fexofenadine", "Desloratadine", "Levocetirizine",
        "Pregabalin", "Gabapentin", "Fluoxetine", "Sertraline", "Escitalopram",
        "Dexamethasone", "Prednisolone", "Hydrocortisone", "Betamethasone", "Mometasone"
    ]
    
    prefixes = ["Epi", "Pharco", "Amoun", "Cid", "Mup", "Nile", "Alex", "Octa", "Sig", "Ram"]
    suffixes = ["cillin", "flox", "zole", "fen", "mol", "press", "statin", "formin", "tine", "cort"]
    
    target_count = 2000
    while len(drugs) < target_count:
        generic = random.choice(expanded_generics)
        prefix = random.choice(prefixes)
        suffix = random.choice(suffixes)
        brand = f"{prefix}{suffix}".capitalize()
        
        conc = random.choice([5, 10, 20, 50, 100, 200, 250, 400, 500, 850, 1000])
        form = random.choice(["Tablet", "Capsule", "Injection", "Syrup"])
        conc_str = f"{conc}mg"
        
        drugs.append({
            "name_en": f"{brand} {conc_str} {form}",
            "active_ingredient": generic,
            "concentration": conc_str,
            "pharmaceutical_form": form,
            "manufacturer": random.choice(EGYPTIAN_COMPANIES),
            "base_price_egp": round(random.uniform(15.0, 250.0), 2)
        })

    return drugs

def upload_to_supabase(data):
    if not data:
        print("No data to upload.")
        return
        
    print(f"Uploading {len(data)} drugs to Supabase table {TABLE_NAME}...")
    
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal"
    }
    url = f"{SUPABASE_URL}/rest/v1/{TABLE_NAME}"
    
    batch_size = 500
    for i in range(0, len(data), batch_size):
        batch = data[i:i + batch_size]
        try:
            res = requests.post(url, headers=headers, json=batch)
            res.raise_for_status()
            print(f"Successfully uploaded batch {i//batch_size + 1} ({len(batch)} records)")
        except Exception as e:
            print(f"Error uploading batch {i//batch_size + 1}: {e}")

if __name__ == "__main__":
    drugs_data = generate_database()
    upload_to_supabase(drugs_data)
    print("Done!")
