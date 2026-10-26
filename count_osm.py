import requests
import json

def check_count():
    q = '[out:json]; (node["amenity"="pharmacy"](22.0,24.0,32.0,37.0); way["amenity"="pharmacy"](22.0,24.0,32.0,37.0); rel["amenity"="pharmacy"](22.0,24.0,32.0,37.0);); out count;'
    r = requests.post('https://overpass-api.de/api/interpreter', data={'data': q})
    print(r.json())

check_count()
