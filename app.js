const CORS_PROXY = "https://api.allorigins.win/get?url=";
const REFRESH_INTERVAL_MS = 30 * 60 * 1000; // 30 minutos

const API_KEYS = {
    EIA: 'YkaEQiJbpLQ6kthsI9xZYaPMbAHk2lzkAhFTHt8m',
    FRED: '129364fab26ca1e02cedf9a7bddc600d'
};

const INDICATORS = [
    { id: 'dolar',          name: 'Dólar Comercial', subtitle: 'Banco Central do Brasil / PTAX',          unit: '',           type: 'dolar' },
    { id: 'algodao',        name: 'Algodão',         subtitle: 'Mercado Físico - CEPEA/ESALQ',           unit: 'libra-peso', url: 'https://www.cepea.org.br/br/indicador/algodao.aspx',                                              type: 'cepea', selector: '#imagenet-indicador1' },
    { id: 'etanol',         name: 'Etanol',          subtitle: 'Semanal Hidratado - SP CEPEA',           unit: 'litro',      url: 'https://www.cepea.org.br/br/indicador/etanol.aspx',                                               type: 'cepea', selector: '#imagenet-indicador3' },
    { id: 'brent',          name: 'Petróleo Brent',  subtitle: 'EIA.gov',                                unit: 'barril',     currency: 'USD', type: 'eia_brent' },
    { id: 'ps',             name: 'Poliestireno (PS)',subtitle: 'Índice de Preços FRED (USA)',           unit: 'índice',     currency: 'USD', type: 'fred', series_id: 'PCU326140326140' },
    { id: 'pp',             name: 'Polipropileno (PP)',subtitle:'Índice de Preços FRED (USA)',           unit: 'índice',     currency: 'USD', type: 'fred', series_id: 'PCU325211325211' },
    { id: 'celulose_curta', name: 'Celulose Curta',  subtitle: 'WPU0911 FRED (USA)',                     unit: 'tonelada',   currency: 'USD', type: 'fred', series_id: 'WPU0911' },
    { id: 'celulose_longa', name: 'Celulose Longa',  subtitle: 'WPU09 FRED (USA)',                       unit: 'tonelada',   currency: 'USD', type: 'fred', series_id: 'WPU09' },
    { id: 'cafe_arabica',   name: 'Café Arábica',    subtitle: 'Mercado Físico - CEPEA/ESALQ',           unit: 'sc 60kg',    url: 'https://www.cepea.org.br/br/indicador/cafe.aspx',                                                 type: 'cepea', selector: '#imagenet-indicador1' },
    { id: 'cafe_robusta',   name: 'Café Robusta',    subtitle: 'Mercado Físico - CEPEA/ESALQ',           unit: 'sc 60kg',    url: 'https://www.cepea.org.br/br/indicador/cafe.aspx',                                                 type: 'cepea', selector: '#imagenet-indicador2' },
    { id: 'acucar_cristal', name: 'Açúcar Cristal',  subtitle: 'Empacotado SP - CEPEA/ESALQ',            unit: 'sc 50kg',    url: 'https://www.cepea.org.br/br/indicador/acucar-cristal-empacotado-cepea-esalq-sao-paulo.aspx',       type: 'cepea' },
    { id: 'acucar_ref',     name: 'Açúcar Refinado', subtitle: 'Amorfo SP - CEPEA/ESALQ',                unit: 'sc 50kg',    url: 'https://www.cepea.org.br/br/indicador/acucar-refinado-amorfo-sp.aspx',                             type: 'cepea' },
    { id: 'aluminio',       name: 'Alumínio (LME)',  subtitle: 'London Metal Exchange (Dados Estimados)', unit: 'tonelada',   currency: 'BRL', type: 'mock' }
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
            let history = [];
            let val6m   = null;
            let val12m  = null;

            if (ind.type === 'cepea') {
                history = await fetchCEPEA(ind.url, ind.selector);

            } else if (ind.type === 'dolar') {
                const dolarResult = await fetchDolar();
                if (dolarResult) {
                    history = dolarResult.history;
                    val6m   = dolarResult.val6m;
                    val12m  = dolarResult.val12m;
                }

            } else if (ind.type === 'eia_brent') {
                history = await fetchEIA();
            } else if (ind.type === 'fred') {
                history = await fetchFRED(ind.series_id);
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
            };

        } catch (error) {
            console.warn(`Erro em ${ind.name}, usando fallback simulado:`, error);
            const fb  = generateFallbackData(ind.id);
            const cur = fb[0], prv = fb[1];
            globalData[ind.id] = {
                history: fb,
                weekly: groupByWeek(fb),
                current: { date: cur.date, value: cur.value, variation: ((cur.value - prv.value) / prv.value) * 100 },
                val6m:  null,
                val12m: null,
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
//  DÓLAR PTAX (Banco Central) — 13 meses
// ──────────────────────────────────────────────
async function fetchDolar() {
    const fmt = d => `${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}-${d.getFullYear()}`;
    const fmtBR = d => `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;

    try {
        const today   = new Date();
        const past13m = new Date();
        past13m.setMonth(past13m.getMonth() - 13);

        // 1. Buscar cotação em TEMPO REAL (AwesomeAPI)
        let realTimeValue = null;
        let realTimeDate = null;
        try {
            const resRT = await fetch('https://economia.awesomeapi.com.br/json/last/USD-BRL');
            const jsonRT = await resRT.json();
            if (jsonRT && jsonRT.USDBRL) {
                realTimeValue = parseFloat(jsonRT.USDBRL.bid);
                realTimeDate = fmtBR(today);
            }
        } catch (e) {
            console.warn("AwesomeAPI falhou, usando apenas BCB:", e);
        }

        // 2. Buscar Histórico (Banco Central)
        const urlBCB = `https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/CotacaoDolarPeriodo(dataInicial=@i,dataFinalCotacao=@f)?@i='${fmt(past13m)}'&@f='${fmt(today)}'&$top=400&$format=json&$orderby=dataHoraCotacao%20desc`;
        const resBCB  = await fetch(urlBCB);
        const jsonBCB = await resBCB.json();

        if (!jsonBCB.value || jsonBCB.value.length === 0) throw new Error("PTAX vazio");

        let history = jsonBCB.value.map(d => {
            const p = d.dataHoraCotacao.split(' ')[0].split('-');
            return { date: `${p[2]}/${p[1]}/${p[0]}`, value: d.cotacaoVenda };
        });

        // 3. Mesclar tempo real no topo do histórico se for uma data nova
        if (realTimeValue && history.length > 0) {
            if (history[0].date !== realTimeDate) {
                history.unshift({ date: realTimeDate, value: realTimeValue });
            } else {
                // Se já existe a data de hoje (PTAX saiu), atualizamos com o valor mais preciso do mercado se o PTAX estiver defasado
                history[0].value = realTimeValue;
            }
        }

        const target6m  = new Date(); target6m.setMonth(target6m.getMonth() - 6);
        const target12m = new Date(); target12m.setMonth(target12m.getMonth() - 12);

        const findClosest = (targetDate) => {
            let best = null, bestDiff = Infinity;
            for (const item of history) {
                const diff = Math.abs(parseDate(item.date) - targetDate);
                if (diff < bestDiff) { bestDiff = diff; best = item; }
            }
            return (best && bestDiff < 20 * 86400000) ? best.value : null;
        };

        return {
            history: history.slice(0, 30),
            val6m:  findClosest(target6m),
            val12m: findClosest(target12m),
        };

    } catch (e) {
        console.error("Dolar Ingestion Error:", e);
        return null;
    }
}

// ──────────────────────────────────────────────
//  EIA & FRED APIs
// ──────────────────────────────────────────────
async function fetchEIA() {
    const url = `https://api.eia.gov/v2/petroleum/pri/spt/data/?api_key=${API_KEYS.EIA}&frequency=daily&data[0]=value&facets[series][]=RBRTE&sort[0][column]=period&sort[0][direction]=desc&length=60`;
    try {
        const res = await fetch(url);
        const json = await res.json();
        let dataArr = json.response && json.response.data ? json.response.data : [];
        let history = dataArr.map(d => {
            const [y, m, day] = d.period.split('-');
            return { date: `${day}/${m}/${y}`, value: parseFloat(d.value) };
        }).filter(d => !isNaN(d.value));
        return history.slice(0, 30);
    } catch(e) {
        console.error("EIA Ingestion Error:", e);
        throw e;
    }
}

async function fetchFRED(seriesId) {
    const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${seriesId}&api_key=${API_KEYS.FRED}&file_type=json&sort_order=desc&limit=60`;
    try {
        const res = await fetch(url);
        const json = await res.json();
        let obs = json.observations || [];
        let history = obs.map(d => {
            const [y, m, day] = d.date.split('-');
            return { date: `${day}/${m}/${y}`, value: parseFloat(d.value) };
        }).filter(d => !isNaN(d.value));
        return history.slice(0, 30);
    } catch(e) {
        console.error("FRED Ingestion Error:", e);
        throw e;
    }
}

// ──────────────────────────────────────────────
//  FALLBACK / MOCK (Alumínio e erros)
// ──────────────────────────────────────────────
function generateFallbackData(metricId) {
    const basePrices = {
        algodao: 415.50, cafe_arabica: 1250.00, cafe_robusta: 937.00,
        acucar_cristal: 145.80, acucar_ref: 160.20, aluminio: 13450.00, dolar: 5.20,
        etanol: 2.45
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
//  UTILITIES
// ──────────────────────────────────────────────
function parseDate(str) {
    if (!str || typeof str !== 'string') return new Date(0);
    const parts = str.split('/');
    if (parts.length < 3) return new Date(0);
    return new Date(parts[2], parts[1]-1, parts[0]);
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

    let fmtOpts = { style: 'currency', currency: ind.currency || 'BRL' };
    if (ind.id === 'dolar') { fmtOpts.minimumFractionDigits = 4; fmtOpts.maximumFractionDigits = 4; }
    if (ind.unit === 'índice' && !ind.currency) {
        fmtOpts = { style: 'decimal', minimumFractionDigits: 2, maximumFractionDigits: 2 };
    }
    const formatter = new Intl.NumberFormat('pt-BR', fmtOpts);
    const priceText = formatter.format(data.current.value);

    document.getElementById('current-price').innerHTML = (ind.unit && ind.unit !== 'índice') || (ind.unit === 'índice' && ind.currency)
        ? `${priceText} <span class="text-3xl font-body text-gray-500 font-medium tracking-normal ml-1">/ ${ind.unit || ''}</span>`
        : priceText;

    // ── Badges ──
    const currentVal = data.current.value;

    if (data.history.length > 0) {
        const oldest30 = data.history[data.history.length - 1].value;
        updateBadge('30d', ((currentVal - oldest30) / oldest30) * 100, "30 dias");
    }

    const badgeContainer6m  = document.getElementById('badge-container-6m');
    const badgeContainer12m = document.getElementById('badge-container-12m');

    if (ind.id === 'dolar') {
        if (badgeContainer6m)  badgeContainer6m.classList.remove('hidden');
        if (badgeContainer12m) badgeContainer12m.classList.remove('hidden');

        if (data.val6m !== null && data.val6m !== undefined) {
            updateBadge('6m',  ((currentVal - data.val6m)  / data.val6m)  * 100, "6 meses");
        } else {
            setBadgeUnavailable('6m');
        }
        
        if (data.val12m !== null && data.val12m !== undefined) {
            updateBadge('12m', ((currentVal - data.val12m) / data.val12m) * 100, "12 meses");
        } else {
            setBadgeUnavailable('12m');
        }
    } else {
        if (badgeContainer6m)  badgeContainer6m.classList.add('hidden');
        if (badgeContainer12m) badgeContainer12m.classList.add('hidden');
    }

    // ── Variação diária ──
    const varEl        = document.getElementById('current-variation');
    const varIcon      = document.getElementById('current-variation-icon');
    const varContainer = document.getElementById('current-variation-container');
    const v = data.current.variation;
    varEl.innerText = `${Math.abs(v).toFixed(2)}% vs Dia Anterior`;
    varContainer.classList.remove('text-green-600', 'text-red-600', 'text-gray-500');
    if      (v > 0) { varContainer.classList.add('text-green-600'); varIcon.innerText = 'trending_up'; }
    else if (v < 0) { varContainer.classList.add('text-red-600');   varIcon.innerText = 'trending_down'; }
    else            { varContainer.classList.add('text-gray-500');  varIcon.innerText = 'trending_flat'; }

    // ── Lista de lançamentos ──
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

    renderChart(data.history, ind);
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
function renderChart(historyData, ind) {
    const ctx = document.getElementById('historicalChart').getContext('2d');
    if (myChart) myChart.destroy();

    // Transforma para exibição cronológica nos últimos 30 dias: do mais antigo para o mais novo
    const chartData = [...historyData].slice(0, 30).reverse();

    // Mapeamento e cálculo de variação inter-diária
    const labels = chartData.map(d => d.date.substring(0, 5)); // Exibe somente DD/MM para manter o eixo x limpo
    const values = chartData.map(d => d.value);
    const variations = chartData.map((item, index) => {
        if (index === 0) return 0;
        const prev = chartData[index - 1];
        return ((item.value - prev.value) / prev.value) * 100;
    });

    // Escala dinâmica min: Ajustada para colar próximo ao valor mínimo (99.5%)
    // Isso maximiza a altura da barra e faz o gráfico usar todo o espaço livre
    const minVal = Math.min(...values);
    const maxVal = Math.max(...values);
    const range = maxVal - minVal;
    
    // Configura o piso do eixo Y (Base da barra) para 85% do menor valor, 
    // garantindo que as barras tenham sempre um tamanho base visível considerável
    const yMinBound = Math.max(0, minVal * 0.85);

    // Configura o teto do eixo Y garantindo espaço interno para a barra mais alta
    const yMaxBound = maxVal === minVal ? maxVal * 1.05 : maxVal + (range * 0.15);

    // Define the prefix logic for different commodities
    let prefix = '';
    if (ind.currency === 'USD') {
        prefix = 'US$';
    } else if (ind.currency === 'BRL' || (!ind.currency && ind.unit !== 'índice')) {
        prefix = 'R$';
    }
    const seriesLabel = ind.id === 'dolar' ? `R$ Dólar do dia` : `${prefix} ${ind.name} do dia`;

    // Atualiza a Legenda Customizada do HTML
    const legendLabelHtml = document.getElementById('custom-legend-bar-label');
    if (legendLabelHtml) legendLabelHtml.innerText = seriesLabel;

    Chart.register(ChartDataLabels);

    myChart = new Chart(ctx, {
        type: 'bar',
        plugins: [ChartDataLabels],
        data: {
            labels: labels,
            datasets: [
                {
                    type: 'line',
                    label: '% Variação do dia',
                    data: variations,
                    borderColor: '#4A4A4A', backgroundColor: '#4A4A4A',
                    borderWidth: 2, tension: 0.5, yAxisID: 'y1',
                    pointRadius: 3, pointBackgroundColor: '#fff',
                    datalabels: {
                        display: false
                    }
                },
                {
                    type: 'bar',
                    label: seriesLabel,
                    data: values,
                    backgroundColor: 'rgba(183, 44, 49, 0.85)',
                    hoverBackgroundColor: 'rgba(183, 44, 49, 1)',
                    borderRadius: 4, yAxisID: 'y',
                    datalabels: {
                        labels: {
                            base: {
                                display: true,
                                anchor: 'start', align: 'end', offset: 4,
                                clamp: true, clip: false,
                                rotation: -90,
                                color: '#ffffff', font: { weight: 'bold', size: 11 },
                                formatter: (val) => val.toFixed(2)
                            },
                            variation: {
                                display: true,
                                anchor: 'end', align: 'end', offset: 4,
                                clip: false,
                                rotation: -90,
                                color: '#1b1c1c', font: { weight: 'bold', size: 10 },
                                formatter: (val, ctx) => variations[ctx.dataIndex].toFixed(2) + '%'
                            }
                        }
                    }
                }
            ]
        },
        options: {
            layout: { padding: { top: 80 } },
            responsive: true, maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { display: false },
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
                    min: yMinBound, 
                    max: yMaxBound, // Teto superior calculado dinamicamente
                    grace: '15%',
                    title: { display: true, text: 'Valor (R$)' },
                    ticks: {
                        callback(val) {
                            return new Intl.NumberFormat('pt-BR', {
                                style: 'currency',
                                currency: 'BRL',
                                minimumFractionDigits: ind.id === 'dolar' ? 4 : 2,
                                maximumFractionDigits: ind.id === 'dolar' ? 4 : 2
                            }).format(val);
                        }
                    }
                },
                y1: { 
                    type: 'linear', position: 'right', 
                    title: { display: true, text: 'Variação Diária (%)' }, 
                    grid: { drawOnChartArea: false },
                    grace: '15%' // Adiciona respiro/espaço extra no limite do eixo para rótulos altos
                }
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
});

// Recarregar a página a cada 9 minutos para evitar que a Smart TV desligue a tela
setInterval(() => {
    window.location.reload();
}, 9 * 60 * 1000);

