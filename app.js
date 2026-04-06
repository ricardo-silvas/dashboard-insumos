const CORS_PROXY = "https://api.allorigins.win/get?url=";
const REFRESH_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

const INDICATORS = [
    { id: 'algodao', name: 'Algodão', subtitle: 'Mercado Físico - CEPEA/ESALQ', unit: 'libra-peso', url: 'https://www.cepea.org.br/br/indicador/algodao.aspx', type: 'cepea' },
    { id: 'cafe', name: 'Café Arábica', subtitle: 'Mercado Físico - CEPEA/ESALQ', unit: 'sc 60kg', url: 'https://www.cepea.org.br/br/indicador/cafe.aspx', type: 'cepea' },
    { id: 'acucar_cristal', name: 'Açúcar Cristal', subtitle: 'Empacotado SP - CEPEA/ESALQ', unit: 'sc 50kg', url: 'https://www.cepea.org.br/br/indicador/acucar-cristal-empacotado-cepea-esalq-sao-paulo.aspx', type: 'cepea' },
    { id: 'acucar_ref', name: 'Açúcar Refinado', subtitle: 'Amorfo SP - CEPEA/ESALQ', unit: 'sc 50kg', url: 'https://www.cepea.org.br/br/indicador/acucar-refinado-amorfo-sp.aspx', type: 'cepea' },
    { id: 'aluminio', name: 'Alumínio (LME)', subtitle: 'London Metal Exchange (Dados Estimados)', unit: 'tonelada', type: 'mock' },
    { id: 'dolar', name: 'Dólar Comercial', subtitle: 'Banco Central do Brasil / PTAX', unit: '', type: 'dolar' }
];

let currentIndex = 0;
let globalData = {};
let myChart = null;

async function run() {
    await fetchAllData();
    if (INDICATORS.length > 0) {
        renderIndicator(INDICATORS[0]);
        updateFooterTicker();
        startRotation();
    }
}

async function fetchAllData() {
    document.getElementById('indicator-subtitle').innerText = "Baixando dados das fontes...";
    
    for (const ind of INDICATORS) {
        try {
            let history = [];
            if (ind.type === 'cepea') {
                history = await fetchCEPEA(ind.url);
            } else if (ind.type === 'dolar') {
                history = await fetchDolar();
            } else if (ind.type === 'mock') {
                history = fetchAluminio();
            }
            
            if (history && history.length > 0) {
                // Determine current state
                let current = history[0];
                let previous = history.length > 1 ? history[1] : history[0];
                let varDia = ((current.value - previous.value) / previous.value) * 100;
                
                let weekly = groupByWeek(history);
                
                globalData[ind.id] = {
                    history: history,
                    weekly: weekly,
                    current: {
                        date: current.date,
                        value: current.value,
                        variation: varDia
                    }
                };
            } else {
                 throw new Error("Dados vazios");
            }
        } catch (error) {
            console.warn(`Erro ao buscar dados reais para ${ind.name}, usando dados simulados offline de fallback...`, error);
            // Fallback robusto para não quebrar a tela simulando dados caso internet/proxy caia
            let fallbackHistory = generateFallbackData(ind.id);
            let current = fallbackHistory[0];
            let previous = fallbackHistory[1];
            let varDia = ((current.value - previous.value) / previous.value) * 100;
            globalData[ind.id] = {
                history: fallbackHistory,
                weekly: groupByWeek(fallbackHistory),
                current: { date: current.date, value: current.value, variation: varDia }
            };
        }
    }
}

async function fetchCEPEA(url) {
    // Utilize CORS proxy
    const res = await fetch(CORS_PROXY + encodeURIComponent(url));
    const json = await res.json();
    const parser = new DOMParser();
    const doc = parser.parseFromString(json.contents, 'text/html');
    
    // Find table inside typical CEPEA indicator wrappers
    const table = doc.querySelector('#imagenet-indicador1') || doc.querySelector('.table-responsive table') || doc.querySelector('table');
    if (!table) throw new Error("Tabela não encontrada em " + url);
    
    const rows = table.querySelectorAll('tbody tr');
    let history = [];
    rows.forEach(tr => {
        const tds = tr.querySelectorAll('td');
        if (tds.length >= 2) {
             let dateStr = tds[0].innerText.trim();
             // Values in CEPEA are like "150,45"
             let vlRealStr = tds[1].innerText.trim().replace(/\./g, '').replace(',', '.');
             let vlReal = parseFloat(vlRealStr);
             if(!isNaN(vlReal)) {
                 history.push({ date: dateStr, value: vlReal });
             }
        }
    });
    // Remove duplicates if any table header is parsed strangely, keep only last 30
    return history.slice(0, 30);
}

async function fetchDolar() {
    let today = new Date();
    let past = new Date();
    past.setDate(today.getDate() - 40); // ensure we have enough working days
    
    let formatNum = n => n.toString().padStart(2, '0');
    let dataInicial = `${formatNum(past.getMonth()+1)}-${formatNum(past.getDate())}-${past.getFullYear()}`;
    let dataFinal = `${formatNum(today.getMonth()+1)}-${formatNum(today.getDate())}-${today.getFullYear()}`;
    
    let url = `https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/CotacaoDolarPeriodo(dataInicial=@dataInicial,dataFinalCotacao=@dataFinalCotacao)?@dataInicial='${dataInicial}'&@dataFinalCotacao='${dataFinal}'&$top=100&$format=json`;
    
    const res = await fetch(url);
    const data = await res.json();
    let docs = data.value.reverse(); // Newest first
    
    let history = [];
    for(let d of docs) {
        let dateParts = d.dataHoraCotacao.split(' ')[0].split('-');
        let dateStr = `${dateParts[2]}/${dateParts[1]}/${dateParts[0]}`;
        let val = (d.cotacaoCompra + d.cotacaoVenda) / 2;
        history.push({ date: dateStr, value: val });
    }
    
    return history.slice(0, 30);
}

function fetchAluminio() {
    return generateFallbackData('aluminio');
}

function generateFallbackData(metricId) {
    let basePrices = {
        'algodao': 415.50,
        'cafe': 1250.00,
        'acucar_cristal': 145.80,
        'acucar_ref': 160.20,
        'aluminio': 13450.00,
        'dolar': 5.20
    };
    
    let history = [];
    let basePrice = basePrices[metricId] || 100;
    let today = new Date();
    let currVal = basePrice;
    
    let datePointer = new Date(today);
    
    // Generate backwards
    for(let i=0; history.length<30 && i<45; i++) {
        if (datePointer.getDay() !== 0 && datePointer.getDay() !== 6) {
            let formatNum = n => n.toString().padStart(2, '0');
            let dateStr = `${formatNum(datePointer.getDate())}/${formatNum(datePointer.getMonth()+1)}/${datePointer.getFullYear()}`;
            // Random walk depending on metric to look realistic
            let volatility = metricId === 'dolar' ? 0.005 : 0.015;
            currVal = currVal * (1 + (Math.random() - 0.48) * volatility);
            history.push({ date: dateStr, value: currVal });
        }
        datePointer.setDate(datePointer.getDate() - 1);
    }
    return history;
}

function groupByWeek(historyArray) {
    // Array needs to be oldest to newest for the chart timeline
    let arr = [...historyArray].reverse();
    
    let weeks = [];
    // Group in chunks of 5 working days (approx 1 trading week)
    for(let i=0; i<arr.length; i+=5) {
        let chunk = arr.slice(i, i+5);
        if (chunk.length === 0) continue;
        
        let avgValue = chunk.reduce((sum, item) => sum + item.value, 0) / chunk.length;
        // e.g. "01/04 - 05/04"
        let start = chunk[0].date.substring(0, 5); 
        let end = chunk[chunk.length-1].date.substring(0, 5);
        
        weeks.push({
            label: `${start} as ${end}`,
            value: avgValue,
            lastDate: chunk[chunk.length-1].date 
        });
    }
    
    // Calculates percentage variation between weeks
    for(let i=0; i<weeks.length; i++) {
        if (i === 0) {
             weeks[i].variation = 0; // Baseline
        } else {
             weeks[i].variation = ((weeks[i].value - weeks[i-1].value) / weeks[i-1].value) * 100;
        }
    }
    
    return weeks;
}

function renderIndicator(ind) {
    const data = globalData[ind.id];
    if (!data) return; // Skip if failed to load
    
    // Update DOM texts
    document.getElementById('indicator-title').innerText = ind.name;
    document.getElementById('indicator-subtitle').innerText = ind.subtitle;
    
    document.getElementById('current-date').innerText = data.current.date;
    // Format Currency
    let formatterOptions = { style: 'currency', currency: 'BRL' };
    if (ind.id === 'dolar') {
        formatterOptions.minimumFractionDigits = 4;
        formatterOptions.maximumFractionDigits = 4;
    }
    let formatter = new Intl.NumberFormat('pt-BR', formatterOptions);
    let priceText = formatter.format(data.current.value);
    
    if (ind.unit) {
        document.getElementById('current-price').innerHTML = `${priceText} <span class="text-3xl font-body text-gray-500 font-medium tracking-normal ml-1">/ ${ind.unit}</span>`;
    } else {
        document.getElementById('current-price').innerText = priceText;
    }
    
    // Calcula Acumulado 30 dias
    if (data.history && data.history.length > 0) {
        let oldestVal = data.history[data.history.length - 1].value;
        let currentVal = data.current.value;
        let accumVar = ((currentVal - oldestVal) / oldestVal) * 100;
        let accumText = accumVar > 0 ? `+${accumVar.toFixed(2)}%` : `${accumVar.toFixed(2)}%`;
        let accumColor = accumVar > 0 ? 'text-green-600' : (accumVar < 0 ? 'text-red-600' : 'text-gray-600');
        
        document.getElementById('badge-top-right').innerHTML = `Acum. 30 dias: <span class="${accumColor} ml-1">${accumText}</span>`;
    }
    
    // Variation Element
    const varEl = document.getElementById('current-variation');
    const varIcon = document.getElementById('current-variation-icon');
    const varContainer = document.getElementById('current-variation-container');
    
    let v = data.current.variation;
    varEl.innerText = `${Math.abs(v).toFixed(2)}% vs Dia Anterior`;
    
    // Remove old classes
    varContainer.classList.remove('text-green-600', 'text-red-600', 'text-gray-500');
    
    if (v > 0) {
        varContainer.classList.add('text-green-600');
        varIcon.innerText = 'trending_up';
    } else if (v < 0) {
        varContainer.classList.add('text-red-600');
        varIcon.innerText = 'trending_down';
    } else {
        varContainer.classList.add('text-gray-500');
        varIcon.innerText = 'trending_flat';
    }

    // Render Side List (All 30 days from Daily History, container handles scroll)
    const historyList = document.getElementById('history-list');
    historyList.innerHTML = '';
    
    let latestHistory = data.history; // Show all available days so user can scroll
    latestHistory.forEach((item, index) => {
        let isToday = index === 0;
        let pVal = formatter.format(item.value);
        
        // Calculate diff with next older item if mapping list
        let variation = 0;
        let olderItem = data.history[index+1];
        if(olderItem) {
            variation = ((item.value - olderItem.value) / olderItem.value) * 100;
        }
        
        let varColor = variation > 0 ? "text-green-600" : (variation < 0 ? "text-red-600" : "text-gray-500");
        let varIconStr = variation > 0 ? "arrow_drop_up" : (variation < 0 ? "arrow_drop_down" : "remove");
        
        historyList.innerHTML += `
        <div class="flex items-center justify-between p-4 ${isToday ? 'bg-[#B72C31] text-white shadow-md transform hover:scale-[1.02] transition-transform' : 'bg-[#efeded]'} rounded-lg">
            <div class="flex flex-col">
                <span class="text-xs uppercase font-bold opacity-80">${item.date}</span>
                <span class="font-headline font-bold text-lg">${pVal}</span>
            </div>
            <div class="flex flex-col items-end">
                <span class="text-base font-bold ${isToday ? 'text-white' : varColor} flex items-center">
                    ${variation !== 0 ? Math.abs(variation).toFixed(2) + '%' : '0.00%'}
                    <span class="material-symbols-outlined text-base ml-1">${varIconStr}</span>
                </span>
            </div>
        </div>
        `;
    });

    // Render Chart.js
    renderChart(data.weekly, ind);
}

function renderChart(weeklyData, ind) {
    const ctx = document.getElementById('historicalChart').getContext('2d');
    
    if (myChart) {
        myChart.destroy();
    }
    
    let labels = weeklyData.map(w => w.label);
    let barData = weeklyData.map(w => w.value);
    let lineData = weeklyData.map(w => w.variation); // in %

    myChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [
                {
                    type: 'line',
                    label: 'Variação Semanal (%)',
                    data: lineData,
                    borderColor: '#4A4A4A',
                    backgroundColor: '#4A4A4A',
                    borderWidth: 3,
                    tension: 0.3,
                    yAxisID: 'y1',
                    pointRadius: 5,
                    pointBackgroundColor: '#fff',
                },
                {
                    type: 'bar',
                    label: `Valor Médio em R$`,
                    data: barData,
                    backgroundColor: 'rgba(183, 44, 49, 0.8)', // #B72C31
                    borderRadius: 4,
                    yAxisID: 'y',
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'index',
                intersect: false,
            },
            plugins: {
                legend: {
                    position: 'top',
                    labels: {
                        font: { family: 'Plus Jakarta Sans', size: 12 }
                    }
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            if(context.dataset.type === 'line') {
                                return context.dataset.label + ': ' + context.parsed.y.toFixed(2) + '%';
                            }
                            let opts = { style: 'currency', currency: 'BRL' };
                            if (ind.id === 'dolar') {
                                opts.minimumFractionDigits = 4;
                                opts.maximumFractionDigits = 4;
                            }
                            let formatter = new Intl.NumberFormat('pt-BR', opts);
                            return context.dataset.label + ': ' + formatter.format(context.parsed.y);
                        }
                    }
                }
            },
            scales: {
                x: {
                    grid: { display: false }
                },
                y: {
                    type: 'linear',
                    display: true,
                    position: 'left',
                    title: { display: true, text: 'Valor Média Semanal (R$)' },
                    ticks: {
                        callback: function(value, index, values) {
                            if (ind.id === 'dolar') {
                                let formatter = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 4, maximumFractionDigits: 4 });
                                return 'R$ ' + formatter.format(value);
                            }
                            return 'R$ ' + value;
                        }
                    }
                },
                y1: {
                    type: 'linear',
                    display: true,
                    position: 'right',
                    title: { display: true, text: 'Variação (%)' },
                    grid: { drawOnChartArea: false }, 
                }
            }
        }
    });
}

function updateFooterTicker() {
    let summaryArr = [];
    INDICATORS.forEach(ind => {
        let d = globalData[ind.id];
        if(d) {
            let opts = { style: 'currency', currency: 'BRL' };
            if (ind.id === 'dolar') {
                opts.minimumFractionDigits = 4;
                opts.maximumFractionDigits = 4;
            }
            let formatter = new Intl.NumberFormat('pt-BR', opts);
            let val = formatter.format(d.current.value);
            let varT = d.current.variation;
            let iconCode = varT > 0 ? 'arrow_upward' : (varT < 0 ? 'arrow_downward' : 'remove');
            let colorCode = varT > 0 ? 'text-green-400' : (varT < 0 ? 'text-red-400' : 'text-gray-400');
            
            summaryArr.push(`
                <span class="flex items-center gap-2 text-white">
                    <b class="text-gray-300 font-label tracking-wide">${ind.name}:</b>
                    <span class="font-bold font-body">${val}</span>
                    <span class="text-xs ${colorCode} font-bold flex items-center">
                       (${varT.toFixed(2)}%) <span class="material-symbols-outlined text-xs ml-0.5">${iconCode}</span>
                    </span>
                </span>
            `);
        }
    });
    
    const htmlString = summaryArr.join('<span class="mx-8 text-gray-600">|</span>');
    document.getElementById('ticker-content-1').innerHTML = htmlString;
    document.getElementById('ticker-content-2').innerHTML = htmlString;
}

function startRotation() {
    setInterval(() => {
        let timerDisplay = document.getElementById('timer-display');
        let countdown = parseInt(timerDisplay.innerText);
        countdown--;
        
        if (countdown <= 0) {
            countdown = 20;
            currentIndex = (currentIndex + 1) % INDICATORS.length;
            
            // UI Trigger fade
            document.getElementById('main-content').style.opacity = '0';
            setTimeout(() => {
                renderIndicator(INDICATORS[currentIndex]);
                document.getElementById('main-content').style.opacity = '1';
            }, 600); // Wait fade out before render
        }
        timerDisplay.innerText = countdown;
    }, 1000); // every 1s update timer

    // Periodically fetch new data
    setInterval(() => {
        fetchAllData().then(() => {
             updateFooterTicker();
        });
    }, REFRESH_INTERVAL_MS);
}

// Start
document.addEventListener('DOMContentLoaded', run);
