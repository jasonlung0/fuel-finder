// CRITICAL CONFIGURATIONS
const ORS_API_KEY = 'eyJvcmciOiI1YjNjZTM1OTc4NTExMTAwMDFjZjYyNDgiLCJpZCI6ImZlMTc1YjJjNzFkMDQ5NjI5ZTY1ZWExNmQ3NTAyZDNkIiwiaCI6Im11cm11cjY0In0=';
const GOOGLE_SHEET_BASE_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vR4rIqHLHn1BY6N0AWwpDTXJj0HkxGgtj_gthIpchXzxkwCxu-BPCy51bJqalR7Z8x4QPK2PiE1w0s0/pub?gid=1137635326&single=true&output=csv';

// Initialize Map Engine
const map = L.map('map', { zoomControl: false }).setView([56.0716, -3.4523], 12); // Def: Centered on Dunfermline
L.control.zoom({ position: 'topright' }).addTo(map);

const searchProvider = new GeoSearch.OpenStreetMapProvider({
    params: { countrycodes: 'gb', limit: 5 },
    headers: { 'User-Agent': 'UK-Fuel-Finder-App-v1.0' }
});

const themes = {
    light: L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap' }),
    dark: L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { attribution: '© OpenStreetMap, © CartoDB' }),
    satellite: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { attribution: 'Tiles © Esri' })
};
let activeTheme = themes.light.addTo(map);

let currentMode = 'local'; 
let waypointsList = []; 
let routeLayer = null;
let stationMarkers = L.layerGroup().addTo(map);
let lastSavedRouteData = null;
let currentlyFilteredStations = [];
let userLocation = { lat: 56.0716, lon: -3.4523 }; // Default view fallback
let searchByAreaActive = false;

// EXPOSE FUNCTIONS GLOBALLY BEFORE DOCUMENT INITIALIZATION
window.toggleSidebar = function() {
    const sidebar = document.getElementById('sidebar');
    const icon = document.getElementById('toggleIcon');
    if (!sidebar || !icon) return;
    
    sidebar.classList.toggle('collapsed');
    
    if (sidebar.classList.contains('collapsed')) {
        icon.innerText = "→";
    } else {
        icon.innerText = "←";
    }
    
    setTimeout(() => { map.invalidateSize(); }, 310);
};

window.switchTab = function(tabId) {
    document.querySelectorAll('.tab-btn, .tab-content').forEach(el => el.classList.remove('active'));
    searchByAreaActive = false;
    
    const tabRadius = document.getElementById('bufferRadiusContainer');
    const tabCost = document.getElementById('costSummary');
    
    if (tabId === 'local-tab') {
        currentMode = 'local';
        document.getElementById('local-tab').classList.add('active');
        document.querySelector("button[onclick*='local-tab']").classList.add('active');
        if(tabRadius) tabRadius.classList.add('hidden');
        if(tabCost) tabCost.classList.add('hidden');
        if(routeLayer) map.removeLayer(routeLayer);
        filterFuelStationsLocalMode();
    } else {
        currentMode = 'route';
        document.getElementById('route-tab').classList.add('active');
        document.querySelector("button[onclick*='route-tab']").classList.add('active');
        if(tabRadius) tabRadius.classList.remove('hidden');
        if (lastSavedRouteData) {
            if (routeLayer && !map.hasLayer(routeLayer)) routeLayer.addTo(map);
            filterFuelStationsRouteMode(lastSavedRouteData);
        } else {
            stationMarkers.clearLayers();
            document.getElementById('topStationsContainer').classList.add('hidden');
        }
    }
};

window.changeMapTheme = function(themeName) {
    if (activeTheme) map.removeLayer(activeTheme);
    activeTheme = themes[themeName] || themes.light;
    activeTheme.addTo(map);
};

window.updateRadiusLabel = function(val) {
    const el = document.getElementById('radiusVal');
    if (el) el.innerText = val;
    if (lastSavedRouteData) filterFuelStationsRouteMode(lastSavedRouteData);
};

window.updateLocalRadiusLabel = function(val) {
    searchByAreaActive = false;
    const el = document.getElementById('localRadiusVal');
    if (el) el.innerText = val;
    filterFuelStationsLocalMode();
};

window.searchThisArea = function() {
    searchByAreaActive = true;
    const mapCenter = map.getCenter();
    document.getElementById('status').innerText = "Scanning visible viewport up to 50 miles...";
    userLocation = { lat: mapCenter.lat, lon: mapCenter.lng };
    filterFuelStationsLocalMode();
};

window.addNewWaypointField = function(customLabel) {
    if (!customLabel) customLabel = "Stop";
    const container = document.getElementById('waypointContainer');
    if (!container) return;
    
    const index = waypointsList.length;
    waypointsList.push({ coordinates: null, rawText: "" });

    const rowId = 'waypoint-row-' + index;
    const row = document.createElement('div');
    row.id = rowId;
    row.className = 'flex items-center gap-2 relative bg-white z-10 w-full transition-all';

    const isCoreField = (customLabel === "Start" || customLabel === "Destination");

    row.innerHTML = `
        <span class="text-slate-400 text-sm font-semibold select-none cursor-grab px-1">⋮⋮</span>
        <div class="relative flex-grow">
            <input type="text" id="input-${index}" placeholder="${customLabel}..." autocomplete="off" class="w-full bg-white border border-slate-200 rounded-md py-1.5 px-3 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-950">
            <span id="clear-${index}" onclick="clearWaypointField(${index})" class="absolute right-3 top-2 cursor-pointer text-slate-400 hover:text-slate-600 font-medium hidden text-xs">×</span>
            <div id="suggest-${index}" class="suggestions-box absolute top-[38px] left-0 w-full bg-white border border-slate-200 z-[99999] hidden max-h-[160px] overflow-y-auto rounded-md shadow-lg divide-y divide-slate-100"></div>
        </div>
        ${!isCoreField ? `<button onclick="removeWaypointField(${index}, '${rowId}')" class="text-rose-500 hover:text-rose-700 p-1 rounded hover:bg-slate-50 transition-colors shrink-0 text-sm">🗑️</button>` : `<div class="w-7 shrink-0"></div>`}`;

    container.appendChild(row);
    setupDynamicAutocomplete(index, row);
};

window.calculateJourney = async function() {
    const statusDiv = document.getElementById('status');
    const validCoords = waypointsList.filter(wp => wp && wp.coordinates).map(wp => [parseFloat(wp.coordinates[0]), parseFloat(wp.coordinates[1])]);

    if (validCoords.length < 2) { 
        alert('Please fill out your Start and Destination points utilising the dropdown selection items.'); 
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
        
        routeLayer = L.geoJSON(routeData, { style: { color: '#0f172a', weight: 5, opacity: 0.85 } }).addTo(map);
        map.fitBounds(routeLayer.getBounds());
        filterFuelStationsRouteMode(routeData);
    } catch (err) {
        console.error(err); 
        statusDiv.innerText = "Routing fault. Check your endpoints.";
    }
};

window.clearWaypointField = function(index) {
    document.getElementById('input-' + index).value = '';
    document.getElementById('suggest-' + index).style.display = 'none';
    document.getElementById('clear-' + index).style.display = 'none';
    waypointsList[index] = { coordinates: null, rawText: "" };
};

window.removeWaypointField = function(index, rowId) { 
    document.getElementById(rowId).remove(); 
    waypointsList[index] = null; 
    if(lastSavedRouteData) window.calculateJourney(); 
};

window.handleBackdropClick = function(event) { 
    if (event.target.id === 'iosModalBackdrop') closeiOSModalSheet(); 
};

window.closeiOSModalSheet = function() {
    const backdrop = document.getElementById('iosModalBackdrop');
    const sheet = document.getElementById('stationDetailSheet');
    if(!backdrop || !sheet) return;
    backdrop.style.opacity = '0'; 
    sheet.style.transform = 'translateY(100%)';
    setTimeout(() => { backdrop.style.display = 'none'; }, 250);
};

// Handle window resizing to sync arrow indicators correctly on dynamic viewport adaptations
window.addEventListener('resize', () => {
    const sidebar = document.getElementById('sidebar');
    const icon = document.getElementById('toggleIcon');
    if (sidebar
