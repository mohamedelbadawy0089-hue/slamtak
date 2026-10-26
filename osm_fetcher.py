import requests
import json
import csv

def fetch_osm_pharmacies():
    print("Fetching pharmacy data from OpenStreetMap (Egypt)...")
    
    # Overpass API Query for pharmacies in Egypt
    overpass_url = "http://overpass-api.de/api/interpreter"
    overpass_query = """
    [out:json][timeout:90];
    area["name:en"="Egypt"]->.searchArea;
    (
      node["amenity"="pharmacy"](area.searchArea);
      way["amenity"="pharmacy"](area.searchArea);
      rel["amenity"="pharmacy"](area.searchArea);
    );
    out center;
    """
    
    try:
        response = requests.post(overpass_url, data={'data': overpass_query})
        data = response.json()
        
        pharmacies = []
        for element in data.get('elements', []):
            tags = element.get('tags', {})
            name = tags.get('name', tags.get('name:en', 'صيدلية غير مسمى'))
            addr_street = tags.get('addr:street', '')
            addr_city = tags.get('addr:city', '')
            addr_gov = tags.get('addr:state', tags.get('addr:province', 'غير محدد'))
            phone = tags.get('phone', tags.get('contact:phone', ''))
            
            lat = element.get('lat', element.get('center', {}).get('lat'))
            lng = element.get('lon', element.get('center', {}).get('lon'))
            
            pharmacies.append({
                "name": name,
                "governorate": addr_gov,
                "city": addr_city,
                "district": "منطقة عامة",
                "address": addr_street or f"موقع GPS: {lat},{lng}",
                "phone": phone,
                "location_url": f"https://www.google.com/maps?q={lat},{lng}" if lat and lng else "",
                "district_id": "OSM-IMPORT"
            })
            
        print(f"Successfully fetched {len(pharmacies)} records from OSM.")
        return pharmacies
        
    except Exception as e:
        print(f"Error fetching from OSM: {e}")
        return []

def save_to_csv(data, filename="egypt_pharmacies_osm.csv"):
    if not data: return
    keys = data[0].keys()
    with open(filename, 'w', newline='', encoding='utf-8-sig') as output_file:
        dict_writer = csv.DictWriter(output_file, fieldnames=keys)
        dict_writer.writeheader()
        dict_writer.writerows(data)
    print(f"Saved to {filename}")

if __name__ == "__main__":
    osm_data = fetch_osm_pharmacies()
    save_to_csv(osm_data)
