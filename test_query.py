import requests
import json

q = '[out:json]; area["name:en"="Egypt"]->.a; (node["name"~"صيدلية"](area.a); node["name:ar"~"صيدلية"](area.a); node["amenity"="pharmacy"](area.a); node["shop"="pharmacy"](area.a);); out count;'
r = requests.post('https://overpass-api.de/api/interpreter', data={'data': q})
print(r.json())
