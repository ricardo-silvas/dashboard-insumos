/**
 * public/app.js — Dashboard Insumos Fortpel
 * ─────────────────────────────────────────────────────────────────────────────
 * Frontend simplificado:
 *  - Consome /api/data/all (sem CORS proxy, sem processamento Excel no browser)
 *  - Suporte a seletor de período 6M / 12M no gráfico
 *  - Série histórica completa a partir dos dados pré-processados
 * ─────────────────────────────────────────────────────────────────────────────
 */

const REFRESH_INTERVAL_MS = 60 * 60 * 1000; // 1 hora

const INDICATORS = [
    { id: 'cafe_arabica',   name: 'Café Arábica',    subtitle: 'Mercado Físico - CEPEA/ESALQ',           unit: 'sc 60kg'  },
    { id: 'cafe_robusta',   name: 'Café Robusta',    subtitle: 'Mercado Físico - CEPEA/ESALQ',           unit: 'sc 60kg'  },
    { id: 'acucar_cristal', name: 'Açúcar Cristal',  subtitle: 'Empacotado SP - CEPEA/ESALQ',            unit: 'sc 50kg'  },
    { id: 'acucar_ref',     name: 'Açúcar Refinado', subtitle: 'Amorfo SP - CEPEA/ESALQ',                unit: 'sc 50kg'  },
    { id: 'aluminio',       name: 'Alumínio (LME)',  subtitle: 'London Metal Exchange (Estimado)',        unit: 'tonelada' },
    { id: 'dolar',          name: 'Dólar Comercial', subtitle: 'Banco Central do Brasil / PTAX',         unit: ''         },
    { id: 'algodao',        name: 'Algodão',         subtitle: 'Mercado Físico - CEPEA/ESALQ',           unit: 'libra-peso'},
];

// ─── Estado global ────────────────────────────────────────────────────────────
let currentIndex  = 0;
let globalData    = {};   // { [id]: { records, meta, name, unit, source } }
let myChart       = null;
let chartPeriod   = '6m'; // '6m' | '12m'

// ─── Utilitários ─────────────────────────────────────────────────────────────

function parseISO(isoStr) {
    if (!isoStr) return new Date(0);
    return new Date(isoStr + 'T00:00:00');
}

function formatDateBR(isoStr) {
    if (!isoStr) return '--/--/----';
    const [y, m, d] = isoStr.split('-');
    return `${d}/${m}/${y}`;
}

function groupByWeek(records) {
    // records: [ { date: ISO, value }, ... ] ordenado mais antigo primeiro
    const weeks = [];
    for (let i = 0; i < records.length; i += 5) {
        const chunk = records.slice(i, i + 5);
        if (!chunk.length) continue;
        const avg   = chunk.reduce((s, x) => s + x.value, 0) / chunk.length;
        const start = formatDateBR(chunk[0].date).substring(0, 5);
        const end   = formatDateBR(chunk[chunk.length-1].date).substring(0, 5);
        weeks.push({ label: `${start} a ${end}`, value: avg, lastDate: chunk[chunk.length-1].date });
    }
    // Variação semanal
    for (let i = 0; i < weeks.length; i++) {
        weeks[i].variation = i === 0 ? 0 : ((weeks[i].value - weeks[i-1].value) / weeks[i-1].value) * 100;
    }
    return weeks;
}

/** Filtrar registros da série pelos últimos N meses */
function filterPeriod(records, months) {
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - months);
    return records.filter(r => parseISO(r.date) >= cutoff);
}

// ─── Carregar todos os indicadores ────────────────────────────────────────────

async function fetchAllData() {
    document.getElementById('indicator-subtitle').innerText = 'Carregando dados...';
    try {
        const res  = await fetch('/api/data/all');
        const json = await res.json();

        for (const ind of INDICATORS) {
            const raw = json.data?.[ind.id];
            if (!raw || raw.error) {
                console.warn(`Indicador ${ind.id} indisponível:`, raw?.error || 'sem dados');
                continue;
            }
            globalData[ind.id] = raw;
        }
    } catch (e) {
        console.error('Erro ao carregar dados da API:', e);
    }
}

// ─── Render ───────────────────────────────────────────────────────────────────

function renderIndicator(ind) {
    const raw = globalData[ind.id];
    if (!raw || !raw.records || raw.records.length === 0) {
        document.getElementById('indicator-title').innerText    = ind.name;
        document.getElementById('indicator-subtitle').innerText = 'Dados indisponíveis';
        return;
    }

    // Os records vêm em ordem cronológica (antigo → novo)
    // O "atual" é o último registro
    const allRecs  = raw.records;
    const current  = allRecs[allRecs.length - 1];
    const previous = allRecs.length > 1 ? allRecs[allRecs.length - 2] : current;
    const varDia   = ((current.value - previous.value) / previous.value) * 100;

    // ── Header ──
    document.getElementById('indicator-title').innerText    = ind.name;
    document.getElementById('indicator-subtitle').innerText = raw.source || ind.subtitle;
    document.getElementById('current-date').innerText       = formatDateBR(current.date);

    // ── Preço atual ──
    const fmtOpts = { style: 'currency', currency: 'BRL' };
    if (ind.id === 'dolar') { fmtOpts.minimumFractionDigits = 4; fmtOpts.maximumFractionDigits = 4; }
    const formatter = new Intl.NumberFormat('pt-BR', fmtOpts);

    document.getElementById('current-price').innerHTML = ind.unit
        ? `${formatter.format(current.value)} <span class="text-3xl font-body text-gray-500 font-medium tracking-normal ml-1">/ ${ind.unit}</span>`
        : formatter.format(current.value);

    // ── Variação diária ──
    const varEl        = document.getElementById('current-variation');
    const varIcon      = document.getElementById('current-variation-icon');
    const varContainer = document.getElementById('current-variation-container');
    varEl.innerText = `${Math.abs(varDia).toFixed(2)}% vs Dia Anterior`;
    varContainer.classList.remove('text-green-600', 'text-red-600', 'text-gray-500');
    if      (varDia > 0) { varContainer.classList.add('text-green-600'); varIcon.innerText = 'trending_up'; }
    else if (varDia < 0) { varContainer.classList.add('text-red-600');   varIcon.innerText = 'trending_down'; }
    else                 { varContainer.classList.add('text-gray-500');  varIcon.innerText = 'trending_flat'; }

    // ── Badges 30d / 6m / 12m ──
    // 30 dias: usando registros da série
    const recs30d = filterPeriod(allRecs, 1);
    if (recs30d.length > 1) {
        const oldest30 = recs30d[0].value;
        updateBadge('30d', ((current.value - oldest30) / oldest30) * 100, '30 dias');
    } else {
        setBadgeUnavailable('30d');
    }

    const val6m  = raw.meta?.val_6m;
    const val12m = raw.meta?.val_12m;

    if (val6m !== null && val6m !== undefined) {
        updateBadge('6m',  ((current.value - val6m)  / val6m)  * 100, '6 meses');
    } else {
        setBadgeUnavailable('6m');
    }

    if (val12m !== null && val12m !== undefined) {
        updateBadge('12m', ((current.value - val12m) / val12m) * 100, '12 meses');
    } else {
        setBadgeUnavailable('12m');
    }

    // ── Lista de lançamentos (últimos 30 dias) ──
    const historyList = document.getElementById('history-list');
    historyList.innerHTML = '';
    const recent = [...allRecs].reverse().slice(0, 30); // últimos 30, mais recente primeiro

    recent.forEach((item, index) => {
        const isToday   = index === 0;
        const pVal      = formatter.format(item.value);
        const older     = recent[index + 1];
        const variation = older ? ((item.value - older.value) / older.value) * 100 : 0;
        const vColor    = variation > 0 ? 'text-green-600' : (variation < 0 ? 'text-red-600' : 'text-gray-500');
        const vIcon     = variation > 0 ? 'arrow_drop_up'  : (variation < 0 ? 'arrow_drop_down' : 'remove');
        historyList.innerHTML += `
        <div class="flex items-center justify-between p-4 ${isToday ? 'bg-[#B72C31] text-white shadow-md transform hover:scale-[1.02] transition-transform' : 'bg-[#efeded]'} rounded-lg">
            <div class="flex flex-col">
                <span class="text-xs uppercase font-bold opacity-80">${formatDateBR(item.date)}</span>
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

    // ── Gráfico ──
    renderChart(allRecs, ind);
}

// ─── Badges ───────────────────────────────────────────────────────────────────

function setBadgeUnavailable(period) {
    const badgeVal  = document.getElementById(`badge-val-${period}`);
    const container = document.getElementById(`badge-container-${period}`);
    if (badgeVal)  { badgeVal.innerText = 'Indisponível'; badgeVal.classList.remove('text-red-500'); }
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

// ─── Gráfico ──────────────────────────────────────────────────────────────────

function renderChart(allRecs, ind) {
    const months  = chartPeriod === '12m' ? 12 : 6;
    const filtered = filterPeriod(allRecs, months);

    // Agrupar por semana para reduzir pontos no gráfico
    const weeklyData = groupByWeek(filtered);

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
                    pointRadius: 4, pointBackgroundColor: '#fff',
                },
                {
                    type: 'bar',
                    label: 'Valor Médio Semanal (R$)',
                    data: weeklyData.map(w => w.value),
                    backgroundColor: 'rgba(183,44,49,0.82)',
                    borderRadius: 4, yAxisID: 'y',
                },
            ],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { position: 'top', labels: { font: { family: 'Plus Jakarta Sans', size: 12 } } },
                tooltip: {
                    callbacks: {
                        label(ctx) {
                            if (ctx.dataset.type === 'line') return ctx.dataset.label + ': ' + ctx.parsed.y.toFixed(2) + '%';
                            const opts = { style: 'currency', currency: 'BRL' };
                            if (ind.id === 'dolar') { opts.minimumFractionDigits = 4; opts.maximumFractionDigits = 4; }
                            return ctx.dataset.label + ': ' + new Intl.NumberFormat('pt-BR', opts).format(ctx.parsed.y);
                        },
                    },
                },
            },
            scales: {
                x: { grid: { display: false } },
                y: {
                    type: 'linear', position: 'left',
                    title: { display: true, text: `Valor Médio Semanal (R$) — ${chartPeriod === '12m' ? '12 Meses' : '6 Meses'}` },
                    ticks: {
                        callback(val) {
                            if (ind.id === 'dolar') return 'R$ ' + new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 4, maximumFractionDigits: 4 }).format(val);
                            return 'R$ ' + val.toLocaleString('pt-BR');
                        },
                    },
                },
                y1: {
                    type: 'linear', position: 'right',
                    title: { display: true, text: 'Variação (%)' },
                    grid: { drawOnChartArea: false },
                },
            },
        },
    });
}

// ─── Footer Ticker ────────────────────────────────────────────────────────────

function updateFooterTicker() {
    const summaryArr = [];
    for (const ind of INDICATORS) {
        const raw = globalData[ind.id];
        if (!raw || !raw.records?.length) continue;
        const allRecs  = raw.records;
        const current  = allRecs[allRecs.length - 1];
        const previous = allRecs.length > 1 ? allRecs[allRecs.length - 2] : current;
        const varT     = ((current.value - previous.value) / previous.value) * 100;
        const opts     = { style: 'currency', currency: 'BRL' };
        if (ind.id === 'dolar') { opts.minimumFractionDigits = 4; opts.maximumFractionDigits = 4; }
        const val  = new Intl.NumberFormat('pt-BR', opts).format(current.value);
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
    }
    const html = summaryArr.join('<span class="mx-8 text-gray-600">|</span>');
    document.getElementById('ticker-content-1').innerHTML = html;
    document.getElementById('ticker-content-2').innerHTML = html;
}

// ─── Seletor de período ───────────────────────────────────────────────────────

function setPeriod(period) {
    chartPeriod = period;
    // Atualizar estilos dos botões
    document.getElementById('btn-6m').classList.toggle('bg-[#B72C31]', period === '6m');
    document.getElementById('btn-6m').classList.toggle('text-white',   period === '6m');
    document.getElementById('btn-6m').classList.toggle('bg-[#efeded]', period !== '6m');
    document.getElementById('btn-6m').classList.toggle('text-gray-600',period !== '6m');
    document.getElementById('btn-12m').classList.toggle('bg-[#B72C31]',period === '12m');
    document.getElementById('btn-12m').classList.toggle('text-white',  period === '12m');
    document.getElementById('btn-12m').classList.toggle('bg-[#efeded]',period !== '12m');
    document.getElementById('btn-12m').classList.toggle('text-gray-600',period !== '12m');
    // Re-renderizar gráfico
    if (INDICATORS[currentIndex]) renderIndicator(INDICATORS[currentIndex]);
}

// ─── Rotação automática ───────────────────────────────────────────────────────

function startRotation() {
    setInterval(() => {
        const timer = document.getElementById('timer-display');
        let countdown = parseInt(timer.innerText) - 1;
        if (countdown <= 0) {
            countdown = 20;
            // Avançar somente para indicadores com dados
            let tries = 0;
            do {
                currentIndex = (currentIndex + 1) % INDICATORS.length;
                tries++;
            } while (!globalData[INDICATORS[currentIndex]?.id] && tries < INDICATORS.length);

            const main = document.getElementById('main-content');
            main.style.opacity = '0';
            setTimeout(() => {
                renderIndicator(INDICATORS[currentIndex]);
                main.style.opacity = '1';
            }, 600);
        }
        timer.innerText = countdown;
    }, 1000);

    // Atualizar dados a cada hora
    setInterval(() => fetchAllData().then(() => {
        renderIndicator(INDICATORS[currentIndex]);
        updateFooterTicker();
    }), REFRESH_INTERVAL_MS);
}

// ─── Boot ─────────────────────────────────────────────────────────────────────

async function run() {
    await fetchAllData();

    // Encontrar primeiro indicador com dados
    const firstValid = INDICATORS.findIndex(i => globalData[i.id]?.records?.length > 0);
    currentIndex = firstValid >= 0 ? firstValid : 0;

    if (INDICATORS[currentIndex]) {
        renderIndicator(INDICATORS[currentIndex]);
        updateFooterTicker();
        startRotation();
    }
}

document.addEventListener('DOMContentLoaded', () => {
    // Botões de período
    document.getElementById('btn-6m')?.addEventListener('click',  () => setPeriod('6m'));
    document.getElementById('btn-12m')?.addEventListener('click', () => setPeriod('12m'));
    setPeriod('6m'); // default
    run();
});

// Recarregar a página a cada 15 minutos para evitar que a Smart TV desligue a tela
setInterval(() => {
    window.location.reload();
}, 15 * 60 * 1000);

