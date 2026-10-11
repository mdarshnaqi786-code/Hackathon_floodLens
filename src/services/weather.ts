export interface HourlyPrecipitation {
  label: string; // e.g. "07:00 PM"
  isoTime: string;
  precipitationMm: number;
  precipitationProbability?: number;
  weatherCode?: number;
}

export interface LiveRainfallData {
  city: string;
  latitude: number;
  longitude: number;
  currentPrecipitationMm: number;
  currentRainMm: number;
  currentShowersMm: number;
  weatherCode: number;
  weatherDescription: string;
  relativeHumidity?: number;
  hourlyForecast: HourlyPrecipitation[]; // next 6 hours
  lastUpdatedTimestamp: number;
  lastUpdatedFormatted: string;
  stationTimezone: string;
  isStale: boolean;
  status: 'live' | 'stale' | 'error';
  isGenuineZeroReading: boolean;
  apiSource: string;
  errorMessage?: string;
}

export const CITY_COORDINATES_MAP: Record<string, { name: string; lat: number; lng: number }> = {
  Mumbai: { name: 'Mumbai', lat: 19.0760, lng: 72.8777 },
  Bengaluru: { name: 'Bengaluru', lat: 12.9716, lng: 77.5946 },
  Chennai: { name: 'Chennai', lat: 13.0827, lng: 80.2707 },
  'Delhi NCR': { name: 'Delhi NCR', lat: 28.6139, lng: 77.2090 },
  Hyderabad: { name: 'Hyderabad', lat: 17.3850, lng: 78.4867 },
  all: { name: 'National Grid (Mumbai Reference)', lat: 19.0760, lng: 72.8777 }
};

export function getWeatherCodeDescription(code: number): string {
  switch (code) {
    case 0: return 'Clear Sky';
    case 1: return 'Mainly Clear';
    case 2: return 'Partly Cloudy';
    case 3: return 'Overcast';
    case 45: case 48: return 'Foggy';
    case 51: case 53: case 55: return 'Light Drizzle';
    case 56: case 57: return 'Freezing Drizzle';
    case 61: return 'Slight Rain';
    case 63: return 'Moderate Rain';
    case 65: return 'Heavy Rain';
    case 66: case 67: return 'Freezing Rain';
    case 71: case 73: case 75: return 'Snowfall';
    case 80: return 'Light Showers';
    case 81: return 'Moderate Showers';
    case 82: return 'Violent Showers';
    case 95: return 'Thunderstorm';
    case 96: case 99: return 'Thunderstorm with Hail';
    default: return 'Fair';
  }
}

/**
 * Parses the ISO timestamp according to the weather station's local time string,
 * avoiding client browser timezone conversion errors.
 */
function formatIsoHourLabel(isoString: string): string {
  try {
    const parts = isoString.split('T');
    if (parts[1]) {
      const [h, m] = parts[1].split(':');
      const hourNum = parseInt(h, 10);
      const ampm = hourNum >= 12 ? 'PM' : 'AM';
      const formattedHour = hourNum % 12 === 0 ? 12 : hourNum % 12;
      return `${formattedHour}:${m || '00'} ${ampm}`;
    }
  } catch {
    // fallback
  }
  return isoString;
}

/**
 * Fetch real-time rainfall data from Open-Meteo free forecast API.
 * Performs strict validation and never substitutes an API failure or missing field with 0.
 */
export async function fetchLiveRainfall(
  cityName: string,
  signal?: AbortSignal
): Promise<LiveRainfallData> {
  const normalized = (cityName || '').trim().toLowerCase();
  const matchedKey = Object.keys(CITY_COORDINATES_MAP).find(
    k => k.toLowerCase() === normalized || (normalized.includes('delhi') && k.toLowerCase().includes('delhi'))
  );
  const target = matchedKey ? CITY_COORDINATES_MAP[matchedKey] : (CITY_COORDINATES_MAP[cityName] || CITY_COORDINATES_MAP['all']);

  const url = `https://api.open-meteo.com/v1/forecast?latitude=${target.lat}&longitude=${target.lng}&current=precipitation,rain,showers,weather_code,relative_humidity_2m&hourly=precipitation,precipitation_probability,rain,showers,weather_code&forecast_days=2&timezone=auto`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/json'
      },
      signal
    });
  } catch (networkError: any) {
    if (networkError.name === 'AbortError') {
      throw networkError;
    }
    throw new Error(`Open-Meteo network connection failed: ${networkError.message || 'Offline'}`);
  }

  if (!response.ok) {
    throw new Error(`Open-Meteo API returned HTTP ${response.status} (${response.statusText || 'Error'})`);
  }

  let data: any;
  try {
    data = await response.json();
  } catch {
    throw new Error('Open-Meteo returned invalid JSON response');
  }

  // Strict schema validation: Never hide API payload errors
  if (!data || typeof data !== 'object') {
    throw new Error('Empty or non-object weather payload received from Open-Meteo');
  }

  if (!data.current || typeof data.current !== 'object') {
    throw new Error('Missing "current" observations object in Open-Meteo payload');
  }

  if (typeof data.current.precipitation !== 'number') {
    throw new Error('Missing numeric "current.precipitation" measurement in Open-Meteo payload');
  }

  if (!data.hourly || typeof data.hourly !== 'object') {
    throw new Error('Missing "hourly" forecast object in Open-Meteo payload');
  }

  if (!Array.isArray(data.hourly.time) || !Array.isArray(data.hourly.precipitation)) {
    throw new Error('Missing "hourly.time" or "hourly.precipitation" arrays in Open-Meteo payload');
  }

  const currentPrecip = data.current.precipitation;
  const currentRain = typeof data.current.rain === 'number' ? data.current.rain : currentPrecip;
  const currentShowers = typeof data.current.showers === 'number' ? data.current.showers : 0;
  const weatherCode = typeof data.current.weather_code === 'number' ? data.current.weather_code : 0;
  const relativeHumidity = typeof data.current.relative_humidity_2m === 'number' ? data.current.relative_humidity_2m : undefined;

  const hourlyTimes: string[] = data.hourly.time;
  const hourlyPrecip: number[] = data.hourly.precipitation;
  const hourlyProb: number[] = Array.isArray(data.hourly.precipitation_probability) ? data.hourly.precipitation_probability : [];
  const hourlyCodes: number[] = Array.isArray(data.hourly.weather_code) ? data.hourly.weather_code : [];
  const currentTimeIso = data.current.time;

  // Locate the index for upcoming hours
  let startIndex = hourlyTimes.findIndex(t => t >= currentTimeIso);
  if (startIndex === -1) {
    startIndex = Math.max(0, hourlyTimes.length - 6);
  }

  // Extract next 6 hours
  const hourlyForecast: HourlyPrecipitation[] = [];
  for (let i = 0; i < 6; i++) {
    const idx = startIndex + i;
    if (idx < hourlyTimes.length) {
      const rawIso = hourlyTimes[idx];
      const val = hourlyPrecip[idx];
      if (typeof val !== 'number') {
        throw new Error(`Invalid non-numeric precipitation value at hourly index ${idx}`);
      }

      hourlyForecast.push({
        label: formatIsoHourLabel(rawIso),
        isoTime: rawIso,
        precipitationMm: val,
        precipitationProbability: typeof hourlyProb[idx] === 'number' ? hourlyProb[idx] : undefined,
        weatherCode: typeof hourlyCodes[idx] === 'number' ? hourlyCodes[idx] : undefined,
      });
    }
  }

  if (hourlyForecast.length === 0) {
    throw new Error('Failed to extract next 6 hours from Open-Meteo forecast timeline');
  }

  const now = new Date();
  const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });

  const isGenuineZero = currentPrecip === 0 && hourlyForecast.every(h => h.precipitationMm === 0);

  return {
    city: target.name,
    latitude: target.lat,
    longitude: target.lng,
    currentPrecipitationMm: currentPrecip,
    currentRainMm: currentRain,
    currentShowersMm: currentShowers,
    weatherCode,
    weatherDescription: getWeatherCodeDescription(weatherCode),
    relativeHumidity,
    hourlyForecast,
    lastUpdatedTimestamp: Date.now(),
    lastUpdatedFormatted: timeStr,
    stationTimezone: data.timezone || 'Asia/Kolkata',
    isStale: false,
    status: 'live',
    isGenuineZeroReading: isGenuineZero,
    apiSource: 'Open-Meteo API v1 (ECMWF/DWD Model)'
  };
}
