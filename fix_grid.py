import sys
import io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

with open('c:/Users/My PC/Desktop/slamtak/stock.html', 'r', encoding='utf-8') as f:
    c = f.read()

sys.stdout.write('Size: ' + str(len(c)) + '\n')

checks = [
    ('warehouseColumnDefs', 'warehouseColumnDefs'),
    ('initAGGrid columnDefs=[]', 'const columnDefs = [];'),
    ('gridOptions in initAGGrid', 'const gridOptions = {'),
    ('createGrid', 'agGrid.createGrid'),
    ('renderTable sets warehouseColumnDefs', "setGridOption('columnDefs', warehouseColumnDefs)"),
    ('previewPastedTable dynamic cols', "setGridOption('columnDefs', colDefs)"),
]

for name, pattern in checks:
    count = c.count(pattern)
    sys.stdout.write(name + ': ' + str(count) + ' occurrences\n')

# تحقق من initAGGrid
i = c.find('function initAGGrid')
chunk = c[i:i+200]
safe = ''.join(ch if ord(ch) < 128 else '?' for ch in chunk)
sys.stdout.write('\ninitAGGrid start:\n' + safe + '\n')

sys.stdout.flush()
