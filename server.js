require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const OPENWEATHER_API_KEY = process.env.OPENWEATHER_API_KEY;

app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

// Helper to calculate energy values
function calculateGridData(forecastList) {
    const timeSeries = [];
    let currentStatus = { supply: 0, demand: 0, status: 'Unknown', alert: '' };

    forecastList.forEach((item, index) => {
        const date = new Date(item.dt * 1000);
        const hour = date.getHours();
        const temp = item.main.temp;
        const clouds = item.clouds.all; // 0 to 100%
        const windSpeed = item.wind.speed; // m/s
        
        // --- SOLAR SUPPLY ---
        // simplified: 0 during night (19:00 to 05:00)
        let solarSupply = 0;
        if (hour >= 6 && hour <= 18) {
            // max potential is roughly 400. Clouds reduce this linearly
            const cloudFactor = (100 - clouds) / 100;
            // peak sun is around noon
            const timeFactor = 1 - Math.abs(12 - hour) / 6; 
            solarSupply = Math.max(0, 400 * cloudFactor * timeFactor);
        }

        // --- WIND SUPPLY ---
        // assuming typical turbine produces power between 3m/s and 25m/s
        let windSupply = 0;
        if (windSpeed > 3 && windSpeed < 25) {
            // scale wind speed to power (roughly cubic, but kept linear for simplicity)
            windSupply = windSpeed * 25; 
        } else if (windSpeed >= 25) {
            windSupply = 0; // shut down if too windy
        }
        
        const totalSupply = solarSupply + windSupply;

        // --- DEMAND ---
        // Base demand
        let demand = 300;
        
        // Temperature adjustment (Heating or Cooling)
        // Ideal temp roughly 20C.
        const tempDeviation = Math.abs(20 - temp);
        demand += tempDeviation * 15; // 15 units of power per degree deviation
        
        // Time of day adjustment (Peak hours 17:00 to 22:00)
        if (hour >= 17 && hour <= 22) {
            demand += 150;
        }

        timeSeries.push({
            time: item.dt_txt,
            solar: Math.round(solarSupply),
            wind: Math.round(windSupply),
            total: Math.round(totalSupply),
            demand: Math.round(demand),
            temp: temp,
            description: item.weather[0].description
        });

        // Set current status from the first data point
        if (index === 0) {
            currentStatus.supply = Math.round(totalSupply);
            currentStatus.demand = Math.round(demand);
            
            const difference = currentStatus.supply - currentStatus.demand;
            const threshold = 50;

            if (difference > threshold) {
                currentStatus.state = 'Excess';
                currentStatus.alert = 'Use more power (Turn on appliances)';
            } else if (difference < -threshold) {
                currentStatus.state = 'Shortage';
                currentStatus.alert = 'Use less power (Turn off non-essentials)';
            } else {
                currentStatus.state = 'Balanced';
                currentStatus.alert = 'System normal';
            }
        }
    });

    return { params: currentStatus, timeSeries };
}

// Generate Mock Data if API fails or key is missing
function generateMockData(cityName) {
    console.log(`Generating mock data for ${cityName}...`);
    const mockList = [];
    const now = new Date();
    // 5 days * 8 points per day (every 3 hours) = 40 points
    for(let i=0; i<40; i++) {
        const dt = new Date(now.getTime() + i * 3 * 60 * 60 * 1000);
        
        mockList.push({
            dt: Math.floor(dt.getTime() / 1000),
            dt_txt: dt.toISOString().replace('T', ' ').substring(0, 19),
            main: {
                temp: 15 + Math.sin(i / 4) * 5 + Math.sin(i / 15) * 10,
            },
            clouds: {
                all: Math.max(0, Math.min(100, 50 + Math.sin(i / 8) * 80))
            },
            wind: {
                speed: Math.max(0, Math.min(20, 10 + Math.sin(i / 6) * 15))
            },
            weather: [{
                description: "mocked weather"
            }]
        });
    }

    const { params, timeSeries } = calculateGridData(mockList);

    return {
        city: { name: cityName + ' (Mock Data)' },
        current: {
            temp: mockList[0].main.temp.toFixed(1),
            clouds: mockList[0].clouds.all,
            wind: mockList[0].wind.speed.toFixed(1),
            description: "Mocked Weather Data"
        },
        forecast: timeSeries,
        status: params
    };
}

app.get('/predict', async (req, res) => {
    const city = req.query.city;
    
    if (!city) {
        return res.status(400).json({ error: "City is required" });
    }

    if (!OPENWEATHER_API_KEY) {
        console.warn("No OpenWeather API Key found. Falling back to mock data.");
        return res.json(generateMockData(city));
    }

    try {
        const url = `https://api.openweathermap.org/data/2.5/forecast?q=${city}&units=metric&appid=${OPENWEATHER_API_KEY}`;
        const response = await axios.get(url);
        
        const { city: cityInfo, list } = response.data;
        const { params, timeSeries } = calculateGridData(list);

        // Current weather is roughly the first item in the forecast list
        const currentItem = list[0];

        res.json({
            city: { name: cityInfo.name, country: cityInfo.country },
            current: {
                temp: currentItem.main.temp,
                clouds: currentItem.clouds.all,
                wind: currentItem.wind.speed,
                description: currentItem.weather[0].description
            },
            forecast: timeSeries,
            status: params
        });

    } catch (error) {
        console.error("Error fetching weather data:", error.response ? error.response.data : error.message);
        console.warn("Falling back to mock data due to API error.");
        res.json(generateMockData(city));
    }
});

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
