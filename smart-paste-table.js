// c:/Users/My PC/Desktop/slamtak/smart-paste-table.js
// SmartPasteTable module (JavaScript only). NO HTML should be inside this file.

// Provide a global-safe fallback for savePreviewedData only if not already defined.
// Load this file BEFORE stock.html so stock.html can replace it with the real implementation.
if (typeof window.savePreviewedData !== 'function') {
    window.savePreviewedData = async function savePreviewedData() {
    const statusMessage = document.getElementById('saveStatusMessage');
    if (statusMessage) {
        statusMessage.style.display = 'block';
        statusMessage.style.color = '#c62828';
        statusMessage.style.backgroundColor = '#ffebee';
        statusMessage.style.borderColor = '#c62828';
        statusMessage.textContent = 'حدث خطأ: savePreviewedData الحقيقي غير محمّل. راجع Console.';
    }
    console.error('savePreviewedData is missing. This fallback is defined in smart-paste-table.js, but the real implementation is not present on the page.');
        alert('حدث خطأ: savePreviewedData الحقيقي غير محمّل.');
    };
}

(function() {
    'use strict';

    if (!window.AICore) {
        console.warn("AICore is not loaded at module initialization. SmartPasteTable may require it.");
    }

    /**
     * @class SmartPasteTable
     * @description A class to create a dynamic table from pasted spreadsheet data,
     * with automatic column mapping using AICore.
     */
    class SmartPasteTable {
        /**
         * @param {object} config - Configuration object.
         * @param {string} config.containerId - The ID of the element where the table will be rendered.
         * @param {string} config.pasteAreaId - The ID of the element that will listen for the paste event.
         * @param {function} [config.onDataReady] - Callback function executed when data is processed.
         */
        constructor(config) {
            this.container = document.getElementById(config.containerId);
            this.pasteArea = document.getElementById(config.pasteAreaId);
            this.onDataReady = config.onDataReady || function() {};
            
            if (!this.container || !this.pasteArea) {
                console.error("SmartPasteTable: لم يتم العثور على العنصر الحاوي أو منطقة اللصق.");
                return;
            }

            this.headers = [];
            this.data = [];
            this.mapping = {};
            
            this._bindEvents();
            this.pasteArea.style.cursor = 'pointer';
        }

        _bindEvents() {
            this.pasteArea.addEventListener('paste', this._handlePaste.bind(this));
        }

        _handlePaste(event) {
            event.preventDefault();
            const pastedText = (event.clipboardData || window.clipboardData).getData('text');
            
            if (!pastedText) return;

            // إخفاء منطقة اللصق بعد اللصق
            this.pasteArea.style.display = 'none';

            const { headers, data } = this._parsePastedData(pastedText);
            this.headers = headers;
            this.data = data;

            // استخدام الذكاء الاصطناعي لمطابقة الأعمدة
            if (window.AICore && typeof window.AICore.smartMapHeaders === 'function') {
                const { map, software } = window.AICore.smartMapHeaders(this.headers);
                this.mapping = map;
                console.log("برنامج المصدر المكتشف:", software);
            } else {
                console.warn("AICore.smartMapHeaders is not available. Using empty mapping.");
                this.mapping = {};
            }

            console.log("المطابقة الأولية للأعمدة:", this.mapping);

            this._renderTable();
        }

        _parsePastedData(text) {
            // تقسيم الصفوف بالأساس على سطر جديد، والأعمدة على Tab
            const rows = text.trim().split(/[\r\n]+/).map(row => row.split('\t'));
            if (rows.length === 0) return { headers: [], data: [] };

            const headers = rows.shift();
            // تنظيف البيانات من الصفوف الفارغة
            const data = rows.filter(row => row.some(cell => cell.trim() !== ''));
            return { headers, data };
        }

        _renderTable() {
            this.container.innerHTML = ''; // مسح الجدول القديم

            const infoDiv = document.createElement('div');
            infoDiv.innerHTML = `
                <p style="font-size: 1.1em;"><strong>تم تحليل ${this.data.length} منتج.</strong> يرجى مراجعة مطابقة الأعمدة أدناه وتصحيحها إذا لزم الأمر.</p>
            `;
            this.container.appendChild(infoDiv);

            const table = document.createElement('table');
            table.className = 'smart-table';

            const thead = document.createElement('thead');
            thead.appendChild(this._renderHeaderRow());
            table.appendChild(thead);

            const tbody = document.createElement('tbody');
            // عرض أول 10 صفوف كعينة للمراجعة
            this.data.slice(0, 10).forEach(rowData => {
                const tr = document.createElement('tr');
                this.headers.forEach((header, index) => {
                    const td = document.createElement('td');
                    td.textContent = rowData[index] || '';
                    tr.appendChild(td);
                });
                tbody.appendChild(tr);
            });
            table.appendChild(tbody);

            this.container.appendChild(table);
            
            if (this.data.length > 10) {
                const moreRowsInfo = document.createElement('p');
                moreRowsInfo.style.textAlign = 'center';
                moreRowsInfo.style.color = '#555';
                moreRowsInfo.textContent = `... و ${this.data.length - 10} صفوف أخرى.`;
                this.container.appendChild(moreRowsInfo);
            }

            const actionsDiv = document.createElement('div');
            actionsDiv.style.display = 'flex';
            actionsDiv.style.gap = '10px';
            actionsDiv.style.marginTop = '20px';

            const processButton = document.createElement('button');
            processButton.textContent = '✓ تأكيد ومعالجة البيانات';
            processButton.className = 'process-data-btn';
            processButton.style.flexGrow = '1';
            processButton.onclick = () => {
                const jsonData = this.getProcessedData();
                this.onDataReady(jsonData);
            };
            actionsDiv.appendChild(processButton);

            const resetButton = document.createElement('button');
            resetButton.innerHTML = '<i class="fas fa-undo"></i> لصق بيانات جديدة';
            resetButton.className = 'process-data-btn';
            resetButton.style.backgroundColor = '#6c757d';
            resetButton.style.flexGrow = '0';
            resetButton.style.minWidth = '180px';
            resetButton.onclick = () => this.reset();
            actionsDiv.appendChild(resetButton);

            this.container.appendChild(actionsDiv);
        }

        _renderHeaderRow() {
            const tr = document.createElement('tr');
            this.headers.forEach((header, index) => {
                const th = document.createElement('th');
                
                const headerText = document.createElement('div');
                headerText.className = 'original-header';
                headerText.textContent = header;
                th.appendChild(headerText);

                const select = document.createElement('select');
                select.dataset.columnIndex = index;
                select.className = 'mapping-select';

                let canonicalFields = [];
                if (window.AICore && window.AICore.pharmacySynonyms) {
                    canonicalFields = Object.keys(window.AICore.pharmacySynonyms);
                } else {
                    canonicalFields = ['productName', 'price', 'discount', 'quantity', 'expiryDate', 'productionDate', 'barcode'];
                }
                
                const noneOption = document.createElement('option');
                noneOption.value = 'ignore';
                noneOption.textContent = '— تجاهل هذا العمود —';
                select.appendChild(noneOption);

                let foundMatch = false;
                canonicalFields.forEach(field => {
                    const option = document.createElement('option');
                    option.value = field;
                    option.textContent = this._getFriendlyFieldName(field);
                    
                    if (this.mapping[field] === index) {
                        option.selected = true;
                        foundMatch = true;
                    }
                    select.appendChild(option);
                });
                
                if (!foundMatch) {
                    noneOption.selected = true;
                }

                select.addEventListener('change', (e) => this._updateMapping(e));
                th.appendChild(select);
                tr.appendChild(th);
            });
            return tr;
        }
        
        _getFriendlyFieldName(field) {
            const names = {
                productName: 'اسم المنتج',
                price: 'السعر',
                discount: 'الخصم',
                quantity: 'الكمية',
                expiryDate: 'تاريخ الانتهاء',
                productionDate: 'تاريخ الإنتاج',
                barcode: 'الباركود'
            };
            return names[field] || field;
        }

        _updateMapping(event) {
            const select = event.target;
            const newField = select.value;
            const columnIndex = parseInt(select.dataset.columnIndex, 10);

            // مسح الربط القديم لهذا العمود
            for (const key in this.mapping) {
                if (this.mapping[key] === columnIndex) {
                    this.mapping[key] = -1;
                }
            }

            // تعيين الربط الجديد، إذا لم يكن "تجاهل"
            if (newField !== 'ignore') {
                // التحقق مما إذا كان هذا الحقل مرتبطًا بالفعل بعمود آخر ومسحه
                if (this.mapping[newField] !== -1 && this.mapping[newField] !== undefined) {
                    const oldSelect = this.container.querySelector(`select[data-column-index='${this.mapping[newField]}']`);
                    if (oldSelect) {
                        oldSelect.value = 'ignore';
                    }
                }
                this.mapping[newField] = columnIndex;
            }
            console.log("تم تحديث الربط:", this.mapping);
        }

        reset() {
            this.container.innerHTML = '';
            this.pasteArea.style.display = 'block';
            this.headers = [];
            this.data = [];
            this.mapping = {};
            console.log('🔄 Smart Paste Table has been reset.');
        }

        getProcessedData() {
            const processed = [];
            this.data.forEach(row => {
                const product = {};
                let hasData = false;
                for (const field in this.mapping) {
                    const colIndex = this.mapping[field];
                    if (colIndex !== -1 && colIndex < row.length && row[colIndex] !== undefined) {
                        product[field] = row[colIndex].trim();
                        if (product[field]) hasData = true;
                    }
                }
                // التأكد من وجود اسم للمنتج على الأقل للمتابعة
                if (hasData && product.productName) {
                    processed.push(product);
                }
            });
            return processed;
        }
    }

    window.SmartPasteTable = SmartPasteTable;
    console.log('✅ وحدة جدول اللصق الذكي جاهزة للعمل.');

})();