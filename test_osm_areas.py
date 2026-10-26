import requests
import json

def test_area(name_ar):
    q = f'[out:json]; area["name:ar"="{name_ar}"]; out;'
    r = requests.post('https://overpass-api.de/api/interpreter', data={'data': q})
    data = r.json()
    for element in data.get('elements', []):
        tags = element.get('tags', {})
        print(f"Name AR: {tags.get('name:ar')}, Name EN: {tags.get('name:en')}, Admin Level: {tags.get('admin_level')}")

test_area("القليوبية")
test_area("القاهرة")
test_area("الجيزة")
