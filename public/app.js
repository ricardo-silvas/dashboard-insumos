const CORS_PROXY = "https://api.allorigins.win/get?url=";
const REFRESH_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

const INDICATORS = [
    { id: 'algodao',      name: 'Algodão',         subtitle: 'Mercado Físico - CEPEA/ESALQ',           unit: 'libra-peso', url: 'https://www.cepea.org.br/br/indicador/algodao.aspx',                                              type: 'cepea' },
    { id: 'cafe_arabica', name: 'Café Arábica',     subtitle: 'Mercado Físico - CEPEA/ESALQ',           unit: 'sc 60kg',   url: 'https://www.cepea.org.br/br/indicador/cafe.aspx',                                                 type: 'cepea', selector: '#imagenet-indicador1', excelFile: 'serie_arabica.xls' },
    { id: 'cafe_robusta', name: 'Café Robusta',     subtitle: 'Mercado Físico - CEPEA/ESALQ',           unit: 'sc 60kg',   url: 'https://www.cepea.org.br/br/indicador/cafe.aspx',                                                 type: 'cepea', selector: '#imagenet-indicador2', excelFile: 'serie_robusta.xls' },
    { id: 'acucar_cristal', name: 'Açúcar Cristal', subtitle: 'Empacotado SP - CEPEA/ESALQ',            unit: 'sc 50kg',   url: 'https://www.cepea.org.br/br/indicador/acucar-cristal-empacotado-cepea-esalq-sao-paulo.aspx',       type: 'cepea', excelFile: 'serie_acucarcristal.xls', excelMultiplier: 10, excelAlts: ['CEPEA_20260406065815.xls', 'serie_acucar_cristal.xls'] },
    { id: 'acucar_ref',   name: 'Açúcar Refinado',  subtitle: 'Amorfo SP - CEPEA/ESALQ',                unit: 'sc 50kg',   url: 'https://www.cepea.org.br/br/indicador/acucar-refinado-amorfo-sp.aspx',                             type: 'cepea', excelFile: 'serie_acucarrefinado.xls', excelMultiplier: 50, excelAlts: ['CEPEA_20260406065826.xls', 'serie_acucar_refinado.xls'] },
    { id: 'aluminio',     name: 'Alumínio (LME)',   subtitle: 'London Metal Exchange (Dados Estimados)', unit: 'tonelada',  type: 'mock' },
    { id: 'dolar',        name: 'Dólar Comercial',  subtitle: 'Banco Central do Brasil / PTAX',          unit: '',          type: 'dolar' }
];

let currentIndex = 0;
// globalData stores per-indicator: { history, weekly, current, val6m, val12m }
let globalData = {};
let myChart = null;

// ──────────────────────────────────────────────
//  BOOT
// ──────────────────────────────────────────────
async function run() {
    await fetchAllData();
    if (INDICATORS.length > 0) {
        renderIndicator(INDICATORS[0]);
        updateFooterTicker();
        startRotation();
    }
}

// ──────────────────────────────────────────────
//  DATA FETCHING
// ──────────────────────────────────────────────
async function fetchAllData() {
    document.getElementById('indicator-subtitle').innerText = "Baixando dados das fontes...";

    for (const ind of INDICATORS) {
        try {
            let history  = [];
            let val6m    = null;
            let val12m   = null;
            let isOutdated = false;

            if (ind.type === 'cepea') {
                // ── Current price from CEPEA website ──
                history = await fetchCEPEA(ind.url, ind.selector);

                // ── Long-term history from Excel / Cache ──
                if (ind.excelFile) {
                    let excelHistory = null;

                    // Try primary filename, then alt filenames
                    const filesToTry = [ind.excelFile, ...(ind.excelAlts || [])];
                    for (const filename of filesToTry) {
                        if (excelHistory && excelHistory.length > 0) break;
                        try {
                            const candidate = await loadExcelData(filename, ind.id);
                            if (candidate && candidate.length > 0) excelHistory = candidate;
                        } catch (_) {}
                    }

                    // Fallback to localStorage cache
                    if (!excelHistory || excelHistory.length === 0) {
                        excelHistory = loadFromCache(ind.id);
                    }

                    if (excelHistory && excelHistory.length > 0) {
                        // Save to cache so next refresh has it
                        saveToCache(ind.id, excelHistory);

                        const lastDate = parseDate(excelHistory[0].date);
                        isOutdated = (new Date() - lastDate) / 86400000 > 30;

                        // Extract 6-month and 12-month price from the full history
                        let raw6m  = findHistoricalValue(excelHistory, 180);
                        let raw12m = findHistoricalValue(excelHistory, 365);

                        // Apply multiplier so units match the live CEPEA price
                        const m = ind.excelMultiplier || 1;
                        val6m  = raw6m  ? raw6m  * m : null;
                        val12m = raw12m ? raw12m * m : null;
                    } else {
                        showUploadHint();
                    }
                }

            } else if (ind.type === 'dolar') {
                const dolarResult = await fetchDolar();
                if (dolarResult) {
                    history = dolarResult.history;
                    val6m   = dolarResult.val6m;
                    val12m  = dolarResult.val12m;
                }

            } else if (ind.type === 'mock') {
                history = generateFallbackData(ind.id);
            }

            if (!history || history.length === 0) throw new Error("Histórico vazio");

            const current  = history[0];
            const previous = history.length > 1 ? history[1] : history[0];
            const varDia   = ((current.value - previous.value) / previous.value) * 100;

            globalData[ind.id] = {
                history,
                weekly: groupByWeek(history),
                current: { date: current.date, value: current.value, variation: varDia },
                val6m,
                val12m,
                isOutdated
            };

        } catch (error) {
            console.warn(`Erro em ${ind.name}, usando fallback simulado:`, error);
            const fb  = generateFallbackData(ind.id);
            const cur = fb[0], prv = fb[1];
            globalData[ind.id] = {
                history: fb,
                weekly: groupByWeek(fb),
                current: { date: cur.date, value: cur.value, variation: ((cur.value - prv.value) / prv.value) * 100 },
                val6m: null,
                val12m: null,
                isOutdated: false
            };
        }
    }
}

// ──────────────────────────────────────────────
//  CEPEA SCRAPER
// ──────────────────────────────────────────────
async function fetchCEPEA(url, selector = null) {
    const res  = await fetch(CORS_PROXY + encodeURIComponent(url));
    const json = await res.json();
    const doc  = new DOMParser().parseFromString(json.contents, 'text/html');

    const table = (selector ? doc.querySelector(selector) : null)
        || doc.querySelector('#imagenet-indicador1')
        || doc.querySelector('.table-responsive table')
        || doc.querySelector('table');

    if (!table) throw new Error("Tabela não encontrada em " + url);

    let history = [];
    table.querySelectorAll('tbody tr').forEach(tr => {
        const tds = tr.querySelectorAll('td');
        if (tds.length >= 2) {
            const dateStr = tds[0].innerText.trim();
            const val     = parseFloat(tds[1].innerText.trim().replace(/\./g, '').replace(',', '.'));
            if (!isNaN(val)) history.push({ date: dateStr, value: val });
        }
    });

    return history.slice(0, 30);
}

// ──────────────────────────────────────────────
//  DÓLAR PTAX (Banco Central)
// ──────────────────────────────────────────────
async function fetchDolar() {
    // Format: MM-DD-YYYY (required by BCB API)
    const fmt = d => `${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}-${d.getFullYear()}`;

    try {
        // Fetch 13 months in ONE call — use this to compute 6m and 12m too
        const today = new Date();
        const past13m = new Date();
        past13m.setMonth(past13m.getMonth() - 13);

        const url = `https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/CotacaoDolarPeriodo(dataInicial=@i,dataFinalCotacao=@f)?@i='${fmt(past13m)}'&@f='${fmt(today)}'&$top=400&$format=json&$orderby=dataHoraCotacao%20desc`;
        const res  = await fetch(url);
        const json = await res.json();

        if (!json.value || json.value.length === 0) throw new Error("PTAX vazio");

        // Sort newest first
        const docs = [...json.value].sort((a,b) => new Date(b.dataHoraCotacao) - new Date(a.dataHoraCotacao));

        // Build history array
        const history = docs.map(d => {
            const p = d.dataHoraCotacao.split(' ')[0].split('-');
            return { date: `${p[2]}/${p[1]}/${p[0]}`, value: d.cotacaoVenda };
        });

        // Calculate 6m and 12m targets
        const target6m  = new Date(); target6m.setMonth(target6m.getMonth() - 6);
        const target12m = new Date(); target12m.setMonth(target12m.getMonth() - 12);

        // Find closest date in the full history
        const findClosest = (targetDate) => {
            let best = null;
            let bestDiff = Infinity;
            for (const item of history) {
                const diff = Math.abs(parseDate(item.date) - targetDate);
                if (diff < bestDiff) { bestDiff = diff; best = item; }
            }
            // Allow up to 20 calendar days of tolerance
            return (best && bestDiff < 20 * 86400000) ? best.value : null;
        };

        const val6m  = findClosest(target6m);
        const val12m = findClosest(target12m);

        // Limit history to 30 for display
        return { history: history.slice(0, 30), val6m, val12m };

    } catch (e) {
        console.error("BCB API Error:", e);
        return null;
    }
}

// ──────────────────────────────────────────────
//  ALUMÍNIO (simulado)
// ──────────────────────────────────────────────
function generateFallbackData(metricId) {
    const basePrices = {
        algodao: 415.50, cafe_arabica: 1250.00, cafe_robusta: 937.00,
        acucar_cristal: 145.80, acucar_ref: 160.20, aluminio: 13450.00, dolar: 5.20
    };
    let basePrice = basePrices[metricId] || 100;
    let currVal   = basePrice;
    let ptr       = new Date();
    let history   = [];

    for (let i = 0; history.length < 30 && i < 50; i++) {
        if (ptr.getDay() !== 0 && ptr.getDay() !== 6) {
            const pad = n => String(n).padStart(2, '0');
            const dateStr = `${pad(ptr.getDate())}/${pad(ptr.getMonth()+1)}/${ptr.getFullYear()}`;
            const vol = metricId === 'dolar' ? 0.005 : 0.015;
            currVal = currVal * (1 + (Math.random() - 0.48) * vol);
            history.push({ date: dateStr, value: currVal });
        }
        ptr.setDate(ptr.getDate() - 1);
    }
    return history;
}

// ──────────────────────────────────────────────
//  EXCEL
// ──────────────────────────────────────────────
async function loadExcelData(filename, indicatorId = '') {
    const res         = await fetch(filename);
    const arrayBuffer = await res.arrayBuffer();
    const workbook    = XLSX.read(new Uint8Array(arrayBuffer), { type: 'array' });
    const firstSheet  = workbook.Sheets[workbook.SheetNames[0]];
    const json        = XLSX.utils.sheet_to_json(firstSheet, { header: 1 });
    return processExcelJSON(json, indicatorId);
}

function processExcelJSON(json, indicatorId = '') {
    // Find the header row that starts with "Data"
    let dataRowIndex = -1;
    for (let i = 0; i < json.length; i++) {
        if (json[i] && json[i][0]) {
            const cell = json[i][0].toString().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
            if (cell === "data") { dataRowIndex = i; break; }
        }
    }
    if (dataRowIndex === -1) return [];

    // Find the price column dynamically
    const headerRow = json[dataRowIndex];
    let priceColIndex = 1;
    for (let j = 1; j < headerRow.length; j++) {
        if (headerRow[j]) {
            const h = headerRow[j].toString().toLowerCase();
            if (h.includes("venda") || h.includes("vista") || h.includes("preco r$") || h.includes("em r$")) {
                priceColIndex = j; break;
            }
        }
    }

    const isSugar = indicatorId.includes('acucar');
    let history = [];

    for (let i = dataRowIndex + 1; i < json.length; i++) {
        const row = json[i];
        if (!row[0] || !row[priceColIndex]) continue;
        let val = parseFloat(row[priceColIndex].toString().replace(',', '.'));
        if (!isNaN(val)) {
            // Sugar files come in R$/Ton or R$/5kg — normalise only sugar
            if (isSugar && val > 1000) val = val / 20;
            history.unshift({ date: dateFormat(row[0]), value: val });
        }
    }
    return history; // Oldest → newest (unshift builds it correctly)
}

// ──────────────────────────────────────────────
//  EXCEL UPLOAD FALLBACK
// ──────────────────────────────────────────────
function initExcelFallback() {
    const hint  = document.getElementById('upload-hint');
    const input = document.getElementById('excel-upload');
    if (!hint || !input) return;

    hint.addEventListener('click', () => input.click());

    input.addEventListener('change', async (e) => {
        const files = Array.from(e.target.files);
        let processed = 0;

        for (const file of files) {
            await new Promise(resolve => {
                const reader = new FileReader();
                reader.onload = async (ev) => {
                    try {
                        const workbook   = XLSX.read(new Uint8Array(ev.target.result), { type: 'array' });
                        const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
                        const json       = XLSX.utils.sheet_to_json(firstSheet, { header: 1 });

                        // Identify indicator by filename
                        const name = file.name.toLowerCase();
                        let id = null;
                        if      (name.includes('arabica'))                           id = 'cafe_arabica';
                        else if (name.includes('robusta'))                           id = 'cafe_robusta';
                        else if (name.includes('cristal'))                           id = 'acucar_cristal';
                        else if (name.includes('refinado') || name.includes('amorfo')) id = 'acucar_ref';

                        if (id) {
                            const history = processExcelJSON(json, id);
                            const ind     = INDICATORS.find(i => i.id === id);
                            if (ind && history.length > 0) {
                                saveToCache(id, history);
                                // Update globalData with new 6m/12m values
                                const m    = ind.excelMultiplier || 1;
                                const v6   = findHistoricalValue(history, 180);
                                const v12  = findHistoricalValue(history, 365);
                                if (globalData[id]) {
                                    globalData[id].val6m  = v6  ? v6  * m : null;
                                    globalData[id].val12m = v12 ? v12 * m : null;
                                    globalData[id].isOutdated = false;
                                }
                                if (INDICATORS[currentIndex].id === id) renderIndicator(ind);
                                processed++;
                            }
                        } else {
                            console.warn("Não foi possível identificar o indicador para:", file.name);
                        }
                    } catch (err) {
                        console.error("Erro ao processar arquivo:", file.name, err);
                    }
                    resolve();
                };
                reader.readAsArrayBuffer(file);
            });
        }

        hint.innerText = processed > 0
            ? `✔ ${processed} arquivo(s) processado(s) com sucesso!`
            : "⚠ Nenhum arquivo reconhecido. Verifique o nome dos arquivos.";
        setTimeout(() => hint.classList.add('hidden'), 4000);
    });
}

// ──────────────────────────────────────────────
//  CACHE
// ──────────────────────────────────────────────
function saveToCache(id, history) {
    try { localStorage.setItem(`fortpel_cache_${id}`, JSON.stringify(history)); }
    catch (e) { console.error("Storage error:", e); }
}

function loadFromCache(id) {
    try {
        const cached = localStorage.getItem(`fortpel_cache_${id}`);
        return cached ? JSON.parse(cached) : null;
    } catch { return null; }
}

// ──────────────────────────────────────────────
//  UTILITIES
// ──────────────────────────────────────────────
function dateFormat(excelDate) {
    if (typeof excelDate === 'string') return excelDate;
    const d = new Date(excelDate);
    if (isNaN(d.getTime())) return String(excelDate);
    const p = n => String(n).padStart(2,'0');
    return `${p(d.getDate())}/${p(d.getMonth()+1)}/${d.getFullYear()}`;
}

function parseDate(str) {
    if (!str || typeof str !== 'string') return new Date(0);
    const parts = str.split('/');
    if (parts.length < 3) return new Date(0);
    return new Date(parts[2], parts[1]-1, parts[0]);
}

function showUploadHint() {
    const hint = document.getElementById('upload-hint');
    if (hint) hint.classList.remove('hidden');
}

/**
 * Find the value in history closest to `daysAgo` days back.
 * Returns null if the closest point is > 20 days away from target.
 */
function findHistoricalValue(history, daysAgo) {
    if (!history || history.length === 0) return null;
    const target  = new Date();
    target.setDate(target.getDate() - daysAgo);

    let closest = history[0];
    let minDiff = Math.abs(parseDate(history[0].date) - target);

    for (const item of history) {
        const diff = Math.abs(parseDate(item.date) - target);
        if (diff < minDiff) { minDiff = diff; closest = item; }
    }

    return (minDiff > 20 * 86400000) ? null : closest.value;
}

function groupByWeek(historyArray) {
    const arr   = [...historyArray].reverse(); // Oldest → newest
    const weeks = [];

    for (let i = 0; i < arr.length; i += 5) {
        const chunk = arr.slice(i, i+5);
        if (chunk.length === 0) continue;
        const avg   = chunk.reduce((s, x) => s + x.value, 0) / chunk.length;
        const start = chunk[0].date.substring(0,5);
        const end   = chunk[chunk.length-1].date.substring(0,5);
        weeks.push({ label: `${start} as ${end}`, value: avg, lastDate: chunk[chunk.length-1].date });
    }

    for (let i = 0; i < weeks.length; i++) {
        weeks[i].variation = i === 0 ? 0 : ((weeks[i].value - weeks[i-1].value) / weeks[i-1].value) * 100;
    }
    return weeks;
}

// ──────────────────────────────────────────────
//  RENDER
// ──────────────────────────────────────────────
function renderIndicator(ind) {
    const data = globalData[ind.id];
    if (!data) return;

    document.getElementById('indicator-title').innerText    = ind.name;
    document.getElementById('indicator-subtitle').innerText = ind.subtitle;
    document.getElementById('current-date').innerText       = data.current.date;

    // Format currency
    const fmtOpts = { style: 'currency', currency: 'BRL' };
    if (ind.id === 'dolar') { fmtOpts.minimumFractionDigits = 4; fmtOpts.maximumFractionDigits = 4; }
    const formatter = new Intl.NumberFormat('pt-BR', fmtOpts);
    const priceText = formatter.format(data.current.value);

    document.getElementById('current-price').innerHTML = ind.unit
        ? `${priceText} <span class="text-3xl font-body text-gray-500 font-medium tracking-normal ml-1">/ ${ind.unit}</span>`
        : priceText;

    // ── Badges ──
    const currentVal = data.current.value;

    // 30 days badge
    if (data.history.length > 0) {
        const oldest30 = data.history[data.history.length - 1].value;
        updateBadge('30d', ((currentVal - oldest30) / oldest30) * 100, "30 dias");
    }

    // Reset 6m / 12m badges first
    setBadgeUnavailable('6m');
    setBadgeUnavailable('12m');

    if (data.isOutdated) {
        document.getElementById('badge-val-6m').innerText  = "ATUALIZAR DADOS";
        document.getElementById('badge-val-12m').innerText = "ATUALIZAR DADOS";
        document.getElementById('badge-val-6m').classList.add('text-red-500');
        document.getElementById('badge-val-12m').classList.add('text-red-500');
    } else if (data.val6m !== null || data.val12m !== null) {
        if (data.val6m !== null) {
            updateBadge('6m', ((currentVal - data.val6m) / data.val6m) * 100, "6 meses");
        }
        if (data.val12m !== null) {
            updateBadge('12m', ((currentVal - data.val12m) / data.val12m) * 100, "12 meses");
        }
    }
    // else: badges stay as "Indisponível" (set above)

    // ── Day variation ──
    const varEl        = document.getElementById('current-variation');
    const varIcon      = document.getElementById('current-variation-icon');
    const varContainer = document.getElementById('current-variation-container');
    const v = data.current.variation;
    varEl.innerText = `${Math.abs(v).toFixed(2)}% vs Dia Anterior`;
    varContainer.classList.remove('text-green-600', 'text-red-600', 'text-gray-500');
    if      (v > 0) { varContainer.classList.add('text-green-600'); varIcon.innerText = 'trending_up'; }
    else if (v < 0) { varContainer.classList.add('text-red-600');   varIcon.innerText = 'trending_down'; }
    else            { varContainer.classList.add('text-gray-500');  varIcon.innerText = 'trending_flat'; }

    // ── History list ──
    const historyList = document.getElementById('history-list');
    historyList.innerHTML = '';
    data.history.forEach((item, index) => {
        const isToday   = index === 0;
        const pVal      = formatter.format(item.value);
        const older     = data.history[index+1];
        const variation = older ? ((item.value - older.value) / older.value) * 100 : 0;
        const vColor    = variation > 0 ? "text-green-600" : (variation < 0 ? "text-red-600" : "text-gray-500");
        const vIcon     = variation > 0 ? "arrow_drop_up"  : (variation < 0 ? "arrow_drop_down" : "remove");
        historyList.innerHTML += `
        <div class="flex items-center justify-between p-4 ${isToday ? 'bg-[#B72C31] text-white shadow-md transform hover:scale-[1.02] transition-transform' : 'bg-[#efeded]'} rounded-lg">
            <div class="flex flex-col">
                <span class="text-xs uppercase font-bold opacity-80">${item.date}</span>
                <span class="font-headline font-bold text-lg">${pVal}</span>
            </div>
            <div class="flex flex-col items-end">
                <span class="text-base font-bold ${isToday ? 'text-white' : vColor} flex items-center">
                    ${Math.abs(variation).toFixed(2)}%
                    <span class="material-symbols-outlined text-base ml-1">${vIcon}</span>
                </span>
            </div>
        </div>`;
    });

    renderChart(data.weekly, ind);
}

function setBadgeUnavailable(period) {
    const badgeVal  = document.getElementById(`badge-val-${period}`);
    const container = document.getElementById(`badge-container-${period}`);
    if (badgeVal)  { badgeVal.innerText = "Indisponível"; badgeVal.classList.remove('text-red-500'); }
    if (container) container.style.opacity = '0.3';
}

function updateBadge(period, variation, label) {
    const badgeVal  = document.getElementById(`badge-val-${period}`);
    const container = document.getElementById(`badge-container-${period}`);
    if (!badgeVal) return;

    const text  = variation > 0 ? `+${variation.toFixed(2)}%` : `${variation.toFixed(2)}%`;
    const color = variation > 0 ? 'text-green-600' : (variation < 0 ? 'text-red-600' : 'text-gray-600');
    badgeVal.innerHTML = `${label}: <span class="${color} ml-1 font-black">${text}</span>`;
    badgeVal.classList.remove('text-red-500');
    if (container) container.style.opacity = '1';
}

// ──────────────────────────────────────────────
//  CHART
// ──────────────────────────────────────────────
function renderChart(weeklyData, ind) {
    const ctx = document.getElementById('historicalChart').getContext('2d');
    if (myChart) myChart.destroy();

    myChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: weeklyData.map(w => w.label),
            datasets: [
                {
                    type: 'line',
                    label: 'Variação Semanal (%)',
                    data: weeklyData.map(w => w.variation),
                    borderColor: '#4A4A4A', backgroundColor: '#4A4A4A',
                    borderWidth: 3, tension: 0.3, yAxisID: 'y1',
                    pointRadius: 5, pointBackgroundColor: '#fff'
                },
                {
                    type: 'bar',
                    label: 'Valor Médio em R$',
                    data: weeklyData.map(w => w.value),
                    backgroundColor: 'rgba(183, 44, 49, 0.8)',
                    borderRadius: 4, yAxisID: 'y'
                }
            ]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { position: 'top', labels: { font: { family: 'Plus Jakarta Sans', size: 12 } } },
                tooltip: {
                    callbacks: {
                        label(context) {
                            if (context.dataset.type === 'line') return context.dataset.label + ': ' + context.parsed.y.toFixed(2) + '%';
                            const opts = { style: 'currency', currency: 'BRL' };
                            if (ind.id === 'dolar') { opts.minimumFractionDigits = 4; opts.maximumFractionDigits = 4; }
                            return context.dataset.label + ': ' + new Intl.NumberFormat('pt-BR', opts).format(context.parsed.y);
                        }
                    }
                }
            },
            scales: {
                x: { grid: { display: false } },
                y: {
                    type: 'linear', position: 'left',
                    title: { display: true, text: 'Valor Médio Semanal (R$)' },
                    ticks: {
                        callback(val) {
                            if (ind.id === 'dolar') return 'R$ ' + new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 4, maximumFractionDigits: 4 }).format(val);
                            return 'R$ ' + val;
                        }
                    }
                },
                y1: { type: 'linear', position: 'right', title: { display: true, text: 'Variação (%)' }, grid: { drawOnChartArea: false } }
            }
        }
    });
}

// ──────────────────────────────────────────────
//  FOOTER TICKER
// ──────────────────────────────────────────────
function updateFooterTicker() {
    const summaryArr = [];
    INDICATORS.forEach(ind => {
        const d = globalData[ind.id];
        if (!d) return;
        const opts = { style: 'currency', currency: 'BRL' };
        if (ind.id === 'dolar') { opts.minimumFractionDigits = 4; opts.maximumFractionDigits = 4; }
        const val  = new Intl.NumberFormat('pt-BR', opts).format(d.current.value);
        const varT = d.current.variation;
        const icon = varT > 0 ? 'arrow_upward' : (varT < 0 ? 'arrow_downward' : 'remove');
        const col  = varT > 0 ? 'text-green-400' : (varT < 0 ? 'text-red-400' : 'text-gray-400');
        summaryArr.push(`
            <span class="flex items-center gap-2 text-white">
                <b class="text-gray-300 font-label tracking-wide">${ind.name}:</b>
                <span class="font-bold font-body">${val}</span>
                <span class="text-xs ${col} font-bold flex items-center">
                   (${varT.toFixed(2)}%) <span class="material-symbols-outlined text-xs ml-0.5">${icon}</span>
                </span>
            </span>`);
    });
    const html = summaryArr.join('<span class="mx-8 text-gray-600">|</span>');
    document.getElementById('ticker-content-1').innerHTML = html;
    document.getElementById('ticker-content-2').innerHTML = html;
}

// ──────────────────────────────────────────────
//  ROTATION
// ──────────────────────────────────────────────
function startRotation() {
    setInterval(() => {
        const timer = document.getElementById('timer-display');
        let countdown = parseInt(timer.innerText) - 1;
        if (countdown <= 0) {
            countdown = 20;
            currentIndex = (currentIndex + 1) % INDICATORS.length;
            document.getElementById('main-content').style.opacity = '0';
            setTimeout(() => {
                renderIndicator(INDICATORS[currentIndex]);
                document.getElementById('main-content').style.opacity = '1';
            }, 600);
        }
        timer.innerText = countdown;
    }, 1000);

    setInterval(() => fetchAllData().then(() => updateFooterTicker()), REFRESH_INTERVAL_MS);
}

// ──────────────────────────────────────────────
//  BOOT
// ──────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    run();
    initExcelFallback();
});
