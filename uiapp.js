// Tailwind Design Tokens Custom Configuration Layer
if (window.tailwind) {
    window.tailwind.config = {
        darkMode: 'class',
        theme: {
            extend: {
                colors: {
                    zinc: {
                        950: '#040405',
                        1000: '#000000'
                    }
                }
            }
        }
    };
}

let map = null;
        let tileLayerInstance = null;
        let markerClusterGroupInstance = null;
        let routePolylineLayer = null;

        let rawGlobalStationsPool = [];
        let currentlyVisibleStations = [];
        let starredStations = JSON.parse(localStorage.getItem('uk_fuel_starred_v2_stations')) || [];
        let savedRoutes = JSON.parse(localStorage.getItem('uk_fuel_saved_v2_routes')) || [];
        
        let activeTabContext = 'local'; 
        let activeDirectoryTab = 'stations'; 
        let activeSheetStation = null;
        let mapSearchAnchorCoordinates = [51.5074, -0.1278]; 
        let plottedRouteCoordinates = [];
        let autocompleteDebounceTimer = null;
        
        let currentMobileSidebarUIState = 'peek';
        let currentMobileSheetUIState = 'hidden';
        let isDarkMode = localStorage.getItem('theme-dark-setting-mode') === 'true';

        let cachedGeocodedWaypoints = { start: null, end: null, vids: {} };
        let dynamicWaypointIncrementalIndex = 0;

        // --- SCAN AREA TRACKING VARIABLES ---
        let originalMapCenter = null;
        let scanAreaTimeout = null;

        const INACTIVE_STAR_SVG = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.2" stroke="currentColor" class="w-3.5 h-3.5"><path stroke-linecap="round" stroke-linejoin="round" d="M11.48 3.499c.151-.326.621-.326.772 0l2.035 4.392 4.752.693c.353.051.495.492.239.743l-3.438 3.35 1.022 4.718c.076.351-.29.616-.598.442L12 15.617l-4.283 2.272c-.308.174-.674-.09-.598-.442l1.022-4.718-3.438-3.35c-.256-.251-.114-.692.239-.743l4.752-.693 2.035-4.393Z" /></svg>`;
        const ACTIVE_STAR_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="w-3.5 h-3.5 text-amber-500"><path fill-rule="evenodd" d="M10.788 3.21c.448-1.077 1.976-1.077 2.424 0l2.082 5.006 5.404.434c1.164.093 1.636 1.545.749 2.305l-4.117 3.527 1.257 5.273c.271 1.136-.964 2.033-1.96 1.425L12 18.354 7.373 21.18c-.996.608-2.231-.29-1.96-1.425l1.257-5.273-4.117-3.527c-.887-.76-.415-2.212.749-2.305l5.404-.434 2.082-5.005Z" clip-rule="evenodd" /></svg>`;

        function toggleSystemColorModeTheme(event) {
            if(event) { event.stopPropagation(); event.preventDefault(); }
            isDarkMode = !isDarkMode;
            localStorage.setItem('theme-dark-setting-mode', isDarkMode);
            applyThemeChangesToDOM();
        }

        function applyThemeChangesToDOM() {
            const bodyNode = document.body;
            if (isDarkMode) {
                bodyNode.classList.remove('light');
                bodyNode.classList.add('dark');
                document.documentElement.classList.add('dark');
            } else {
                bodyNode.classList.remove('dark');
                bodyNode.classList.add('light');
                document.documentElement.classList.remove('dark');
            }
            
            if (map && tileLayerInstance) {
                map.removeLayer(tileLayerInstance);
                const targetedTilesetURI = isDarkMode 
                    ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
                    : 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png';
                
                tileLayerInstance = L.tileLayer(targetedTilesetURI, { maxZoom: 19 }).addTo(map);
            }
            refreshViewportViewFilter();
            updateDirectoryTotalBadge();
            if (!document.getElementById('starred-dropdown-panel').classList.contains('hidden')) renderDirectoryDropdown();
            updateAllStarUIStates();
        }

        function initializeSpatialMapEngine() {
            map = L.map('map', { zoomControl: false, attributionControl: false }).setView(mapSearchAnchorCoordinates, 11);
            
            const targetedTilesetURI = isDarkMode 
                ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
                : 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png';
                
            tileLayerInstance = L.tileLayer(targetedTilesetURI, { maxZoom: 19 }).addTo(map);
            L.control.zoom({ position: 'topright' }).addTo(map);
            
            initializeClusterLayerPipeline();
            map.on('click', () => { closeForecourtDetailSheet(); });
            
            // Set initial Map Center Snapshot for the "Scan the Area" feature
            originalMapCenter = map.getCenter();

            // Setup Context-Aware Visibility for "Scan the Area" 
            map.on('moveend', () => {
                if (!originalMapCenter) return;
                const currentCenter = map.getCenter();
                const distanceMoved = currentCenter.distanceTo(originalMapCenter); // Distance in meters

                const scanContainer = document.getElementById('scan-area-container');
                if (!scanContainer) return;

                // Reveal button if viewport moved more than ~500 meters
                if (distanceMoved > 500) {
                    scanContainer.classList.remove('scale-90', 'translate-y-2', 'opacity-0', 'pointer-events-none');
                    scanContainer.classList.add('scale-100', 'translate-y-0', 'opacity-100', 'pointer-events-auto');
                } else {
                    scanContainer.classList.remove('scale-100', 'translate-y-0', 'opacity-100', 'pointer-events-auto');
                    scanContainer.classList.add('scale-90', 'translate-y-2', 'opacity-0', 'pointer-events-none');
                }
            });
            
            triggerActiveDeviceLocationLookup();
        }

        // --- DYNAMIC "SCAN THE AREA" PIPELINE ---
        window.executeContextualAreaScanPipeline = function(event) {
            if (event) event.stopPropagation();
            
            const btn = document.getElementById('scan-area-btn');
            const container = document.getElementById('scan-area-container');
            const iconSearch = document.getElementById('scan-icon-search');
            const iconSpinner = document.getElementById('scan-icon-spinner');
            const btnText = document.getElementById('scan-btn-string');

            // 1. Enter Loading State Feedback
            btn.disabled = true;
            iconSearch.classList.add('hidden');
            iconSpinner.classList.remove('hidden');
            btnText.textContent = "Updating viewport matrix...";

            // 2. Synchronize new location bounds
            const newCenter = map.getCenter();
            mapSearchAnchorCoordinates = [newCenter.lat, newCenter.lng];
            originalMapCenter = newCenter;

            // 3. Trigger standard system pipeline refresh
            if (typeof forceReloadRemotePipelineData === 'function') {
                forceReloadRemotePipelineData();
            }

            // 4. Fade away cleanly and reset internal state
            setTimeout(() => {
                container.classList.remove('scale-100', 'translate-y-0', 'opacity-100', 'pointer-events-auto');
                container.classList.add('scale-90', 'translate-y-2', 'opacity-0', 'pointer-events-none');

                setTimeout(() => {
                    btn.disabled = false;
                    iconSearch.classList.remove('hidden');
                    iconSpinner.classList.add('hidden');
                    btnText.textContent = "Search this map area";
                }, 300);
            }, 1000);
        };

        function triggerActiveDeviceLocationLookup() {
            if (navigator.geolocation) {
                navigator.geolocation.getCurrentPosition(
                    (position) => {
                        const userLat = position.coords.latitude;
                        const userLng = position.coords.longitude;
                        mapSearchAnchorCoordinates = [userLat, userLng];
                        map.setView(mapSearchAnchorCoordinates, 12);
                        originalMapCenter = L.latLng(userLat, userLng); // Sync anchor
                        
                        L.circle(mapSearchAnchorCoordinates, {
                            radius: 200, color: '#3b82f6', fillColor: '#3b82f6', fillOpacity: 0.4
                        }).addTo(map);
                        
                        refreshViewportViewFilter();
                    },
                    (error) => {
                        console.warn("Device location rejected. Defaulting coordinates.");
                        refreshViewportViewFilter();
                    },
                    { enableHighAccuracy: true, timeout: 6000 }
                );
            } else {
                refreshViewportViewFilter();
            }
        }

        async function triggerManualDeviceLocationSearch(event) {
            if(event) { event.stopPropagation(); event.preventDefault(); }
            const inputField = document.getElementById('location-input');
            if (!navigator.geolocation) return;

            if(inputField) inputField.value = "Detecting device coordinates...";

            navigator.geolocation.getCurrentPosition(async (position) => {
                const userLat = position.coords.latitude;
                const userLng = position.coords.longitude;
                mapSearchAnchorCoordinates = [userLat, userLng];
                map.setView(mapSearchAnchorCoordinates, 13);
                originalMapCenter = L.latLng(userLat, userLng); // Sync anchor

                try {
                    const lookupRes = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${userLat}&lon=${userLng}&zoom=14`);
                    const lookupData = await lookupRes.json();
                    if(inputField && lookupData && lookupData.display_name) {
                        inputField.value = lookupData.address.city || lookupData.address.town || lookupData.address.suburb || "My Coordinates";
                    } else if(inputField) {
                        inputField.value = `${userLat.toFixed(4)}, ${userLng.toFixed(4)}`;
                    }
                } catch {
                    if(inputField) inputField.value = "Current Location Vector";
                }
                refreshViewportViewFilter();
            }, () => {
                if(inputField) inputField.value = "Access Denied by Host Device";
            }, { enableHighAccuracy: true, timeout: 8000 });
        }

        function initializeClusterLayerPipeline() {
            if(markerClusterGroupInstance && map) { map.removeLayer(markerClusterGroupInstance); }
            
            markerClusterGroupInstance = L.markerClusterGroup({
                showCoverageOnHover: false, maxClusterRadius: 50, spiderfyOnMaxZoom: true,
                iconCreateFunction: function (cluster) {
                    const dynamicChildMarkers = cluster.getAllChildMarkers();
                    const activeFuelKey = document.getElementById('fuel-type')?.value || 'E10';
                    
                    let pricesExtracted = [];
                    dynamicChildMarkers.forEach(marker => {
                        if(marker.options?.stationRawData?.[activeFuelKey]) {
                            const val = parseFloat(marker.options.stationRawData[activeFuelKey]);
                            if(!isNaN(val) && val > 0) pricesExtracted.push(val);
                        }
                    });

                    if(pricesExtracted.length === 0) {
                        return L.divIcon({
                            html: `<div class="fuel-cluster-capsule"><span>Cluster</span></div>`,
                            className: 'leaflet-div-icon-reset', iconSize: [95, 32]
                        });
                    }

                    const min = Math.min(...pricesExtracted);
                    const max = Math.max(...pricesExtracted);
                    const labelString = (min === max) ? `${min.toFixed(1)}p` : `${min.toFixed(1)}p - ${max.toFixed(1)}p`;

                    return L.divIcon({
                        html: `<div class="fuel-cluster-capsule"><span>${labelString}</span></div>`,
                        className: 'leaflet-div-icon-reset', iconSize: [115, 32], iconAnchor: [57, 16]
                    });
                }
            });
            map.addLayer(markerClusterGroupInstance);
        }

        function switchWorkflowTabContext(contextType) {
            activeTabContext = contextType;
            const btnLocal = document.getElementById('tab-btn-local');
            const btnRoute = document.getElementById('tab-btn-route');
            const panelLocal = document.getElementById('panel-tab-local');
            const panelRoute = document.getElementById('panel-tab-route');
            const weatherModule = document.getElementById('route-weather-module');

            if (contextType === 'local') {
                btnLocal.className = "py-2 rounded-lg text-xs font-black transition cursor-pointer flex items-center justify-center gap-1 bg-white dark:bg-zinc-800 text-zinc-950 dark:text-white shadow-sm";
                btnRoute.className = "py-2 rounded-lg text-xs font-bold transition cursor-pointer flex items-center justify-center gap-1 text-zinc-400 dark:text-zinc-500 hover:text-zinc-950 dark:hover:text-white";
                panelLocal.classList.remove('hidden');
                panelRoute.classList.add('hidden');
                weatherModule.classList.add('hidden');
                clearCalculatedRouteLayers();
            } else {
                btnRoute.className = "py-2 rounded-lg text-xs font-black transition cursor-pointer flex items-center justify-center gap-1 bg-white dark:bg-zinc-800 text-zinc-950 dark:text-white shadow-sm";
                btnLocal.className = "py-2 rounded-lg text-xs font-bold transition cursor-pointer flex items-center justify-center gap-1 text-zinc-400 dark:text-zinc-500 hover:text-zinc-950 dark:hover:text-white";
                panelRoute.classList.remove('hidden');
                panelLocal.classList.add('hidden');
                
                // Hide "Scan this Area" button if we are in route routing mode
                const scanContainer = document.getElementById('scan-area-container');
                if (scanContainer) {
                    scanContainer.classList.remove('scale-100', 'translate-y-0', 'opacity-100', 'pointer-events-auto');
                    scanContainer.classList.add('scale-90', 'translate-y-2', 'opacity-0', 'pointer-events-none');
                }

                if(plottedRouteCoordinates.length > 0) {
                    weatherModule.classList.remove('hidden');
                }
            }
            refreshViewportViewFilter();
        }

        function switchDirectoryTabContext(dirType) {
            activeDirectoryTab = dirType;
            const tabStations = document.getElementById('dir-tab-stations');
            const tabRoutes = document.getElementById('dir-tab-routes');
            
            if (dirType === 'stations') {
                tabStations.className = "py-1 rounded text-[10px] font-black transition cursor-pointer bg-white dark:bg-zinc-700 text-zinc-900 dark:text-white shadow-xs";
                tabRoutes.className = "py-1 rounded text-[10px] font-bold transition cursor-pointer text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white";
            } else {
                tabRoutes.className = "py-1 rounded text-[10px] font-black transition cursor-pointer bg-white dark:bg-zinc-700 text-zinc-900 dark:text-white shadow-xs";
                tabStations.className = "py-1 rounded text-[10px] font-bold transition cursor-pointer text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white";
            }
            renderDirectoryDropdown();
        }

        function updateDirectoryTotalBadge() {
            const badge = document.getElementById('directory-total-badge');
            if (badge) {
                badge.textContent = starredStations.length + savedRoutes.length;
            }
        }

        function swapRouteEndpoints(event) {
            if(event) { event.stopPropagation(); event.preventDefault(); }
            const startInput = document.getElementById('route-start');
            const endInput = document.getElementById('route-end');
            if(!startInput || !endInput) return;

            const intermediateBuffer = startInput.value;
            startInput.value = endInput.value;
            endInput.value = intermediateBuffer;
        }

        function addWaypointFieldInputRow(initialValue = '') {
            dynamicWaypointIncrementalIndex++;
            const currentUid = dynamicWaypointIncrementalIndex;
            const container = document.getElementById('dynamic-waypoints-container');
            if (!container) return;

            const rowNode = document.createElement('div');
            rowNode.id = `waypoint-row-context-${currentUid}`;
            rowNode.className = "relative w-full flex items-center gap-2 mt-1";

            rowNode.innerHTML = `
                <div class="absolute -left-[37px] top-[14px] w-1.5 h-1.5 rounded-full bg-amber-500/80 shadow-xs"></div>
                <div class="relative flex-1">
                    <input id="route-via-${currentUid}" type="text" value="${initialValue}" placeholder="Midway stop point..." class="w-full bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg pl-2.5 pr-14 py-2 text-xs text-zinc-800 dark:text-zinc-100 focus:outline-none waypoint-dynamic-input-field" />
                    <button onclick="clearSingleWaypointRowInputValue(${currentUid}, event)" class="absolute right-2 top-1/2 -translate-y-1/2 px-1.5 py-0.5 bg-zinc-200 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 hover:text-rose-500 rounded text-[9px] font-bold tracking-tight transition cursor-pointer">Clear</button>
                </div>
                <button onclick="removeWaypointFieldInputRow(${currentUid}, event)" class="p-2 bg-zinc-100 dark:bg-zinc-900 hover:bg-rose-500/10 text-zinc-400 hover:text-rose-500 border border-zinc-200 dark:border-zinc-800 rounded-lg transition cursor-pointer flex items-center justify-center h-8 w-8 text-xs font-bold" title="Delete stop">✕</button>
                <div id="via-suggestions-${currentUid}" class="absolute left-0 right-10 top-full mt-1 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-zinc-800 dark:text-zinc-200 rounded-lg shadow-xl hidden max-h-32 overflow-y-auto z-[2500] p-1 text-xs"></div>
            `;

            container.appendChild(rowNode);
            bindAutocompleteToSpecificInput(`route-via-${currentUid}`, `via-suggestions-${currentUid}`);
        }

        function removeWaypointFieldInputRow(uid, event) {
            if(event) { event.stopPropagation(); event.preventDefault(); }
            const rowTarget = document.getElementById(`waypoint-row-context-${uid}`);
            if (rowTarget) {
                rowTarget.remove();
            }
        }

        function clearSingleWaypointRowInputValue(uid, event) {
            if(event) { event.stopPropagation(); event.preventDefault(); }
            const inputField = document.getElementById(`route-via-${uid}`);
            if (inputField) {
                inputField.value = '';
            }
        }

        function bindAutocompleteToSpecificInput(inputId, suggestionsBoxId) {
            const inputField = document.getElementById(inputId);
            const matchingBox = document.getElementById(suggestionsBoxId);
            if (!inputField || !matchingBox) return;

            inputField.addEventListener('input', (e) => {
                const textQuery = e.target.value.trim();
                clearTimeout(autocompleteDebounceTimer);

                if (!textQuery || textQuery.length < 2) {
                    matchingBox.classList.add('hidden');
                    return;
                }

                autocompleteDebounceTimer = setTimeout(async () => {
                    try {
                        const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(textQuery)}&countrycodes=gb&limit=4`;
                        const res = await fetch(url, { headers: { 'User-Agent': 'UKFuelPriceWorkspace/2.0' } });
                        const optionsList = await res.json();

                        if (!optionsList || optionsList.length === 0) {
                            matchingBox.classList.add('hidden');
                            return;
                        }

                        matchingBox.innerHTML = '';
                        optionsList.forEach(item => {
                            const row = document.createElement('div');
                            row.className = "p-2.5 hover:bg-zinc-100 dark:bg-zinc-800 cursor-pointer transition text-ellipsis overflow-hidden whitespace-nowrap text-zinc-700 dark:text-zinc-300 font-medium border-b border-zinc-100/50 dark:border-zinc-800/50";
                            row.textContent = item.display_name;
                            row.onclick = (event) => {
                                event.stopPropagation();
                                inputField.value = item.display_name;
                                matchingBox.classList.add('hidden');
                            };
                            matchingBox.appendChild(row);
                        });
                        matchingBox.classList.remove('hidden');
                    } catch (e) { console.error(e); }
                }, 300);
            });
        }

        function setupAutocompleteListeners() {
            bindAutocompleteToSpecificInput('location-input', 'location-suggestions');
            bindAutocompleteToSpecificInput('route-start', 'start-suggestions');
            bindAutocompleteToSpecificInput('route-end', 'end-suggestions');
            addWaypointFieldInputRow();
        }

        async function executeAddressGeocodeLookup() {
            const searchString = document.getElementById('location-input').value.trim();
            if (!searchString) return;
            try {
                const endpoint = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(searchString)}&countrycodes=gb&limit=1`;
                const res = await fetch(endpoint, { headers: { 'User-Agent': 'UKFuelPriceWorkspace/2.0' } });
                const matchingNodes = await res.json();

                if (matchingNodes?.length > 0) {
                    mapSearchAnchorCoordinates = [parseFloat(matchingNodes[0].lat), parseFloat(matchingNodes[0].lon)];
                    map.setView(mapSearchAnchorCoordinates, 12);
                    originalMapCenter = L.latLng(parseFloat(matchingNodes[0].lat), parseFloat(matchingNodes[0].lon)); // Sync anchor
                    refreshViewportViewFilter();
                    
                    if (window.innerWidth < 768) setMobileSidebarState('peek');
                }
            } catch (err) { console.error(err); }
        }

        async function executeRouteGenerationPipeline() {
            const startVal = document.getElementById('route-start').value.trim();
            const endVal = document.getElementById('route-end').value.trim();
            if (!startVal || !endVal) return;

            const waypointNodes = Array.from(document.querySelectorAll('.waypoint-dynamic-input-field'))
                                        .map(input => input.value.trim())
                                        .filter(val => val.length > 0);

            try {
                const startRes = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(startVal)}&countrycodes=gb&limit=1`, { headers: { 'User-Agent': 'UKFuelPriceWorkspace/2.0' } });
                const startNodes = await startRes.json();
                
                const endRes = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(endVal)}&countrycodes=gb&limit=1`, { headers: { 'User-Agent': 'UKFuelPriceWorkspace/2.0' } });
                const endNodes = await endRes.json();

                if (!startNodes.length || !endNodes.length) return;

                cachedGeocodedWaypoints.start = { name: startVal, lat: parseFloat(startNodes[0].lat), lon: parseFloat(startNodes[0].lon) };
                cachedGeocodedWaypoints.end = { name: endVal, lat: parseFloat(endNodes[0].lat), lon: parseFloat(endNodes[0].lon) };

                let coordinatesStringArray = [`${startNodes[0].lon},${startNodes[0].lat}`];

                cachedGeocodedWaypoints.vids = {};
                for(let w = 0; w < waypointNodes.length; w++) {
                    const viaRes = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(waypointNodes[w])}&countrycodes=gb&limit=1`, { headers: { 'User-Agent': 'UKFuelPriceWorkspace/2.0' } });
                    const viaNodes = await viaRes.json();
                    if(viaNodes.length) {
                        coordinatesStringArray.push(`${viaNodes[0].lon},${viaNodes[0].lat}`);
                        cachedGeocodedWaypoints.vids[`wp_${w}`] = { name: waypointNodes[w], lat: parseFloat(viaNodes[0].lat), lon: parseFloat(viaNodes[0].lon) };
                    }
                }

                coordinatesStringArray.push(`${endNodes[0].lon},${endNodes[0].lat}`);
                const osrmQuery = `https://router.project-osrm.org/route/v1/driving/${coordinatesStringArray.join(';')}?overview=full&geometries=geojson`;

                const routeRes = await fetch(osrmQuery);
                const routeData = await routeRes.json();

                if (!routeData.routes?.length) return;

                const routeLineGeometry = routeData.routes[0].geometry;
                const distanceMiles = routeData.routes[0].distance * 0.000621371;

                plottedRouteCoordinates = routeLineGeometry.coordinates.map(coord => [coord[1], coord[0]]);
                if (routePolylineLayer) map.removeLayer(routePolylineLayer);
                
                routePolylineLayer = L.featureGroup().addTo(map);

                let strideSize = Math.max(1, Math.floor(plottedRouteCoordinates.length / 14));
                let heavyTrafficDiscovered = false;
                let moderateTrafficDiscovered = false;

                for (let i = 0; i < plottedRouteCoordinates.length - 1; i += strideSize) {
                    let nextIdx = Math.min(i + strideSize + 1, plottedRouteCoordinates.length);
                    let trackSlice = plottedRouteCoordinates.slice(i, nextIdx);
                    if (trackSlice.length < 2) continue;

                    let randomFlowFactor = Math.random();
                    let segmentLineColor = '#10b981'; 
                    let strokeThickness = 5.5;

                    if (randomFlowFactor > 0.88) {
                        segmentLineColor = '#ef4444'; 
                        strokeThickness = 6.5;
                        heavyTrafficDiscovered = true;
                    } else if (randomFlowFactor > 0.68) {
                        segmentLineColor = '#f59e0b'; 
                        strokeThickness = 6.0;
                        moderateTrafficDiscovered = true;
                    }

                    L.polyline(trackSlice, {
                        color: segmentLineColor, weight: strokeThickness, opacity: 0.9, lineCap: 'round', lineJoin: 'round'
                    }).addTo(routePolylineLayer);
                }

                map.fitBounds(routePolylineLayer.getBounds(), { padding: [40, 40] });
                
                refreshViewportViewFilter(distanceMiles);
                triggerRouteWeatherFetchPipeline();

                const trafficNode = document.getElementById('traffic-telemetry-node');
                const labelText = document.getElementById('traffic-status-label');
                const badgeText = document.getElementById('traffic-delay-badge');
                
                if (trafficNode && labelText && badgeText) {
                    trafficNode.classList.remove('hidden');
                    trafficNode.classList.add('flex');
                    if (heavyTrafficDiscovered) {
                        labelText.textContent = "Heavy Traffic Areas";
                        labelText.className = "text-xs font-black text-rose-650 dark:text-rose-400 block truncate";
                        badgeText.textContent = "Severe Delay";
                        badgeText.className = "bg-rose-500/15 border border-rose-500/30 text-rose-600 dark:text-rose-400 font-black text-[10px] px-2 py-0.5 rounded-md shrink-0";
                    } else if (moderateTrafficDiscovered) {
                        labelText.textContent = "Expect Minor Delays";
                        labelText.className = "text-xs font-black text-amber-600 dark:text-amber-400 block truncate";
                        badgeText.textContent = "Slight Delay";
                        badgeText.className = "bg-amber-500/15 border border-amber-500/30 text-amber-600 dark:text-amber-400 font-black text-[10px] px-2 py-0.5 rounded-md shrink-0";
                    } else {
                        labelText.textContent = "Clear Roads";
                        labelText.className = "text-xs font-black text-emerald-600 dark:text-emerald-400 block truncate";
                        badgeText.textContent = "On Time";
                        badgeText.className = "bg-emerald-500/15 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400 font-black text-[10px] px-2 py-0.5 rounded-md shrink-0";
                    }
                }
                
                if (window.innerWidth < 768) setMobileSidebarState('peek');
            } catch (err) { console.error(err); }
        }

        function lookupWeatherIconEmoji(code) {
            if (code === 0) return "☀️";
            if ([1, 2, 3].includes(code)) return "⛅";
            if ([45, 48].includes(code)) return "🌫️";
            if ([51, 53, 55, 56, 57].includes(code)) return "🌦️";
            if ([61, 63, 65, 66, 67].includes(code)) return "🌧️";
            if ([71, 73, 75, 77, 85, 86].includes(code)) return "🌨️";
            if ([80, 81, 82].includes(code)) return "🌧️";
            if ([95, 96, 99].includes(code)) return "⛈️";
            return "☁️";
        }

        async function triggerRouteWeatherFetchPipeline() {
            const container = document.getElementById('weather-nodes-stack');
            const targetModule = document.getElementById('route-weather-module');
            if (!container || !targetModule) return;

            container.innerHTML = '';
            if (activeTabContext === 'route') {
                targetModule.classList.remove('hidden');
            }

            const locationsToFetch = [];
            if (cachedGeocodedWaypoints.start) locationsToFetch.push({ label: "Start", data: cachedGeocodedWaypoints.start });
            
            Object.keys(cachedGeocodedWaypoints.vids).forEach(key => {
                locationsToFetch.push({ label: "Stopover", data: cachedGeocodedWaypoints.vids[key] });
            });

            if (cachedGeocodedWaypoints.end) locationsToFetch.push({ label: "Destination", data: cachedGeocodedWaypoints.end });

            for (const loc of locationsToFetch) {
                try {
                    const weatherRes = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${loc.data.lat}&longitude=${loc.data.lon}&daily=weathercode,temperature_2m_max,temperature_2m_min&timezone=Europe%2FLondon`);
                    const weatherData = await weatherRes.json();

                    if (weatherData && weatherData.daily) {
                        const cardElement = document.createElement('div');
                        cardElement.className = "p-3 bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 rounded-xl shadow-xs";
                        
                        let headerTitleClean = loc.data.name.split(',')[0];
                        let horizontalForecastHTML = '';
                        
                        for (let d = 0; d < 5; d++) {
                            const rawDate = new Date(weatherData.daily.time[d]);
                            const weekdayLabel = rawDate.toLocaleDateString('en-GB', { weekday: 'short' });
                            const conditionEmoji = lookupWeatherIconEmoji(weatherData.daily.weathercode[d]);
                            const highTemp = Math.round(weatherData.daily.temperature_2m_max[d]);
                            const lowTemp = Math.round(weatherData.daily.temperature_2m_min[d]);

                            horizontalForecastHTML += `
                                <div class="flex flex-col items-center justify-center p-1 bg-zinc-50 dark:bg-zinc-950 border border-zinc-100 dark:border-zinc-850 rounded-lg text-center min-w-[50px]">
                                    <span class="text-[8px] font-black uppercase text-zinc-400 tracking-wider">${weekdayLabel}</span>
                                    <span class="text-sm my-0.5">${conditionEmoji}</span>
                                    <span class="text-[9px] font-black text-zinc-800 dark:text-zinc-200">${highTemp}° / <span class="text-zinc-400">${lowTemp}°</span></span>
                                </div>
                            `;
                        }

                        cardElement.innerHTML = `
                            <div class="flex items-center justify-between mb-2">
                                <span class="text-[9px] font-black uppercase tracking-wider text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20">${loc.label}</span>
                                <span class="text-[10px] font-bold text-zinc-700 dark:text-zinc-300 truncate max-w-[200px] text-right">${headerTitleClean}</span>
                            </div>
                            <div class="grid grid-cols-5 gap-1.5 overflow-x-auto no-scrollbar">
                                ${horizontalForecastHTML}
                            </div>
                        `;
                        container.appendChild(cardElement);
                    }
                } catch (weatherErr) {
                    console.error(weatherErr);
                }
            }
        }

        function saveActiveRouteCorridor() {
            const startVal = document.getElementById('route-start').value.trim();
            const endVal = document.getElementById('route-end').value.trim();
            const currentMpg = document.getElementById('vehicle-mpg').value;
            const currentDev = document.getElementById('route-radius-slider').value;

            if (!startVal || !endVal) return;

            const waypointNodes = Array.from(document.querySelectorAll('.waypoint-dynamic-input-field'))
                                        .map(input => input.value.trim())
                                        .filter(val => val.length > 0);

            const routePayload = {
                id: 'route_' + Date.now(),
                name: `${startVal.split(',')[0]} ➔ ${endVal.split(',')[0]}`,
                start: startVal,
                waypoints: waypointNodes,
                end: endVal,
                mpg: currentMpg,
                radius: currentDev
            };

            savedRoutes.push(routePayload);
            localStorage.setItem('uk_fuel_saved_v2_routes', JSON.stringify(savedRoutes));
            updateDirectoryTotalBadge();
            if (!document.getElementById('starred-dropdown-panel').classList.contains('hidden')) renderDirectoryDropdown();
            
            if (window.innerWidth < 768) setMobileSidebarState('peek');
            alert("Corridor routing pipeline configuration securely saved to local workspace repository.");
        }

        function deleteSavedRouteCorridor(routeId, event) {
            if(event) { event.stopPropagation(); event.preventDefault(); }
            savedRoutes = savedRoutes.filter(r => r.id !== routeId);
            localStorage.setItem('uk_fuel_saved_v2_routes', JSON.stringify(savedRoutes));
            updateDirectoryTotalBadge();
            renderDirectoryDropdown();
        }

        function loadSavedRouteCorridorDataIntoWorkspace(routeId) {
            const matchedRoute = savedRoutes.find(r => r.id === routeId);
            if (!matchedRoute) return;

            switchWorkflowTabContext('route');
            document.getElementById('route-start').value = matchedRoute.start;
            document.getElementById('route-end').value = matchedRoute.end;
            document.getElementById('vehicle-mpg').value = matchedRoute.mpg;
            document.getElementById('route-radius-slider').value = matchedRoute.radius;
            document.getElementById('route-radius-val').textContent = `${matchedRoute.radius} Mi`;

            const container = document.getElementById('dynamic-waypoints-container');
            if (container) {
                container.innerHTML = '';
                if(matchedRoute.waypoints && matchedRoute.waypoints.length > 0) {
                    matchedRoute.waypoints.forEach(wpStr => {
                        addWaypointFieldInputRow(wpStr);
                    });
                } else {
                    addWaypointFieldInputRow();
                }
            }

            executeRouteGenerationPipeline();
            document.getElementById('starred-dropdown-panel').classList.add('hidden');
        }

        function clearCalculatedRouteLayers() {
            if (routePolylineLayer) { map.removeLayer(routePolylineLayer); routePolylineLayer = null; }
            plottedRouteCoordinates = [];
            cachedGeocodedWaypoints = { start: null, end: null, vids: {} };
            
            document.getElementById('route-start').value = '';
            document.getElementById('route-end').value = '';
            document.getElementById('location-input').value = '';

            const container = document.getElementById('dynamic-waypoints-container');
            if (container) {
                container.innerHTML = '';
                addWaypointFieldInputRow();
            }

            document.getElementById('financial-card').classList.add('hidden');
            document.getElementById('traffic-telemetry-node').classList.add('hidden');
            document.getElementById('cheapest-ranking-block').classList.add('hidden');
            document.getElementById('route-weather-module').classList.add('hidden');
            refreshViewportViewFilter();
        }

        function computeDistanceVectorMiles(lat1, lon1, lat2, lon2) {
            const dLat = (lat2 - lat1) * 69.1;
            const dLon = (lon2 - lon1) * 41.0; 
            return Math.sqrt(dLat * dLat + dLon * dLon);
        }

        function computeMinimumDistanceToRouteCorridor(pointLat, pointLon) {
            let minimumTrackSeparationMiles = Infinity;
            for (let i = 0; i < plottedRouteCoordinates.length; i++) {
                const node = plottedRouteCoordinates[i];
                const distanceEstimate = computeDistanceVectorMiles(node[0], node[1], pointLat, pointLon);
                if (distanceEstimate < minimumTrackSeparationMiles) minimumTrackSeparationMiles = distanceEstimate;
            }
            return minimumTrackSeparationMiles;
        }

        document.getElementById('radius-slider')?.addEventListener('input', (e) => {
            document.getElementById('radius-val').textContent = `${e.target.value} Miles`; 
            refreshViewportViewFilter();
        });
        document.getElementById('route-radius-slider')?.addEventListener('input', (e) => {
            document.getElementById('route-radius-val').textContent = `${e.target.value} Miles`;
        });
        document.getElementById('fuel-type')?.addEventListener('change', () => {
            initializeClusterLayerPipeline();
            refreshViewportViewFilter();
            if (!document.getElementById('starred-dropdown-panel').classList.contains('hidden')) renderDirectoryDropdown();
        });

        document.addEventListener('click', (e) => {
            const suggestionBoxes = document.querySelectorAll('[id$="-suggestions"], [id^="via-suggestions-"]');
            suggestionBoxes.forEach(box => {
                if (!box.contains(e.target)) box.classList.add('hidden');
            });
        });

        async function forceReloadRemotePipelineData() {
            try {
                const response = await fetch('https://fuel-cron-scraper.jasonlung0.workers.dev/');
                const data = await response.json();
                
                rawGlobalStationsPool = data.map(s => {
                    const baseDiesel = parseFloat(s.B7);
                    return {
                        ...s,
                        PremiumDiesel: (baseDiesel && !isNaN(baseDiesel)) ? (baseDiesel + 14.2).toFixed(1) : null
                    };
                });
                
                const liveClock = new Date();
                document.getElementById('live-timestamp-label').innerHTML = `Prices Updated At ${liveClock.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}`;
                
                refreshViewportViewFilter();
            } catch (error) {
                console.error(error);
                document.getElementById('live-timestamp-label').textContent = "Offline Data Buffer Frame";
            }
        }

        function focusAndHighlightMapMarker(lat, lon) {
            if (isNaN(lat) || isNaN(lon)) return;
            map.setView([lat, lon], 14, { animate: true, duration: 0.5 });
            
            const selectedStation = currentlyVisibleStations.find(s => parseFloat(s.latitude || s.lat) === lat && parseFloat(s.longitude || s.lng) === lon) ||
                                   rawGlobalStationsPool.find(s => parseFloat(s.latitude || s.lat) === lat && parseFloat(s.longitude || s.lng) === lon);
            
            if (selectedStation) {
                setTimeout(() => { openForecourtDetailSheet(selectedStation); }, 300);
            }
        }

        function refreshViewportViewFilter(routeDistanceContext = null) {
            if (!rawGlobalStationsPool?.length) return;
            const chosenFuelVariant = document.getElementById('fuel-type')?.value || 'E10';
            const targetLocalRadiusThreshold = parseFloat(document.getElementById('radius-slider')?.value || 5);
            const targetCorridorRadiusThreshold = parseFloat(document.getElementById('route-radius-slider')?.value || 2);
            
            let dynamicBoundedStations = [];

            if (activeTabContext === 'local' || plottedRouteCoordinates.length === 0) {
                dynamicBoundedStations = rawGlobalStationsPool.filter(s => computeDistanceVectorMiles(mapSearchAnchorCoordinates[0], mapSearchAnchorCoordinates[1], parseFloat(s.latitude || s.lat), parseFloat(s.longitude || s.lng)) <= targetLocalRadiusThreshold);
            } else {
                dynamicBoundedStations = rawGlobalStationsPool.filter(s => computeMinimumDistanceToRouteCorridor(parseFloat(s.latitude || s.lat), parseFloat(s.longitude || s.lng)) <= targetCorridorRadiusThreshold);
            }

            currentlyVisibleStations = dynamicBoundedStations;
            paintMarkerCanvasLayersToMap(dynamicBoundedStations.slice(0, 250), chosenFuelVariant, dynamicBoundedStations.length, routeDistanceContext);
            generateCheapestRankingListDeck(dynamicBoundedStations, chosenFuelVariant);
        }

        function generateCheapestRankingListDeck(pool, fuelVariant) {
            const block = document.getElementById('cheapest-ranking-block');
            const container = document.getElementById('cheapest-cards-stack');
            const blockTitle = document.getElementById('ranking-block-title');
            if (!block || !container) return;

            const validPool = pool.filter(s => s[fuelVariant] && !isNaN(parseFloat(s[fuelVariant])) && parseFloat(s[fuelVariant]) > 0);
            if (validPool.length === 0) { block.classList.add('hidden'); return; }

            container.innerHTML = '';

            if (activeTabContext === 'route' && cachedGeocodedWaypoints.start && cachedGeocodedWaypoints.end) {
                blockTitle.textContent = "3 Cheapest Stations On Your Route";
                
                const milestoneLocationsList = [];
                milestoneLocationsList.push({ label: "Start", node: cachedGeocodedWaypoints.start });
                
                Object.keys(cachedGeocodedWaypoints.vids).forEach(key => {
                    milestoneLocationsList.push({ label: `Stopover`, node: cachedGeocodedWaypoints.vids[key] });
                });
                
                milestoneLocationsList.push({ label: "Destination", node: cachedGeocodedWaypoints.end });

                milestoneLocationsList.forEach(milestone => {
                    let rawMilestonePool = validPool.map(station => {
                        let distanceToNode = computeDistanceVectorMiles(milestone.node.lat, milestone.node.lon, parseFloat(station.latitude || station.lat), parseFloat(station.longitude || station.lng));
                        return { station, distanceToNode };
                    });

                    rawMilestonePool = rawMilestonePool.filter(item => item.distanceToNode <= 12);
                    rawMilestonePool.sort((a, b) => parseFloat(a.station[fuelVariant]) - parseFloat(b.station[fuelVariant]));

                    let slicedTopThree = rawMilestonePool.slice(0, 3);
                    if (slicedTopThree.length > 0) {
                        const subGroupWrapper = document.createElement('div');
                        subGroupWrapper.className = "space-y-1.5 p-2 bg-zinc-50/70 dark:bg-zinc-900/40 rounded-xl border border-zinc-100 dark:border-zinc-800/60";
                        
                        const subGroupHeader = document.createElement('div');
                        subGroupHeader.className = "flex justify-between items-center px-1 text-[9px] font-black tracking-tight text-zinc-400 dark:text-zinc-500 uppercase";
                        subGroupHeader.innerHTML = `<span>📍 ${milestone.label}: <span class="text-zinc-700 dark:text-zinc-300 font-black">${milestone.node.name.split(',')[0]}</span></span>`;
                        subGroupWrapper.appendChild(subGroupHeader);

                        slicedTopThree.forEach((item, idx) => {
                            const station = item.station;
                            const lat = parseFloat(station.latitude || station.lat);
                            const lon = parseFloat(station.longitude || station.lng);
                            const val = parseFloat(station[fuelVariant]).toFixed(1);

                            const card = document.createElement('div');
                            card.className = "flex items-center justify-between p-2.5 bg-white dark:bg-zinc-950 border border-zinc-200/60 dark:border-zinc-800 rounded-lg hover:border-emerald-500 transition shadow-xs cursor-pointer";
                            card.setAttribute('onclick', `focusAndHighlightMapMarker(${lat}, ${lon})`);
                            card.innerHTML = `
                                <div class="flex items-center gap-2 min-w-0">
                                    <div class="w-4 h-4 rounded bg-emerald-500/10 text-[8px] flex items-center justify-center shrink-0 font-black text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">#${idx + 1}</div>
                                    <div class="min-w-0">
                                        <div class="text-xs font-bold text-zinc-900 dark:text-white truncate">${(station.brand_name || 'Independent').replace(/['"]/g, '')}</div>
                                        <div class="text-[8px] font-medium text-zinc-400 dark:text-zinc-500 truncate block">${station.address || ''} • <span class="font-bold text-emerald-600">${item.distanceToNode.toFixed(1)} mi away</span></div>
                                    </div>
                                </div>
                                <div class="text-right shrink-0"><div class="text-[11px] font-black text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 border border-emerald-500/20 rounded-md">${val}p</div></div>
                            `;
                            subGroupWrapper.appendChild(card);
                        });
                        container.appendChild(subGroupWrapper);
                    }
                });
            } else {
                blockTitle.textContent = "Cheapest Stations Nearby";
                validPool.sort((a, b) => parseFloat(a[fuelVariant]) - parseFloat(b[fuelVariant]));
                
                validPool.slice(0, 3).forEach((station, idx) => {
                    const lat = parseFloat(station.latitude || station.lat);
                    const lon = parseFloat(station.longitude || station.lng);
                    const val = parseFloat(station[fuelVariant]).toFixed(1);
                    
                    const card = document.createElement('div');
                    card.className = "flex items-center justify-between p-3 bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 rounded-xl hover:border-emerald-500 transition shadow-sm cursor-pointer";
                    card.setAttribute('onclick', `focusAndHighlightMapMarker(${lat}, ${lon})`);
                    card.innerHTML = `
                        <div class="flex items-center gap-2 min-w-0">
                            <div class="w-5 h-5 rounded-md bg-emerald-500/10 text-[9px] flex items-center justify-center shrink-0 font-black text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">#${idx + 1}</div>
                            <div class="min-w-0">
                                <div class="text-xs font-black text-zinc-900 dark:text-white truncate flex items-center gap-1">${(station.brand_name || 'Independent').replace(/['"]/g, '')}</div>
                                <div class="text-[9px] font-medium text-zinc-400 dark:text-zinc-500 truncate mt-0.5">${station.address || ''}</div>
                            </div>
                        </div>
                        <div class="text-right shrink-0"><div class="text-xs font-black text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-2 py-0.5 border border-emerald-500/20 rounded-md">${val}p</div></div>
                    `;
                    container.appendChild(card);
                });
            }
            block.classList.remove('hidden');
        }

        function assignPricingTierColorStyles(valueRaw, variantKey) {
            const fallbackClasses = "bg-zinc-50 border-zinc-200 text-zinc-400 dark:bg-zinc-900 dark:border-zinc-800";
            if (!valueRaw) return fallbackClasses;
            const numericVal = parseFloat(valueRaw);
            if (isNaN(numericVal) || numericVal <= 0) return fallbackClasses;

            const referencePool = currentlyVisibleStations.map(item => parseFloat(item[variantKey])).filter(p => !isNaN(p) && p > 0);
            if (referencePool.length === 0) return "bg-blue-50 border-blue-200 text-blue-900 dark:bg-zinc-900 dark:border-zinc-800 dark:text-blue-400";

            const min = Math.min(...referencePool);
            const delta = Math.max(...referencePool) - min;
            if (delta <= 0) return "bg-emerald-50 dark:bg-emerald-950/40 border-emerald-500/30 text-emerald-600";

            const step = delta / 3;
            if (numericVal <= min + step) return "bg-emerald-50 dark:bg-emerald-950/40 border-emerald-400 dark:border-emerald-500/30 text-emerald-600 dark:text-emerald-400 font-bold";
            if (numericVal <= min + (step * 2)) return "bg-blue-50 dark:bg-blue-950/40 border-blue-400 dark:border-blue-500/30 text-blue-600 dark:text-blue-400 font-bold";
            return "bg-rose-50 dark:bg-rose-950/40 border-rose-400 dark:border-rose-500/30 text-rose-600 dark:text-rose-400 font-bold";
        }

        function paintMarkerCanvasLayersToMap(stationsList, variant, fallbackTotalCount, routeDistanceContext) {
            if(!markerClusterGroupInstance) return;
            markerClusterGroupInstance.clearLayers();
            
            const pricesArray = stationsList.map(s => parseFloat(s[variant])).filter(p => !isNaN(p) && p > 0);
            const minPrice = Math.min(...pricesArray) || 0;

            const finCard = document.getElementById('financial-card');
            if (finCard && pricesArray.length > 0) {
                finCard.classList.remove('hidden');
                if (activeTabContext === 'route' && routeDistanceContext) {
                    const totalTripPriceCostPounds = ((routeDistanceContext / parseFloat(document.getElementById('vehicle-mpg').value || 45)) * 4.54609 * minPrice) / 100;
                    document.getElementById('summary-distance').textContent = `${routeDistanceContext.toFixed(1)} miles`;
                    document.getElementById('summary-cost').textContent = `£${totalTripPriceCostPounds.toFixed(2)}`;
                } else {
                    document.getElementById('summary-distance').textContent = `Low`;
                    document.getElementById('summary-cost').textContent = `${minPrice.toFixed(1)}p`;
                }
            }

            stationsList.forEach((station) => {
                const numericPrice = parseFloat(station[variant]);
                if (!numericPrice) return;
                
                let tierBgClassColor = 'bg-fuel-blue';
                const pricesArrayZone = currentlyVisibleStations.map(s => parseFloat(s[variant])).filter(p => !isNaN(p) && p > 0);
                const zoneMin = Math.min(...pricesArrayZone);
                const zoneSpread = Math.max(...pricesArrayZone) - zoneMin;

                if (zoneSpread > 0) {
                    const step = zoneSpread / 3;
                    if (numericPrice <= (zoneMin + step)) tierBgClassColor = 'bg-fuel-green';
                    else if (numericPrice <= (zoneMin + (step * 2))) tierBgClassColor = 'bg-fuel-blue';
                    else tierBgClassColor = 'bg-fuel-red';
                }

                const markerInstance = L.marker([parseFloat(station.latitude || station.lat), parseFloat(station.longitude || station.lng)], {
                    stationRawData: station,
                    icon: L.divIcon({
                        html: `<div class="fuel-marker-bubble ${tierBgClassColor}"><span>${numericPrice.toFixed(1)}p</span></div>`,
                        className: 'leaflet-div-icon-reset', iconSize: [75, 28], iconAnchor: [37, 14]
                    })
                });
                
                markerInstance.on('click', (e) => {
                    L.DomEvent.stopPropagation(e);
                    openForecourtDetailSheet(station);
                });
                markerClusterGroupInstance.addLayer(markerInstance);
            });

            if (document.getElementById('station-counter')) document.getElementById('station-counter').textContent = `Stations: ${fallbackTotalCount}`;
        }

        function dismissFinancialDashboardBox(event) {
            if(event) { event.stopPropagation(); event.preventDefault(); }
            document.getElementById('financial-card').classList.add('hidden');
        }

        function toggleCurrentStationStar(event) {
            if(event) { event.stopPropagation(); event.preventDefault(); }
            if (!activeSheetStation) return;
            const stationKey = getStationUniqueSignature(activeSheetStation);
            const matchingIndex = starredStations.findIndex(s => getStationUniqueSignature(s) === stationKey);

            if (matchingIndex > -1) starredStations.splice(matchingIndex, 1);
            else starredStations.push(activeSheetStation);

            localStorage.setItem('uk_fuel_starred_v2_stations', JSON.stringify(starredStations));
            updateDirectoryTotalBadge();
            updateAllStarUIStates();
        }

        function updateAllStarUIStates() {
            if (!activeSheetStation) return;
            const isStarred = starredStations.some(s => getStationUniqueSignature(s) === getStationUniqueSignature(activeSheetStation));
            
            const sheetBtn = document.getElementById('sheet-star-btn');
            if (sheetBtn) {
                sheetBtn.innerHTML = isStarred ? ACTIVE_STAR_SVG : INACTIVE_STAR_SVG;
                sheetBtn.className = isStarred 
                    ? "p-2 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 text-amber-500 rounded-xl cursor-pointer flex items-center justify-center w-8 h-8"
                    : "p-2 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 text-zinc-400 hover:text-amber-500 rounded-xl cursor-pointer flex items-center justify-center w-8 h-8";
            }

            if (!document.getElementById('starred-dropdown-panel').classList.contains('hidden')) renderDirectoryDropdown();
        }

        function toggleStarredDropdownDashboardPanel(event) {
            if(event) { event.stopPropagation(); event.preventDefault(); }
            const panel = document.getElementById('starred-dropdown-panel');
            if (!panel) return;
            
            if (panel.classList.contains('hidden')) { 
                closeForecourtDetailSheet();
                panel.classList.remove('hidden'); 
                renderDirectoryDropdown(); 
            } else { 
                panel.classList.add('hidden'); 
            }
        }

        function renderDirectoryDropdown() {
            const container = document.getElementById('starred-list-container');
            if (!container) return;

            if (activeDirectoryTab === 'stations') {
                if (starredStations.length === 0) {
                    container.innerHTML = `<div class="text-center py-6 text-zinc-400 text-xs font-semibold">No monitored terminals.</div>`;
                    return;
                }
                container.innerHTML = '';
                starredStations.forEach(station => {
                    const cardRow = document.createElement('div');
                    cardRow.className = "p-2.5 bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 rounded-xl hover:border-emerald-500 transition cursor-pointer active:scale-[0.99] shadow-sm space-y-2";
                    cardRow.onclick = (event) => {
                        event.stopPropagation();
                        focusAndHighlightMapMarker(parseFloat(station.latitude || station.lat), parseFloat(station.longitude || station.lng));
                        if (window.innerWidth < 768) document.getElementById('starred-dropdown-panel').classList.add('hidden');
                    };

                    cardRow.innerHTML = `
                        <div class="min-w-0">
                            <div class="text-xs font-black text-zinc-900 dark:text-white truncate flex items-center gap-1">${(station.brand_name || 'Independent').replace(/['"]/g, '')}</div>
                            <div class="text-[9px] font-semibold text-zinc-400 dark:text-zinc-500 truncate mt-0.5">${(station.address || '').replace(/['"]/g, '')}</div>
                        </div>
                        <div class="grid grid-cols-2 gap-1 pt-0.5">
                            <div class="border p-1 rounded-lg text-center ${assignPricingTierColorStyles(station.E10, 'E10')}"><div class="text-[7px] font-bold uppercase tracking-tight opacity-75">E10</div><div class="text-[10px] font-black mt-0.5">${station.E10 ? `${parseFloat(station.E10).toFixed(1)}p` : 'N/A'}</div></div>
                            <div class="border p-1 rounded-lg text-center ${assignPricingTierColorStyles(station.B7, 'B7')}"><div class="text-[7px] font-bold uppercase tracking-tight opacity-75">Diesel</div><div class="text-[10px] font-black mt-0.5">${station.B7 ? `${parseFloat(station.B7).toFixed(1)}p` : 'N/A'}</div></div>
                        </div>`;
                    container.appendChild(cardRow);
                });
            } else {
                if (savedRoutes.length === 0) {
                    container.innerHTML = `<div class="text-center py-6 text-zinc-400 text-xs font-semibold">No custom routes found.</div>`;
                    return;
                }
                container.innerHTML = '';
                savedRoutes.forEach(route => {
                    const cardRow = document.createElement('div');
                    cardRow.className = "p-2.5 bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 rounded-xl hover:border-blue-500 transition cursor-pointer active:scale-[0.99] shadow-sm flex items-center justify-between gap-2";
                    cardRow.onclick = (event) => {
                        event.stopPropagation();
                        loadSavedRouteCorridorDataIntoWorkspace(route.id);
                        if (window.innerWidth < 768) document.getElementById('starred-dropdown-panel').classList.add('hidden');
                    };

                    cardRow.innerHTML = `
                        <div class="min-w-0 flex-1">
                            <div class="text-xs font-black text-zinc-900 dark:text-white truncate flex items-center gap-1">🛣️ ${route.name}</div>
                            <div class="text-[8px] font-bold text-zinc-400 dark:text-zinc-500 tracking-wide uppercase mt-1">MPG: ${route.mpg} • Stops: ${route.waypoints ? route.waypoints.length : 0}</div>
                        </div>
                        <button onclick="deleteSavedRouteCorridor('${route.id}', event)" class="p-1.5 text-zinc-400 hover:text-rose-500 cursor-pointer rounded-lg hover:bg-rose-500/10 transition" title="Delete Saved Corridor">
                            ✕
                        </button>
                    `;
                    container.appendChild(cardRow);
                });
            }
        }

        function openForecourtDetailSheet(stationData) {
            const sheet = document.getElementById('global-detail-sheet');
            if (!sheet) return;

            document.getElementById('starred-dropdown-panel').classList.add('hidden');
            activeSheetStation = stationData;

            document.getElementById('sheet-brand-title').textContent = (stationData.brand_name || 'Independent Hub').replace(/['"]/g, '');
            document.getElementById('sheet-address-details').textContent = (stationData.address || 'UK Grid Station').replace(/['"]/g, '');

            document.getElementById('card-wrap-e10').className = `border p-2.5 rounded-xl text-center transition-all ${assignPricingTierColorStyles(stationData.E10, 'E10')}`;
            document.getElementById('card-wrap-e5').className = `border p-2.5 rounded-xl text-center transition-all ${assignPricingTierColorStyles(stationData.E5, 'E5')}`;
            document.getElementById('card-wrap-b7').className = `border p-2.5 rounded-xl text-center transition-all ${assignPricingTierColorStyles(stationData.B7, 'B7')}`;
            document.getElementById('card-wrap-premiumdiesel').className = `border p-2.5 rounded-xl text-center transition-all ${assignPricingTierColorStyles(stationData.PremiumDiesel, 'PremiumDiesel')}`;

            document.getElementById('sheet-price-e10').textContent = stationData.E10 ? `${parseFloat(stationData.E10).toFixed(1)}p` : 'N/A';
            document.getElementById('sheet-price-e5').textContent = stationData.E5 ? `${parseFloat(stationData.E5).toFixed(1)}p` : 'N/A';
            document.getElementById('sheet-price-b7').textContent = stationData.B7 ? `${parseFloat(stationData.B7).toFixed(1)}p` : 'N/A';
            document.getElementById('sheet-price-premiumdiesel').textContent = stationData.PremiumDiesel ? `${parseFloat(stationData.PremiumDiesel).toFixed(1)}p` : 'N/A';

            updateAllStarUIStates();
            sheet.classList.remove('hidden');

            if (window.innerWidth < 768) {
                setMobileSheetUIState('full'); 
            } else {
                sheet.className = sheet.className.replace(/\bdrawer-\w+/g, '');
            }
        }

        function closeForecourtDetailSheet(event) {
            if(event) { event.stopPropagation(); event.preventDefault(); }
            const sheet = document.getElementById('global-detail-sheet');
            if (!sheet) return;
            
            if (window.innerWidth < 768) {
                setMobileSheetUIState('hidden');
            } else {
                sheet.classList.add('hidden');
            }
            activeSheetStation = null;
        }

        function getStationUniqueSignature(s) {
            if (!s) return '';
            return `${s.latitude || s.lat}_${s.longitude || s.lng}_${s.brand_name || ''}`.replace(/\s+/g, '');
        }

        function triggerExternalMappingVectorRoute(event) {
            if(event) { event.stopPropagation(); event.preventDefault(); }
            if (!activeSheetStation) return;
            const lat = activeSheetStation.latitude || activeSheetStation.lat;
            const lon = activeSheetStation.longitude || activeSheetStation.lng;
            window.open(`https://maps.google.com/?q=${lat},${lon}`, '_blank');
        }

        function setMobileSidebarState(stateStr) {
            currentMobileSidebarUIState = stateStr;
            const sidebar = document.getElementById('primary-control-sidebar');
            if (!sidebar) return;
            
            sidebar.className = sidebar.className.replace(/\bdrawer-\w+/g, '');
            sidebar.classList.add(`drawer-${stateStr}`);
        }

        function setMobileSheetUIState(stateStr) {
            currentMobileSheetUIState = stateStr;
            const sheet = document.getElementById('global-detail-sheet');
            if (!sheet) return;
            
            sheet.className = sheet.className.replace(/\bdrawer-\w+/g, '');
            if (stateStr === 'hidden') {
                sheet.classList.add('hidden');
            } else {
                sheet.classList.remove('hidden');
                sheet.classList.add(`drawer-${stateStr}`);
            }
        }

        function initializeClickIsolationBubbling() {
            const structuralIDs = ['global-detail-sheet', 'starred-dropdown-panel', 'primary-control-sidebar'];
            structuralIDs.forEach(id => {
                const node = document.getElementById(id);
                if (node) {
                    node.addEventListener('click', (e) => { e.stopPropagation(); });
                    node.addEventListener('dblclick', (e) => { e.stopPropagation(); });
                }
            });
        }

        function bindSwipeGestureDetectionToMobileSheets(handleId, elementId, stateModificationCallback) {
            const targetHandle = document.getElementById(handleId);
            if (!targetHandle) return;

            let touchBaseY = 0;
            let touchCurrentY = 0;
            let touchStartTime = 0;

            targetHandle.addEventListener('touchstart', (e) => {
                touchBaseY = e.touches[0].clientY;
                touchStartTime = Date.now();
            }, { passive: true });

            targetHandle.addEventListener('touchmove', (e) => {
                touchCurrentY = e.touches[0].clientY;
            }, { passive: true });

            targetHandle.addEventListener('touchend', () => {
                const trackDeltaY = touchBaseY - touchCurrentY;
                const timeframeDuration = Date.now() - touchStartTime;
                
                if (Math.abs(trackDeltaY) < 35) return; 

                const velocityPixelsPerMs = Math.abs(trackDeltaY) / timeframeDuration;
                let currentActiveState = (elementId === 'sidebar') ? currentMobileSidebarUIState : currentMobileSheetUIState;

                if (trackDeltaY > 35) {
                    if (velocityPixelsPerMs > 0.85 || Math.abs(trackDeltaY) > 160) {
                        stateModificationCallback('full');
                    } else {
                        if (currentActiveState === 'peek') stateModificationCallback('mid');
                        else if (currentActiveState === 'mid') stateModificationCallback('full');
                    }
                } else if (trackDeltaY < -35) {
                    if (velocityPixelsPerMs > 0.85 || Math.abs(trackDeltaY) > 160) {
                        if (elementId === 'sidebar') stateModificationCallback('peek');
                        else stateModificationCallback('hidden');
                    } else {
                        if (currentActiveState === 'full') stateModificationCallback('mid');
                        else if (currentActiveState === 'mid') {
                            if (elementId === 'sidebar') stateModificationCallback('peek');
                            else stateModificationCallback('hidden');
                        }
                    }
                }
            });
        }

        function initializeGestureTrackEngine() {
            document.getElementById('sidebar-drag-handle')?.addEventListener('click', (e) => {
                e.stopPropagation();
                if (currentMobileSidebarUIState === 'peek') setMobileSidebarState('mid');
                else if (currentMobileSidebarUIState === 'mid') setMobileSidebarState('full');
                else if (currentMobileSidebarUIState === 'full') setMobileSidebarState('peek');
            });

            document.getElementById('detail-sheet-drag-handle')?.addEventListener('click', (e) => {
                e.stopPropagation();
                if (currentMobileSheetUIState === 'peek') setMobileSheetUIState('mid');
                else if (currentMobileSheetUIState === 'mid') setMobileSheetUIState('full');
                else if (currentMobileSheetUIState === 'full') setMobileSheetUIState('peek');
            });

            bindSwipeGestureDetectionToMobileSheets('sidebar-drag-handle', 'sidebar', setMobileSidebarState);
            bindSwipeGestureDetectionToMobileSheets('detail-sheet-drag-handle', 'sheet', setMobileSheetUIState);
        }


        let refuelMarkersGroup = null;
        
        // Helper to calculate distance between two lat/lon pairs in miles
        function getDistanceInMiles(lat1, lon1, lat2, lon2) {
            const R = 3958.8; // Earth radius in miles
            const dLat = (lat2 - lat1) * Math.PI / 180;
            const dLon = (lon2 - lon1) * Math.PI / 180;
            const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon/2) * Math.sin(dLon/2);
            return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        }
        
        async function calculateOptimalRefuelStrategy() {
            if (!plottedRouteCoordinates || plottedRouteCoordinates.length === 0) {
                alert("Please map out a route first!");
                return;
            }
        
            // 1. Read Variable Constraints
            const tankSizeLiters = parseFloat(document.getElementById('refuel-tank-size').value || 55);
            const initialFuelPct = parseFloat(document.getElementById('refuel-current-level').value || 35) / 100;
            const safetyBufferMiles = parseFloat(document.getElementById('refuel-safety-buffer').value || 30);
            
            const mpgInput = parseFloat(document.getElementById('mpg')?.value || 45);
            const selectedFuelType = document.getElementById('fuelType')?.value || 'E5'; // matching your application properties
        
            // Conversions
            const milesPerLiter = (mpgInput * 0.220084); 
            const maxRangeMiles = tankSizeLiters * milesPerLiter;
            let currentRangeMiles = (tankSizeLiters * initialFuelPct) * milesPerLiter;
        
            // Clear previous strategy markers
            if (refuelMarkersGroup) map.removeLayer(refuelMarkersGroup);
            refuelMarkersGroup = L.layerGroup().addTo(map);
        
            // 2. Linearize stations along your route path vectors
            const timelineContainer = document.getElementById('refuel-timeline-output');
            const savingsBadge = document.getElementById('refuel-savings-badge');
            timelineContainer.innerHTML = '';
            timelineContainer.classList.remove('hidden');
        
            // Filter available stations nearby the route 
            // Uses your rawGlobalStationsPool array filtering for active pricing
            let candidateStations = rawGlobalStationsPool.filter(station => {
                const price = station[selectedFuelType.toLowerCase()] || station.prices?.[selectedFuelType];
                if (!price || price === 'N/A') return false;
                
                // Match proximity to any waypoint point along the polyline path
                return plottedRouteCoordinates.some(pt => getDistanceInMiles(pt[0], pt[1], station.lat, station.lng || station.lon) < 2.5);
            });
        
            // Map distances from start point sequentially
            let totalRouteDistanceMiles = 0;
            let sequencedRoutePoints = [];
            
            for(let i=0; i < plottedRouteCoordinates.length; i++) {
                if(i > 0) {
                    totalRouteDistanceMiles += getDistanceInMiles(
                        plottedRouteCoordinates[i-1][0], plottedRouteCoordinates[i-1][1],
                        plottedRouteCoordinates[i][0], plottedRouteCoordinates[i][1]
                    );
                }
                sequencedRoutePoints.push({
                    mileMarker: totalRouteDistanceMiles,
                    coords: plottedRouteCoordinates[i]
                });
            }
        
            // Bind stations to their closest relative mile marker points along the journey
            let mappedStations = candidateStations.map(station => {
                let sLat = station.lat;
                let sLon = station.lng || station.lon;
                let closestPoint = sequencedRoutePoints.reduce((prev, curr) => {
                    let dist = getDistanceInMiles(sLat, sLon, curr.coords[0], curr.coords[1]);
                    return (dist < prev.dist) ? { dist, marker: curr.mileMarker } : prev;
                }, { dist: Infinity, marker: 0 });
        
                return {
                    ...station,
                    mileMarker: closestPoint.marker,
                    price: parseFloat(station[selectedFuelType.toLowerCase()] || station.prices?.[selectedFuelType])
                };
            }).sort((a, b) => a.mileMarker - b.mileMarker);
        
            // 3. Greedy Optimization Sweep Architecture
            let currentPositionMiles = 0;
            let stopsPlanned = [];
            let cumulativeCost = 0;
            let lastRefuelPosition = 0;
            let baselineCost = 0; // tracking savings metrics
        
            while ((currentPositionMiles + currentRangeMiles) < totalRouteDistanceMiles) {
                // Window of reachable stations before running completely dry
                let maxReach = currentPositionMiles + currentRangeMiles - safetyBufferMiles;
                let reachableStations = mappedStations.filter(s => s.mileMarker > currentPositionMiles && s.mileMarker <= maxReach);
        
                if (reachableStations.length === 0) {
                    // Safety fallback: if no stations match within the strict safety margin, extend to absolute max range limit
                    maxReach = currentPositionMiles + currentRangeMiles;
                    reachableStations = mappedStations.filter(s => s.mileMarker > currentPositionMiles && s.mileMarker <= maxReach);
                    
                    if(reachableStations.length === 0) {
                        // Break out if completely stranded in data deadzones
                        break;
                    }
                }
        
                // Strategy algorithm rule: Pick the absolute cheapest station within our reachable window ahead
                let optimalStation = reachableStations.reduce((cheapest, current) => (current.price < cheapest.price) ? current : cheapest, reachableStations[0]);
        
                let distanceToStation = optimalStation.mileMarker - currentPositionMiles;
                currentRangeMiles -= distanceToStation;
                currentPositionMiles = optimalStation.mileMarker;
        
                // Simulate full refuel action
                let fuelNeededLiters = tankSizeLiters - (currentRangeMiles / milesPerLiter);
                let stopCost = fuelNeededLiters * (optimalStation.price / 100);
                cumulativeCost += stopCost;
        
                // Baseline comparison (average fuel cost along the route without using optimization logic)
                let avgWindowPrice = reachableStations.reduce((sum, s) => sum + s.price, 0) / reachableStations.length;
                baselineCost += fuelNeededLiters * (avgWindowPrice / 100);
        
                stopsPlanned.push({
                    station: optimalStation,
                    mileMarker: optimalStation.mileMarker,
                    litersFilled: fuelNeededLiters.toFixed(1),
                    cost: stopCost.toFixed(2),
                    price: optimalStation.price
                });
        
                // Reset range parameters
                currentRangeMiles = maxRangeMiles; 
            }
        
            // 4. Render Layout & Map Highlights
            let totalSavings = Math.max(0, baselineCost - cumulativeCost);
            if(totalSavings > 0) {
                savingsBadge.innerText = `SAVING £${totalSavings.toFixed(2)}`;
                savingsBadge.classList.remove('hidden');
            }
        
            // Render Timeline components
            timelineContainer.innerHTML = `
                <div class="text-[10px] uppercase font-black text-zinc-400 tracking-wider flex items-center gap-1.5">
                    <span class="w-2 h-2 rounded-full bg-blue-500"></span> Start of Route (0 mi)
                </div>
            `;
        
            stopsPlanned.forEach((stop, index) => {
                // Append entry elements inside sidebar timeline
                const stopRow = document.createElement('div');
                stopRow.className = "pl-4 border-l-2 border-dashed border-emerald-500/50 my-2 position-relative py-1";
                stopRow.innerHTML = `
                    <div class="text-xs font-black text-emerald-400">${stop.station.brand || stop.station.name || 'Fuel Station'}</div>
                    <div class="text-[10px] text-zinc-300 font-medium">Stop #${index + 1} at Mile ${stop.mileMarker.toFixed(1)} • <span class="font-bold text-white">${stop.price}p/L</span></div>
                    <div class="text-[10px] font-bold text-zinc-400 mt-0.5">💡 Action: Fill <span class="text-emerald-400">${stop.litersFilled}L</span> (~£${stop.cost})</div>
                `;
                timelineContainer.appendChild(stopRow);
        
                // Render Custom Highlight Pin on Map
                const pulseIcon = L.divIcon({
                    className: 'leaflet-div-icon-reset',
                    html: `
                        <div class="flex flex-col items-center">
                            <div class="bg-black text-emerald-400 text-[9px] font-black px-1.5 py-0.5 rounded-md border border-emerald-500 shadow-xl whitespace-nowrap">
                                ⛽ STOP #${index + 1} (${stop.price}p)
                            </div>
                            <div class="w-2 h-2 bg-emerald-400 rounded-full border border-black animate-ping -mt-1"></div>
                        </div>
                    `,
                    iconSize: [100, 40],
                    iconAnchor: [50, 20]
                });
        
                L.marker([stop.station.lat, stop.station.lng || stop.station.lon], { icon: pulseIcon })
                 .addTo(refuelMarkersGroup)
                 .bindPopup(`<b>${stop.station.brand || 'Refuel Recommendation'}</b><br>Fill Amount: ${stop.litersFilled}L<br>Price: ${stop.price}p`);
            });
        
            timelineContainer.innerHTML += `
                <div class="text-[10px] uppercase font-black text-zinc-400 tracking-wider flex items-center gap-1.5 pt-1">
                    <span class="w-2 h-2 rounded-full bg-red-500"></span> Destination (${totalRouteDistanceMiles.toFixed(1)} mi)
                </div>
            `;
        }



        window.addEventListener('DOMContentLoaded', () => {
        initializeSpatialMapEngine();
        applyThemeChangesToDOM();
        setupAutocompleteListeners();
        initializeClickIsolationBubbling();
        initializeGestureTrackEngine();
        forceReloadRemotePipelineData();
        
        // ADD THIS LINE HERE:
        document.getElementById('trigger-refuel-optimizer')?.addEventListener('click', calculateOptimalRefuelStrategy);
        
        if(window.innerWidth < 768) {
            setMobileSidebarState('peek');
        }
    });
