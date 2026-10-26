
function previewPastedTableForAnySheet(rawText) {
    console.log('Checkpoint 1: previewPastedTableForAnySheet called with text length:', rawText.length);

    try {
        const parsedData = parseExcelPasteRaw(rawText);
        console.log('Checkpoint 2: Data parsed successfully. Number of rows:', parsedData.length);
        if (parsedData.length === 0) {
            console.warn('⚠️ Warning: Paste parser returned 0 rows. Check the input format.');
            return;
        }

        // Assuming the paste is for the flexible virtual grid
        // We will replace the main data source `allDrugs` with the pasted data
        allDrugs = parsedData.map((row, index) => {
            // Map excel columns to our data structure
            // This mapping is critical and might need adjustment
            return {
                id: `pasted_${index}`, // Temporary ID
                tradeName: row[0] || '',
                batchNumber: row[1] || '',
                expiry_date: row[2] || '',
                quantity: parseInt(row[3], 10) || 0,
                public_price: parseFloat(row[4]) || 0,
                discount: parseFloat(row[5]) || 0,
                supplier: row[6] || '',
                // Add other fields with default values if necessary
                category: 'Pasted Data',
                created_at: new Date().toISOString(),
                net_price: (parseFloat(row[4]) * (1 - (parseFloat(row[5]) / 100))).toFixed(2) || 0,
                _originalRowIndex: index // Preserve original paste order
            };
        });

        console.log('Checkpoint 3: `allDrugs` has been updated. Total items:', allDrugs.length);
        
        // Now, we need to refresh the grid with the new data.
        // We call applyFlexibleVirtualFilters which will sort, filter, and render.
        if (typeof applyFlexibleVirtualFilters === 'function') {
            console.log('Calling applyFlexibleVirtualFilters to refresh the grid...');
            applyFlexibleVirtualFilters();
            console.log('Grid refresh process initiated.');
        } else {
            console.error('❌ Critical Error: applyFlexibleVirtualFilters() function is missing!');
        }

    } catch (error) {
        console.error('❌ An error occurred in previewPastedTableForAnySheet:', error);
    }
}

// We also need the helper function that was likely deleted too.
function parseExcelPasteRaw(rawText) {
    if (!rawText) return [];
    const rows = rawText.trim().split(/[\r\n]+/).map(row => row.split('\t'));
    return rows;
}