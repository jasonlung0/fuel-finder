// CRITICAL CONFIGURATIONS
const ORS_API_KEY = 'eyJvcmciOiI1YjNjZTM1OTc4NTExMTAwMDFjZjYyNDgiLCJpZCI6ImZlMTc1YjJjNzFkMDQ5NjI5ZTY1ZWExNmQ3NTAyZDNkIiwiaCI6Im11cm11cjY0In0=';
const GOOGLE_SHEET_BASE_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vR4rIqHLHn1BY6N0AWwpDTXJj0HkxGgtj_gthIpchXzxkwCxu-BPCy51bJqalR7Z8x4QPK2PiE1w0s0/pub?gid=1137635326&single=true&output=csv';

// Initialize Map
const map = L.map('map').setView([54.5, -3.5], 6);
const searchProvider = new GeoSearch.OpenStreetMapProvider({
    params: { countrycodes: 'gb', limit: 5 },
    headers: { 'User-Agent': 'UK-Fuel-Finder-App-v1.0 (Contact: jasonlung0@github)' }
});

const themes = {
    light: L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap contributors' }),
    dark: L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { attribution: '© OpenStreetMap contributors, © CartoDB' }),
    satellite: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { attribution: 'Tiles © Esri' })
};
let activeTheme = themes.light.addTo(map);

let currentMode = 'local'; 
let waypointsList = []; 
let routeLayer = null;
let stationMarkers = L.layerGroup().addTo(map);
let lastSavedRouteData = null;
let currentlyFilteredStations = [];
let userLocation = null;
let searchByAreaActive = false;

window.addEventListener('load', function() {
    map.invalidateSize();
    setupTabToggles();
    
    addNewWaypointField("Start");
    addNewWaypointField("Destination");
    
    setupTab1Autocomplete();

    if (navigator.geolocation) {
        document.getElementById('status').innerText = "Locating position...";
        navigator.geolocation.getCurrentPosition(
            function(position) {
                userLocation = { lat: position.coords.latitude, lon: position.coords.longitude };
                document.getElementById('status').innerText = "Centered on position.";
                map.setView([userLocation.lat, userLocation.lon], 12); 
                filterFuelStationsLocalMode();
            },
            function(error) {
                document.getElementById('status').innerText = "Position access denied. Showing overview.";
                filterFuelStationsLocalMode();
            },
            { timeout: 7000 }
        );
    } else {
        filterFuelStationsLocalMode();
    }
});

map.on('moveend', function() {
    if (currentMode === 'local' && !searchByAreaActive) {
        filterFuelStationsLocalMode();
    }
});

function searchThisArea() {
    searchByAreaActive = true;
    const mapCenter = map.getCenter();
    document.getElementById('status').innerText = "Scanning visible viewport up to 50 miles...";
    userLocation = { lat: mapCenter.lat, lon: mapCenter.lng };
    filterFuelStationsLocalMode();
}

function setupTabToggles() {
    const tabRadius = document.getElementById('bufferRadiusContainer');
    const tabCost = document.getElementById('costSummary');
    
    window.switchTab = function(tabId) {
        document.querySelectorAll('.tab-btn, .tab-content').forEach(el => el.classList.remove('active'));
        searchByAreaActive = false;
        
        if (tabId === 'local-tab') {
            currentMode = 'local';
            document.getElementById('local-tab').classList.add('active');
            document.querySelector("button[onclick*='local-tab']").classList.add('active');
            if(tabRadius) tabRadius.style.display = 'none';
            if(tabCost) tabCost.style.display = 'none';
            if(routeLayer) map.removeLayer(routeLayer);
            filterFuelStationsLocalMode();
        } else {
            currentMode = 'route';
            document.getElementById('route-tab').classList.add('active');
            document.querySelector("button[onclick*='route-tab']").classList.add('active');
            if(tabRadius) tabRadius.style.display = 'block';
            if (lastSavedRouteData) {
                if (routeLayer && !map.hasLayer(routeLayer)) routeLayer.addTo(map);
                filterFuelStationsRouteMode(lastSavedRouteData);
            } else {
                stationMarkers.clearLayers();
                document.getElementById('topStationsContainer').style.display = 'none';
            }
        }
    };
}

function changeMapTheme(themeName) {
    map.removeLayer(activeTheme);
    activeTheme = themes[themeName];
    activeTheme.addTo(map);
}

function updateRadiusLabel(val) {
    document.getElementById('radiusVal').innerText = val;
    if (lastSavedRouteData) filterFuelStationsRouteMode(lastSavedRouteData);
}

function updateLocalRadiusLabel(val) {
    searchByAreaActive = false;
    document.getElementById('localRadiusVal').innerText = val;
    filterFuelStationsLocalMode();
}

document.getElementById('fuelType').addEventListener('change', () => refreshActiveDataView());
document.getElementById('mpg').addEventListener('input', () => refreshActiveDataView());
document.getElementById('filterUnleaded').addEventListener('change', () => refreshActiveDataView());

function refreshActiveDataView() {
    if (currentMode === 'local') filterFuelStationsLocalMode();
    else if (currentMode === 'route' && lastSavedRouteData) filterFuelStationsRouteMode(lastSavedRouteData);
}

// BULLETPROOF COORDINATE NORMALIZER MAPPER
function getCoordinates(station) {
    let lat = null, lon = null;
    
    // Read keys dynamically regardless of case, layout spacing, or underscore mutations
    for (let key in station) {
        const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (['lat', 'latitude'].includes(normalizedKey)) {
            lat = parseFloat(station[key]);
        }
        if (['lon', 'lng', 'longitude'].includes(normalizedKey)) {
            lon = parseFloat(station[key]);
        }
    }
    return (lat === null || lon === null || isNaN(lat) || isNaN(lon)) ? null : { lat, lon };
}

// BULLETPROOF CASE-INSENSITIVE PRICE SELECTOR LOOKUP
function extractPriceByMetricType(station, fuelType) {
    const target = (fuelType || 'price_e10').toLowerCase().replace(/[^a-z0-9]/g, '');
    
    for (let key in station) {
        const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, '');
        
        // Match user column identifiers flexibly
        if (target.includes('e10') && normalizedKey.includes('e10')) {
            let val = parseFloat(station[key]); if (!isNaN(val) && val > 0) return val;
        }
        if (target.includes('e5') && normalizedKey.includes('e5')) {
            let val = parseFloat(station[key]); if (!isNaN(val) && val > 0) return val;
        }
        if ((target.includes('diesel') || target.includes('b7')) && (normalizedKey.includes('diesel') || normalizedKey.includes('b7'))) {
            let val = parseFloat(station[key]); if (!isNaN(val) && val > 0) return val;
        }
    }
    return NaN;
}

function calculateDistanceInMiles(lat1, lon1, lat2, lon2) {
    const R = 3958.8; 
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
}

function addNewWaypointField(customLabel) {
    if (!customLabel) customLabel = "Stop";
    var container = document.getElementById('waypointContainer');
    if (!container) return;
    
    var index = waypointsList.length;
    waypointsList.push({ coordinates: null, rawText: "" });

    var rowId = 'waypoint-row-' + index;
    var row = document.createElement('div');
    row.id = rowId; row.className = 'draggable-waypoint-row';
    row.setAttribute('data-index', index); row.style.display = 'flex'; row.style.alignItems = 'center'; row.style.gap = '5px'; row.style.position = 'relative'; row.style.background = '#ffffff'; row.style.zIndex = '10';

    var isCoreField = (customLabel === "Start" || customLabel === "Destination");

    row.innerHTML = `
        <span style="color: #b0b4b9; font-size: 16px; padding: 0 4px; user-select: none;">⋮⋮</span>
        <div style="position: relative; flex-grow: 1;">
            <input type="text" id="input-${index}" placeholder="${customLabel}..." style="width: 100%;" autocomplete="off">
            <span id="clear-${index}" onclick="clearWaypointField(${index})" style="position: absolute; right: 10px; top: 10px; cursor: pointer; color: #70757a; font-weight: bold; display: none;">×</span>
            <div id="suggest-${index}" class="suggestions-box" style="position: absolute; top: 40px; left: 0; width: 100%; background: white; border: 1px solid #dadce0; z-index: 99999; display: none; max-height: 180px; overflow-y: auto;"></div>
        </div>
        ${!isCoreField ? `<button onclick="removeWaypointField(${index}, '${rowId}')" style="background:none; border:none; color:#ea4335; font-size:18px; cursor:pointer; padding:0 5px; width:auto;">🗑️</button>` : `<div style="width:28px;"></div>`}`;

    container.appendChild(row);
    setupDynamicAutocomplete(index, row);
}

function setupDynamicAutocomplete(index, rowElement) {
    const input = document.getElementById("input-" + index);
    const suggestionsDiv = document.getElementById("suggest-" + index);
    const clearBtn = document.getElementById("clear-" + index);
    if (!input || !suggestionsDiv) return;

    input.addEventListener('focus', () => { rowElement.style.zIndex = '999'; });
    input.addEventListener('blur', () => { setTimeout(() => { rowElement.style.zIndex = '10'; }, 300); });

    input.addEventListener('input', debounce(async function(e) {
        const query = e.target.value;
        if (clearBtn) clearBtn.style.display = query.length > 0 ? 'block' : 'none';
        waypointsList[index].rawText = query;
        if (query.length < 3) { suggestionsDiv.style.display = 'none'; return; }
        try {
            const results = await searchProvider.search({ query: query });
            suggestionsDiv.innerHTML = '';
            if (!results || results.length === 0) { suggestionsDiv.style.display = 'none'; return; }
            results.slice(0, 5).forEach(function(item) {
                const row = document.createElement('div');
                row.style.padding = '10px 12px'; row.style.cursor = 'pointer'; row.style.fontSize = '13px'; row.style.borderBottom = '1px solid #f1f3f4'; row.style.color = '#333';
                row.innerText = item.label;
                row.onclick = function() {
                    input.value = item.label; suggestionsDiv.style.display = 'none';
                    waypointsList[index].coordinates = [item.x, item.y]; 
                };
                suggestionsDiv.appendChild(row);
            });
            suggestionsDiv.style.display = 'block';
        } catch (err) { console.error(err); }
    }, 400));
}

function setupTab1Autocomplete() {
    const input = document.getElementById('localSearchInput');
    const suggestionsDiv = document.getElementById('localSuggestions');
    if (!input || !suggestionsDiv) return;

    input.addEventListener('input', debounce(async function(e) {
        const query = e.target.value;
        if (query.length < 3) { suggestionsDiv.style.display = 'none'; return; }
        try {
            const results = await searchProvider.search({ query: query });
            suggestionsDiv.innerHTML = '';
            if (!results || results.length === 0) { suggestionsDiv.style.display = 'none'; return; }
            results.forEach(function(item) {
                const row = document.createElement('div');
                row.style.padding = '10px 12px'; row.style.cursor = 'pointer'; row.style.fontSize = '13px'; row.style.borderBottom = '1px solid #f1f3f4';
                row.innerText = item.label;
                row.onclick = function() {
                    input.value = item.label; suggestionsDiv.style.display = 'none';
                    searchByAreaActive = false;
                    userLocation = { lat: item.y, lon: item.x };
                    map.setView([item.y, item.x], 13);
                    filterFuelStationsLocalMode();
                };
                suggestionsDiv.appendChild(row);
            });
            suggestionsDiv.style.display = 'block';
        } catch (err) { console.error(err); }
    }, 400));
}

async function calculateJourney() {
    const statusDiv = document.getElementById('status');
    
    const validCoords = waypointsList
        .filter(wp => wp && wp.coordinates)
        .map(wp => [parseFloat(wp.coordinates[0]), parseFloat(wp.coordinates[1])]);

    if (validCoords.length < 2) { 
        alert('Please fill out your Start and Destination points utilizing the selection items from the drop-list autocomplete popups.'); 
        return; 
    }
    
    statusDiv.innerText = "Requesting multi-stop track traces...";
    stationMarkers.clearLayers();
    if (routeLayer) map.removeLayer(routeLayer);

    try {
        const response = await fetch('https://api.openrouteservice.org/v2/directions/driving-car', {
            method: 'POST',
            headers: { 'Accept': 'application/json, geo+json', 'Content-Type': 'application/json', 'Authorization': ORS_API_KEY },
            body: JSON.stringify({ "coordinates": validCoords })
        });
        
        if (!response.ok) throw new Error(await response.text());
        const routeData = await response.json();
        lastSavedRouteData = routeData;
        
        routeLayer = L.geoJSON(routeData, { 
            style: { color: '#1a73e8', weight: 6, opacity: 0.85 } 
        }).addTo(map);
        
        map.fitBounds(routeLayer.getBounds());
        filterFuelStationsRouteMode(routeData);
    } catch (err) {
        console.error(err); 
        statusDiv.innerText = "Routing authentication fault. Check OpenRouteService credentials.";
    }
}

function filterFuelStationsLocalMode() {
    Papa.parse(GOOGLE_SHEET_BASE_URL, {
        download: true, header: true, dynamicTyping: true,
        complete: function(results) { processAndRenderStations(results.data, null); }
    });
}

function filterFuelStationsRouteMode(routeData) {
    Papa.parse(GOOGLE_SHEET_BASE_URL, {
        download: true, header: true, dynamicTyping: true,
        complete: function(results) {
            const selectedRadius = parseFloat(document.getElementById('bufferRadius').value);
            const corridor = turf.buffer(routeData.features[0], selectedRadius, {units: 'kilometers'});
            processAndRenderStations(results.data, corridor);
        }
    });
}

function processAndRenderStations(stationsArray, spatialBufferPolygon) {
    const statusDiv = document.getElementById('status');
    const requiresUnleaded = document.getElementById('filterUnleaded').checked;
    const chosenFuelType = document.getElementById('fuelType').value;
    const localRadiusLimit = parseFloat(document.getElementById('localRadiusSlider').value);

    stationMarkers.clearLayers();
    let eligibleStations = [];
    currentlyFilteredStations = [];
    document.getElementById('topStationsList').innerHTML = '';
    let cheapestPriceFound = Infinity;

    const bounds = map.getBounds();

    stationsArray.forEach(function(station) {
        const coords = getCoordinates(station);
        if (!coords) return;

        // Extract Brand dynamic lookups safely
        let brandName = "Independent";
        for (let key in station) {
            if (key.toLowerCase().trim() === 'brand') { brandName = station[key]; break; }
        }
        station.brand = brandName;

        // Flexible lookup structure mapping for pump parameters
        let isTraditional = true;
        for (let key in station) {
            if (key.toLowerCase().includes('unleaded')) {
                isTraditional = (station[key] === true || station[key] === "TRUE" || station[key] === 1 || station[key] === "true");
            }
        }
        if (requiresUnleaded && !isTraditional) return;

        if (spatialBufferPolygon) {
            if (!turf.booleanPointInPolygon(turf.point([coords.lon, coords.lat]), spatialBufferPolygon)) return;
        } else {
            if (!bounds.contains([coords.lat, coords.lon])) return;
        }
        
        if (currentMode === 'local' && userLocation) {
            station.calculatedDistance = calculateDistanceInMiles(userLocation.lat, userLocation.lon, coords.lat, coords.lon);
            const activeRangeCap = searchByAreaActive ? 50 : localRadiusLimit;
            if (station.calculatedDistance > activeRangeCap) return;
        }

        eligibleStations.push(station);
    });

    const slicedStationsList = eligibleStations.slice(0, 150);

    slicedStationsList.forEach(function(station) {
        const coords = getCoordinates(station);
        
        const e10Price = extractPriceByMetricType(station, 'price_e10');
        const b7Price = extractPriceByMetricType(station, 'price_diesel'); 
        const e5Price = extractPriceByMetricType(station, 'price_e5');

        const currentSelectedPrice = extractPriceByMetricType(station, chosenFuelType);
        if (!isNaN(currentSelectedPrice)) {
            station.currentFilterPrice = currentSelectedPrice;
            if (currentSelectedPrice < cheapestPriceFound) {
                cheapestPriceFound = currentSelectedPrice;
            }
        } else {
            station.currentFilterPrice = Infinity;
        }

        currentlyFilteredStations.push(station);

        // Display current active selected fuel price on pin badge dynamically
        const badgeValue = !isNaN(currentSelectedPrice) ? currentSelectedPrice : e10Price;
        const labelText = (!isNaN(badgeValue)) ? badgeValue.toFixed(1) + 'p' : 'N/A';
        const color = getMarkerColor(badgeValue);

        const icon = L.divIcon({
            className: 'price-badge-container',
            html: `<div style="background-color: ${color}; border: 1px solid white; color: white; font-weight: bold; padding: 2px 5px; border-radius: 4px; font-size: 11px; text-align:center; box-shadow: 0 2px 4px rgba(0,0,0,0.2);">${labelText}</div>`,
            iconSize: [46, 22]
        });

        L.marker([coords.lat, coords.lon], { icon: icon }).on('click', function() {
            displayiOSModalSheet(station, coords, e10Price, b7Price, e5Price);
        }).addTo(stationMarkers);
    });

    statusDiv.innerText = `Forecourts displayed: ${slicedStationsList.length} total rows.`;

    if (currentlyFilteredStations.length > 0) {
        const sortedList = [...currentlyFilteredStations]
            .filter(s => s.currentFilterPrice !== Infinity)
            .sort((a,b) => a.currentFilterPrice - b.currentFilterPrice);
        
        sortedList.slice(0, 3).forEach(function(stn) {
            const c = getCoordinates(stn);
            const distanceString = (stn.calculatedDistance !== undefined) ? ` (${stn.calculatedDistance.toFixed(1)} mi)` : '';

            var li = document.createElement('li'); li.style.cursor = 'pointer'; li.style.padding = '4px 0';
            li.innerHTML = `<strong>${stn.brand}</strong> - <span style="color:#137333;font-weight:bold;">${stn.currentFilterPrice.toFixed(1)}p</span>${distanceString}`;
            li.onclick = () => { map.flyTo([c.lat, c.lon], 14); };
            document.getElementById('topStationsList').appendChild(li);
        });
        document.getElementById('topStationsContainer').style.display = sortedList.length > 0 ? 'block' : 'none';

        if (currentMode === 'route' && lastSavedRouteData) {
            var miles = lastSavedRouteData.features[0].properties.summary.distance / 1609.34;
            var cost = ((miles / (parseFloat(document.getElementById('mpg').value) || 45)) * 4.54609) * (cheapestPriceFound / 100);
            document.getElementById('summaryDistance').innerText = miles.toFixed(1);
            document.getElementById('summaryCost').innerText = '£' + (isFinite(cost) && cheapestPriceFound !== Infinity ? cost.toFixed(2) : '0.00');
            document.getElementById('costSummary').style.display = 'block';
        }
    }
}

function displayiOSModalSheet(station, coords, e10, b7, e5) {
    document.getElementById('sheetBrand').innerText = station.brand;
    
    let targetAddress = station.address || station.Address;
    document.getElementById('sheetAddress').innerText = targetAddress || `Forecourt Coordinates: [${coords.lat.toFixed(4)}, ${coords.lon.toFixed(4)}]`;
    
    document.getElementById('sheetE10').innerText = (!isNaN(e10)) ? e10.toFixed(1) + 'p' : 'N/A';
    document.getElementById('sheetB7').innerText = (!isNaN(b7)) ? b7.toFixed(1) + 'p' : 'N/A';
    document.getElementById('sheetE5').innerText = (!isNaN(e5)) ? e5.toFixed(1) + 'p' : 'N/A';

    const backdrop = document.getElementById('iosModalBackdrop');
    const sheet = document.getElementById('stationDetailSheet');
    
    backdrop.style.display = 'flex';
    setTimeout(() => {
        backdrop.style.opacity = '1';
        sheet.style.transform = 'translateY(0)';
    }, 10);
}

function closeiOSModalSheet() {
    const backdrop = document.getElementById('iosModalBackdrop');
    const sheet = document.getElementById('stationDetailSheet');
    
    backdrop.style.opacity = '0';
    sheet.style.transform = 'translateY(100%)';
    setTimeout(() => { backdrop.style.display = 'none'; }, 250);
}

function handleBackdropClick(event) {
    if (event.target.id === 'iosModalBackdrop') {
        closeiOSModalSheet();
    }
}

function clearWaypointField(index) {
    document.getElementById('input-' + index).value = '';
    document.getElementById('suggest-' + index).style.display = 'none';
    document.getElementById('clear-' + index).style.display = 'none';
    waypointsList[index] = { coordinates: null, rawText: "" };
}

function removeWaypointField(index, rowId) { document.getElementById(rowId).remove(); waypointsList[index] = null; if(lastSavedRouteData) calculateJourney(); }
function getMarkerColor(p) { return !p || isNaN(p) ? '#7f8c8d' : p <= 135 ? '#34a853' : p <= 145 ? '#fbbc05' : '#ea4335'; }
function debounce(func, delay) { let timeout; return function(...args) { clearTimeout(timeout); timeout = setTimeout(() => func.apply(this, args), delay); }; }
