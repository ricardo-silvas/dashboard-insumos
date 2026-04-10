/**
 * scripts/process_excel.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Pré-processamento das séries históricas CEPEA (arquivos .xls/.xlsx).
 *
 * Uso:
 *   node scripts/process_excel.js
 *
 * Saída: data/processed/<indicator_id>.json
 * ─────────────────────────────────────────────────────────────────────────────
 */

'use strict';

const XLSX = require('xlsx');
const fs   = require('fs');
const path = require('path');

const EXCEL_DIR     = path.join(__dirname, '..', 'excel');
const PROCESSED_DIR = path.join(__dirname, '..', 'data', 'processed');

// ─── Mapeamento arquivo → indicador ────────────────────────────────────────
const FILE_MAP = [
    {
        pattern: /arabica/i,
        id:      'cafe_arabica',
        name:    'Café Arábica',
        unit:    'sc 60kg',
        source:  'CEPEA/ESALQ',
        // Não aplica multiplicador — valores estão em R$/sc 60kg
        normalizeValue: v => v,
    },
    {
        pattern: /robusta/i,
        id:      'cafe_robusta',
        name:    'Café Robusta (Conilon)',
        unit:    'sc 60kg',
        source:  'CEPEA/ESALQ',
        normalizeValue: v => v,
    },
    {
        // Açúcar Cristal Empacotado — CEPEA publica em R$/kg
        // Converter para R$/saca 50kg: valor × 50
        pattern: /cristal/i,
        id:      'acucar_cristal',
        name:    'Açúcar Cristal',
        unit:    'sc 50kg',
        source:  'CEPEA/ESALQ',
        normalizeValue: v => v * 50,
    },
    {
        // Açúcar Refinado Amorfo — CEPEA publica em R$/kg
        // Converter para R$/saca 50kg: valor × 50
        pattern: /refinado|amorfo/i,
        id:      'acucar_ref',
        name:    'Açúcar Refinado Amorfo',
        unit:    'sc 50kg',
        source:  'CEPEA/ESALQ',
        normalizeValue: v => v * 50,
    },
];

// ─── Identificar coluna do índice de preço ──────────────────────────────────
const PRICE_KEYWORDS = ['venda', 'à vista', 'a vista', 'preco r$', 'preço r$', 'em r$', 'indicador', 'valor'];

function findPriceColumn(headerRow) {
    for (let j = 1; j < headerRow.length; j++) {
        if (!headerRow[j]) continue;
        const h = headerRow[j].toString().toLowerCase()
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        for (const kw of PRICE_KEYWORDS) {
            if (h.includes(kw)) return j;
        }
    }
    return 1; // Fallback: segunda coluna
}

// ─── Converter data Excel → ISO 8601 ───────────────────────────────────────
function toISO(rawDate) {
    if (rawDate === null || rawDate === undefined || rawDate === '') return null;

    // SheetJS pode converter número serial diretamente se formatDate estiver ativo
    if (typeof rawDate === 'number') {
        // número serial do Excel → JS Date
        const d = new Date(Math.round((rawDate - 25569) * 86400 * 1000));
        if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];
    }

    const str = rawDate.toString().trim();

    // DD/MM/YYYY
    const dmY = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (dmY) return `${dmY[3]}-${dmY[2].padStart(2,'0')}-${dmY[1].padStart(2,'0')}`;

    // YYYY-MM-DD
    const iso = str.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (iso) return str;

    // Tentar parse genérico
    const d = new Date(str);
    if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];

    return null;
}

// ─── Localizar linha de cabeçalho dentro do JSON bruto ─────────────────────
function findHeaderRow(json) {
    for (let i = 0; i < json.length; i++) {
        if (!json[i] || !json[i][0]) continue;
        const cell = json[i][0].toString().toLowerCase()
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
        if (cell === 'data') return i;
    }
    return -1;
}

// ─── Calcular val_Nm (valor mais próximo de N dias atrás) ──────────────────
function valAtDaysAgo(records, daysAgo, toleranceDays = 20) {
    if (!records || records.length === 0) return null;
    const target = new Date();
    target.setDate(target.getDate() - daysAgo);

    let best     = null;
    let bestDiff = Infinity;

    for (const r of records) {
        const d    = new Date(r.date);
        const diff = Math.abs(d - target);
        if (diff < bestDiff) { bestDiff = diff; best = r; }
    }

    return best && bestDiff < toleranceDays * 86400000 ? best.value : null;
}

// ─── Processar um único arquivo Excel ──────────────────────────────────────
function processFile(filePath, indicator) {
    console.log(`\nProcessando: ${path.basename(filePath)}`);

    const buffer   = fs.readFileSync(filePath);
    const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: false });
    const sheet    = workbook.Sheets[workbook.SheetNames[0]];
    const json     = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null });

    const headerIdx = findHeaderRow(json);
    if (headerIdx === -1) {
        console.error(`  ✗ Linha "Data" não encontrada em ${path.basename(filePath)}`);
        return null;
    }

    const headerRow   = json[headerIdx];
    const priceColIdx = findPriceColumn(headerRow);

    console.log(`  → Cabeçalho na linha ${headerIdx + 1}`);
    console.log(`  → Coluna de preço: ${headerIdx + 1}[${priceColIdx}] = "${headerRow[priceColIdx]}"`);

    const records = [];
    let   skipped = 0;

    for (let i = headerIdx + 1; i < json.length; i++) {
        const row = json[i];
        if (!row || row[0] === null || row[0] === undefined) continue;

        const isoDate = toISO(row[0]);
        if (!isoDate) { skipped++; continue; }

        const rawVal = row[priceColIdx];
        if (rawVal === null || rawVal === undefined || rawVal === '') { skipped++; continue; }

        const numVal = parseFloat(rawVal.toString().replace(',', '.'));
        if (isNaN(numVal) || numVal <= 0) { skipped++; continue; }

        const normalized = indicator.normalizeValue(numVal);
        records.push({ date: isoDate, value: parseFloat(normalized.toFixed(4)) });
    }

    // Ordenar cronologicamente (mais antigo primeiro)
    records.sort((a, b) => new Date(a.date) - new Date(b.date));

    // Remover duplicatas (manter último valor por data)
    const unique = [];
    const seen   = new Set();
    for (let i = records.length - 1; i >= 0; i--) {
        if (!seen.has(records[i].date)) {
            seen.add(records[i].date);
            unique.unshift(records[i]);
        }
    }

    const val6m  = valAtDaysAgo(unique, 180);
    const val12m = valAtDaysAgo(unique, 365);

    console.log(`  ✓ ${unique.length} registros únicos (${skipped} ignorados)`);
    if (unique.length > 0) {
        console.log(`  → Período: ${unique[0].date} → ${unique[unique.length - 1].date}`);
    }
    console.log(`  → val_6m : ${val6m  !== null ? val6m.toFixed(4)  : 'Indisponível'}`);
    console.log(`  → val_12m: ${val12m !== null ? val12m.toFixed(4) : 'Indisponível'}`);

    return {
        indicator_id:    indicator.id,
        name:            indicator.name,
        unit:            indicator.unit,
        source:          indicator.source,
        last_processed:  new Date().toISOString(),
        records:         unique,
        meta: {
            total_records: unique.length,
            skipped_rows:  skipped,
            date_range: unique.length > 0 ? {
                from: unique[0].date,
                to:   unique[unique.length - 1].date,
            } : null,
            val_6m:  val6m  !== null ? parseFloat(val6m.toFixed(4))  : null,
            val_12m: val12m !== null ? parseFloat(val12m.toFixed(4)) : null,
        },
    };
}

// ─── Main ───────────────────────────────────────────────────────────────────
function main() {
    console.log('═══════════════════════════════════════════════════════');
    console.log('  Dashboard Insumos Fortpel — Pré-processamento Excel  ');
    console.log('═══════════════════════════════════════════════════════');

    if (!fs.existsSync(PROCESSED_DIR)) {
        fs.mkdirSync(PROCESSED_DIR, { recursive: true });
    }

    const files = fs.readdirSync(EXCEL_DIR).filter(f => /\.(xls|xlsx)$/i.test(f));
    if (files.length === 0) {
        console.warn('\n⚠ Nenhum arquivo Excel encontrado em excel/');
        return;
    }

    let processed = 0;
    let failed    = 0;

    for (const file of files) {
        const indicator = FILE_MAP.find(m => m.pattern.test(file));
        if (!indicator) {
            console.warn(`\n⚠ Arquivo não reconhecido: ${file} — ignorando.`);
            continue;
        }

        try {
            const result = processFile(path.join(EXCEL_DIR, file), indicator);
            if (result) {
                const outPath = path.join(PROCESSED_DIR, `${indicator.id}.json`);
                fs.writeFileSync(outPath, JSON.stringify(result, null, 2), 'utf-8');
                console.log(`  ✓ Salvo em: data/processed/${indicator.id}.json`);
                processed++;
            } else {
                failed++;
            }
        } catch (err) {
            console.error(`  ✗ Erro ao processar ${file}:`, err.message);
            failed++;
        }
    }

    console.log('\n═══════════════════════════════════════════════════════');
    console.log(`  Concluído: ${processed} processado(s), ${failed} falha(s).`);
    console.log('═══════════════════════════════════════════════════════\n');
}

main();
