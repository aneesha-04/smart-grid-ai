let forecastChart = null;
let baselineData = null;
let baselineForecast = null;

const themeToggle = document.getElementById('themeToggle');
const searchBtn = document.getElementById('searchBtn');
const cityInput = document.getElementById('cityInput');

// Slider Elements
const demandSlider = document.getElementById('demandSlider');
const supplySlider = document.getElementById('supplySlider');
const demandValDisplay = document.getElementById('demandValDisplay');
const supplyValDisplay = document.getElementById('supplyValDisplay');

// Battery Elements
const batteryValue = document.getElementById('batteryValue');
const batteryFill = document.getElementById('batteryFill');
const batteryStatusText = document.getElementById('batteryStatusText');
const gridImportBox = document.getElementById('gridImportBox');
const gridImportValue = document.getElementById('gridImportValue');

const BATTERY_MAX = 1000;
let batteryCurrent = 500;

// Slider Events
demandSlider.addEventListener('input', () => {
    demandValDisplay.textContent = `${demandSlider.value}x`;
    if (baselineForecast) runSimulation();
});

supplySlider.addEventListener('input', () => {
    supplyValDisplay.textContent = `${supplySlider.value}x`;
    if (baselineForecast) runSimulation();
});

// Theme Toggle
themeToggle.addEventListener('click', () => {
    document.body.classList.toggle('dark-theme');
    const isDark = document.body.classList.contains('dark-theme');
    themeToggle.textContent = isDark ? '☀️ Light Mode' : '🌙 Dark Mode';
    
    if (forecastChart) {
        updateChartTheme(isDark);
    }
});

function updateChartTheme(isDark) {
    const textColor = isDark ? '#f8fafc' : '#64748b';
    const gridColor = isDark ? '#334155' : '#e2e8f0';
    
    forecastChart.options.plugins.legend.labels.color = textColor;
    forecastChart.options.scales.x.ticks.color = textColor;
    forecastChart.options.scales.y.ticks.color = textColor;
    if (forecastChart.options.scales.x.grid) {
        forecastChart.options.scales.x.grid.color = gridColor;
    }
    if (forecastChart.options.scales.y.grid) {
        forecastChart.options.scales.y.grid.color = gridColor;
    }
    if (forecastChart.options.scales.y.title) {
        forecastChart.options.scales.y.title.color = textColor;
    }
    forecastChart.update();
}

// UI Elements
const dashboard = document.getElementById('dashboard');
const loading = document.getElementById('loading');
const errorMsg = document.getElementById('errorMsg');
const cityNameDisplay = document.getElementById('cityNameDisplay');

const currentTemp = document.getElementById('currentTemp');
const currentClouds = document.getElementById('currentClouds');
const currentWind = document.getElementById('currentWind');
const currentDesc = document.getElementById('currentDesc');

const currentSupply = document.getElementById('currentSupply');
const currentDemand = document.getElementById('currentDemand');
const currentStatusState = document.getElementById('currentStatusState');
const alertBox = document.getElementById('alertBox');
const alertMsg = document.getElementById('alertMsg');
const gridCard = document.querySelector('.grid-card');

searchBtn.addEventListener('click', () => {
    const city = cityInput.value.trim();
    if (city) {
        fetchData(city);
    }
});

cityInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        const city = cityInput.value.trim();
        if (city) {
            fetchData(city);
        }
    }
});

async function fetchData(city) {
    // UI Reset
    dashboard.style.display = 'none';
    errorMsg.style.display = 'none';
    loading.style.display = 'block';

    try {
        const response = await fetch(`/predict?city=${encodeURIComponent(city)}`);
        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Failed to fetch data');
        }

        baselineData = data;
        baselineForecast = data.forecast;

        // Reset Inputs
        demandSlider.value = "1.0";
        supplySlider.value = "1.0";
        demandValDisplay.textContent = "1.0x";
        supplyValDisplay.textContent = "1.0x";

        runSimulation();
    } catch (error) {
        console.error(error);
        loading.style.display = 'none';
        errorMsg.textContent = error.message;
        errorMsg.style.display = 'block';
    }
}

function runSimulation() {
    const demandMult = parseFloat(demandSlider.value);
    const supplyMult = parseFloat(supplySlider.value);
    
    batteryCurrent = 500; // Reset battery
    const simForecast = [];
    let requiredImport = 0;
    
    let firstBattery = null;
    let firstImport = null;
    
    for (const item of baselineForecast) {
        const simSolar = item.solar * supplyMult;
        const simWind = item.wind * supplyMult;
        const simTotal = simSolar + simWind;
        const simDemand = item.demand * demandMult;
        
        let net = simTotal - simDemand;
        let stepImport = 0;
        
        // Battery Logic
        if (net > 0) {
            batteryCurrent += net;
            if (batteryCurrent > BATTERY_MAX) batteryCurrent = BATTERY_MAX;
        } else if (net < 0) {
            const deficit = Math.abs(net);
            if (batteryCurrent >= deficit) {
                batteryCurrent -= deficit;
            } else {
                stepImport = deficit - batteryCurrent;
                requiredImport += stepImport;
                batteryCurrent = 0;
            }
        }
        
        if (firstBattery === null) {
            firstBattery = batteryCurrent;
            firstImport = stepImport;
        }
        
        simForecast.push({
            ...item,
            solar: simSolar,
            wind: simWind,
            total: simTotal,
            demand: simDemand
        });
    }

    const first = simForecast[0];
    const diff = first.total - first.demand;
    let sState = 'Balanced';
    let sAlert = 'System normal';
    
    // Condition A (Surplus)
    if (diff > 0) {
        sState = 'Excess';
        sAlert = 'Status: Charging Battery Storage';
    } 
    // Condition C (Critical Shortage)
    else if (diff < 0 && firstBattery <= 0) {
        sState = 'Shortage';
        sAlert = 'CRITICAL: Grid Shortage. Implement Demand Response.';
    } 
    // Condition B (Deficit, but safe)
    else if (diff < 0 && firstBattery > 0) {
        sState = 'Shortage';
        sAlert = 'Status: Discharging Batteries to meet deficit';
    }

    const simStatus = {
        supply: Math.round(first.total),
        demand: Math.round(first.demand),
        state: sState,
        alert: sAlert
    };

    updateDashboard(baselineData, simForecast, simStatus, firstBattery, firstImport);
}

function updateDashboard(baseData, simForecast, simStatus, currentBattery, currentImport) {
    loading.style.display = 'none';
    dashboard.style.display = 'block';

    // Update City Name
    cityNameDisplay.textContent = baseData.city.name;

    // Update Weather
    currentTemp.textContent = `${baseData.current.temp} °C`;
    currentClouds.textContent = `${baseData.current.clouds} %`;
    currentWind.textContent = `${baseData.current.wind} m/s`;
    currentDesc.textContent = baseData.current.description || 'Unknown';

    // Update Grid Status
    currentSupply.textContent = `${simStatus.supply} MW`;
    currentDemand.textContent = `${simStatus.demand} MW`;
    currentStatusState.textContent = simStatus.state;
    alertMsg.textContent = simStatus.alert;

    // Remove old status classes
    gridCard.classList.remove('status-state-balanced', 'status-state-shortage', 'status-state-excess');

    // Add new status class for conditional styling
    if (simStatus.state === 'Balanced') {
        gridCard.classList.add('status-state-balanced');
    } else if (simStatus.state === 'Shortage') {
        gridCard.classList.add('status-state-shortage');
    } else if (simStatus.state === 'Excess') {
        gridCard.classList.add('status-state-excess');
    }

    // Battery Vis Updates
    const pct = Math.round((currentBattery / BATTERY_MAX) * 100);
    batteryValue.innerHTML = `${Math.round(currentBattery)} <span class="b-unit">MWh</span>`;
    batteryFill.style.width = `${pct}%`;
    batteryStatusText.textContent = `State of Charge (${pct}%)`;

    if (currentBattery <= 0 && currentImport > 0) {
        gridImportBox.style.display = 'block';
        gridImportValue.textContent = `${Math.round(currentImport)} MWh`;
        batteryFill.style.backgroundColor = 'var(--status-shortage)';
    } else {
        gridImportBox.style.display = 'none';
        batteryFill.style.backgroundColor = 'var(--status-balanced)';
    }

    // Populate 5-day Mini Grid
    const miniGrid = document.getElementById('forecastMiniGrid');
    miniGrid.innerHTML = '';
    
    // get unique days to show 5 distinct forecast columns
    const dailyForecasts = [];
    const seenDays = new Set();
    
    for (const item of baseData.forecast) {
        const dateObj = new Date(item.time || (item.time * 1000));
        const dayString = dateObj.toLocaleDateString('en-US', { weekday: 'short' });
        
        if (!seenDays.has(dayString)) {
            seenDays.add(dayString);
            dailyForecasts.push({
                day: dayString,
                temp: Math.round(item.temp),
                desc: item.description
            });
        }
        if (dailyForecasts.length >= 5) break;
    }

    dailyForecasts.forEach(df => {
        miniGrid.innerHTML += `
            <div class="forecast-mini-day">
                <span class="f-day">${df.day}</span>
                <span class="f-temp">${df.temp}°</span>
                <span class="f-desc" title="${df.desc}">${df.desc}</span>
            </div>
        `;
    });

    // Render Chart
    renderChart(simForecast);
}

function renderChart(timeSeries) {
    const ctx = document.getElementById('forecastChart').getContext('2d');

    // format labels to be shorter
    const labels = timeSeries.map(item => {
        const d = new Date(item.time || (item.time * 1000));
        const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        return `${months[d.getMonth()]} ${d.getDate()}, ${String(d.getHours()).padStart(2, '0')}:00`;
    });

    const solarData = timeSeries.map(item => item.solar);
    const windData = timeSeries.map(item => item.wind);
    const totalData = timeSeries.map(item => item.total);
    const demandData = timeSeries.map(item => item.demand);

    if (forecastChart) {
        forecastChart.destroy();
    }

    const isDark = document.body.classList.contains('dark-theme');
    const chartTextColor = isDark ? '#f8fafc' : '#64748b';
    const chartGridColor = isDark ? '#334155' : '#e2e8f0';

    forecastChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Solar Supply',
                    data: solarData,
                    borderColor: 'rgba(245, 158, 11, 0)',
                    backgroundColor: 'rgba(245, 158, 11, 0.7)',
                    borderWidth: 0,
                    fill: true,
                    stack: 'Renewables',
                    tension: 0.4
                },
                {
                    label: 'Wind Supply',
                    data: windData,
                    borderColor: 'rgba(6, 182, 212, 0)',
                    backgroundColor: 'rgba(6, 182, 212, 0.7)',
                    borderWidth: 0,
                    fill: true,
                    stack: 'Renewables',
                    tension: 0.4
                },
                {
                    label: 'Total Demand',
                    data: demandData,
                    borderColor: '#ef4444',
                    backgroundColor: 'transparent',
                    borderWidth: 3,
                    borderDash: [5, 5],
                    fill: false,
                    stack: 'Demand',
                    tension: 0.4
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
                        color: chartTextColor,
                        font: {
                            family: 'Inter'
                        }
                    }
                },
                tooltip: {
                    titleFont: { family: 'Inter' },
                    bodyFont: { family: 'Inter' },
                    callbacks: {
                        label: function(context) {
                            let label = context.dataset.label || '';
                            if (label) {
                                label += ': ';
                            }
                            if (context.parsed.y !== null) {
                                label += Math.round(context.parsed.y) + ' MW';
                            }
                            return label;
                        }
                    }
                }
            },
            scales: {
                x: {
                    stacked: true,
                    grid: {
                        display: false,
                        color: chartGridColor
                    },
                    ticks: {
                        maxTicksLimit: 8,
                        maxRotation: 0,
                        color: chartTextColor,
                        font: { family: 'Inter', size: 11 }
                    }
                },
                y: {
                    stacked: true,
                    beginAtZero: true,
                    grid: {
                        color: chartGridColor
                    },
                    title: {
                        display: true,
                        text: 'Power (MW)',
                        color: chartTextColor,
                        font: { family: 'Inter', weight: '600' }
                    },
                    ticks: {
                        color: chartTextColor,
                        font: { family: 'Inter' }
                    }
                }
            }
        }
    });
}
