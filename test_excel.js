const XLSX = require('xlsx');
const fs = require('fs');

function testParsing(filename) {
    console.log(`--- Testando ${filename} ---`);
    try {
        const buf = fs.readFileSync(filename);
        const workbook = XLSX.read(buf, { type: 'buffer' });
        const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
        const json = XLSX.utils.sheet_to_json(firstSheet, { header: 1 });
        
        // Simular lógica do app.js
        let dataRowIndex = -1;
        for(let i=0; i<json.length; i++) {
            if(json[i] && json[i][0] && json[i][0].toString().toLowerCase().includes("data")) {
                dataRowIndex = i;
                break;
            }
        }
        
        console.log(`Linha de cabeçalho (Data) encontrada em: ${dataRowIndex}`);
        if (dataRowIndex !== -1) {
            console.log(`Exemplo de primeira linha de dados:`, json[dataRowIndex + 1]);
            const lastRow = json[json.length - 1];
            console.log(`Última linha de dados:`, lastRow);
        }
    } catch (e) {
        console.error(`Erro ao ler ${filename}:`, e.message);
    }
}

// Nota: se o usuário não tem node/xlsx instalado globalmente, isso pode falhar.
// Mas eu posso rodar se eu tiver permissão.
testParsing('serie_arabica.xls');
testParsing('serie_robusta.xls');
