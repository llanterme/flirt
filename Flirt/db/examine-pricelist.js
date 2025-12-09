const XLSX = require('xlsx');
const path = require('path');

const filePath = process.env.HOME + '/Downloads/Pricelist-3.xlsx';

console.log('📄 Reading Excel file:', filePath);

const workbook = XLSX.readFile(filePath);
console.log('\n📊 Sheets in workbook:', workbook.SheetNames);

workbook.SheetNames.forEach(sheetName => {
    console.log('\n' + '='.repeat(60));
    console.log(`SHEET: ${sheetName}`);
    console.log('='.repeat(60));

    const worksheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

    // Show first 10 rows
    console.log('\nFirst 10 rows:');
    data.slice(0, 10).forEach((row, i) => {
        console.log(`Row ${i}:`, row);
    });

    console.log(`\nTotal rows: ${data.length}`);

    // Try to parse as objects with headers
    if (data.length > 1) {
        console.log('\n📋 Parsed as objects (first 5):');
        const objects = XLSX.utils.sheet_to_json(worksheet);
        objects.slice(0, 5).forEach((obj, i) => {
            console.log(`\nRecord ${i + 1}:`, JSON.stringify(obj, null, 2));
        });
        console.log(`\nTotal records: ${objects.length}`);
    }
});

console.log('\n✅ Examination complete');
