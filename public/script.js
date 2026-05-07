/* =========================================================
   Mumbai TSP Delivery App — script.js
   TSP-optimised delivery simulation with:
   • Traffic-aware animation (slows on yellow/red)
   • TSP savings vs naive-order comparison
   • Live distance & time progress with completion summary
   • Ghost overlay for abandoned routes after rerouting
   • Proper timeline with per-node state machine
   ========================================================= */

// ============================================================
// 1.  DATA
// ============================================================
const mockLocations = [
  { id:"P1",  name:"Dadar Central Hub",               lat:19.0178, lng:72.8441, isWarehouse:true },
  { id:"P2",  name:"Bandra West Hub",                 lat:19.0596, lng:72.8295, isWarehouse:true },
  { id:"P3",  name:"Andheri West Logistics",          lat:19.1171, lng:72.8315, isWarehouse:true },
  { id:"P4",  name:"Borivali Depot",                  lat:19.2288, lng:72.8540, isWarehouse:true },
  { id:"P5",  name:"Kurla Dispatch Center",           lat:19.0673, lng:72.8824, isWarehouse:true },
  { id:"D1",  name:"Worli Seaface Apartment",         lat:19.0169, lng:72.8156 },
  { id:"D2",  name:"BKC Corporate Office",            lat:19.0664, lng:72.8658 },
  { id:"D3",  name:"Juhu Beach Residences",           lat:19.1033, lng:72.8252 },
  { id:"D4",  name:"Powai Hiranandani",               lat:19.1176, lng:72.9060 },
  { id:"D5",  name:"Goregaon East IT Park",           lat:19.1646, lng:72.8493 },
  { id:"D6",  name:"Malad Mindspace",                 lat:19.1843, lng:72.8415 },
  { id:"D7",  name:"Kandivali Thakur Village",        lat:19.2085, lng:72.8732 },
  { id:"D8",  name:"Chembur Diamond Garden",          lat:19.0435, lng:72.9026 },
  { id:"D9",  name:"Colaba Causeway Drop",            lat:18.9167, lng:72.8247 },
  { id:"D10", name:"Lower Parel Palladium",           lat:18.9953, lng:72.8300 },
  { id:"D11", name:"Vile Parle East Society",         lat:19.0968, lng:72.8462 },
  { id:"D12", name:"Ghatkopar West Market",           lat:19.0867, lng:72.9080 },
  { id:"CM1", name:"Vashi Sector 17, Navi Mumbai",   lat:19.0772, lng:72.9980 },
  { id:"CM2", name:"Airoli Knowledge Park",           lat:19.1551, lng:72.9934 },
  { id:"CM3", name:"Seawoods Station, Navi Mumbai",  lat:19.0197, lng:73.0189 },
  { id:"CM4", name:"Belapur CBD, Navi Mumbai",        lat:19.0156, lng:73.0378 },
  { id:"CM5", name:"Thane West Majiwada",             lat:19.2084, lng:72.9781 },
  { id:"CM6", name:"Mulund West LBS Road",            lat:19.1724, lng:72.9463 },
  { id:"CM7", name:"Bhandup West Station Area",       lat:19.1466, lng:72.9366 },
  { id:"CM8", name:"Kanjurmarg East Village",         lat:19.1293, lng:72.9361 },
  { id:"CM9", name:"Vikhroli West Station",           lat:19.1105, lng:72.9261 },
  { id:"CM10",name:"Kurla West Market",               lat:19.0734, lng:72.8795 },
  { id:"CM11",name:"Sion East Circle",                lat:19.0413, lng:72.8647 },
  { id:"CM12",name:"Matunga East Five Gardens",       lat:19.0253, lng:72.8553 },
  { id:"CM13",name:"Andheri East MIDC",               lat:19.1136, lng:72.8697 },
  { id:"CM14",name:"Jogeshwari West SV Road",         lat:19.1396, lng:72.8427 },
  { id:"CM15",name:"Goregaon West Hub",               lat:19.1652, lng:72.8465 },
  { id:"CM16",name:"Malad West Link Road",            lat:19.1868, lng:72.8354 },
  { id:"CM17",name:"Kandivali West Mahavir Nagar",    lat:19.2104, lng:72.8361 },
  { id:"CM18",name:"Borivali West I C Colony",        lat:19.2274, lng:72.8420 },
  { id:"CM19",name:"Dahisar East Check Naka",         lat:19.2555, lng:72.8660 },
  { id:"CM20",name:"Mira Road East Srishti",          lat:19.2828, lng:72.8683 }
];

// ============================================================
// 2.  STATE
// ============================================================
let map;
let markers            = [];
let deliveryCursor     = null;
let simRunning         = false;
let originalPayload    = [];          // full payload array used for simulation
let maxParcels         = 10;
let selectedParcels    = new Set();
let startingWarehouseId= null;
let currentFullSequence= [];          // current TSP path (indices into payload)
let routeLegs          = [];          // [{coords, distance, duration, trafficSegs, subSegments, completed}]
let ghostPolylines     = [];          // fading lines of abandoned route after reroute
let currentAnimFrame   = null;
let trafficSeed        = 0;
let lastTspResult      = null;        // last API response for TSP savings display
let originalRouteKm    = 0;           // original optimal distance (no traffic)
let originalRouteMins  = 0;           // original optimal time (no traffic)

// ============================================================
// 3.  DOM REFS
// ============================================================
const warehouseSelect   = document.getElementById('warehouse-select');
const inventoryBar      = document.getElementById('inventory-bar');
const calcBtn           = document.getElementById('calculate-btn');
const simBtn            = document.getElementById('simulate-btn');
const simSpeedSel       = document.getElementById('sim-speed');
const simStatus         = document.getElementById('sim-status');
const simControls       = document.getElementById('simulation-controls');
const dynRerouteCheck   = document.getElementById('dynamic-reroute');
const parcelCountEl     = document.getElementById('parcel-count');
const loadingOverlay    = document.getElementById('loading-overlay');
const routeResult       = document.getElementById('route-result');
const timelineSection   = document.getElementById('timeline-section');
const routeTimeline     = document.getElementById('route-timeline');

// ============================================================
// 4.  ICONS / HELPERS
// ============================================================
const delay = ms => new Promise(r => setTimeout(r, ms));

const TRUCK_SVG = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>`;
const STORE_SVG = `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>`;
const PKG_SVG   = `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><line x1="16.5" y1="9.4" x2="7.5" y2="4.21"/><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>`;
const CHECK_SVG = `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>`;

// Inline status icons for simulation messages (14px, vertically aligned)
const STATUS_DELIVERED = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#2e7d32" stroke-width="2.5" style="vertical-align:-2px;margin-right:4px;"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>`;
const STATUS_WARNING  = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#E53935" stroke-width="2.5" style="vertical-align:-2px;margin-right:4px;"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`;
const STATUS_CHECK    = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#4CAF50" stroke-width="2.5" style="vertical-align:-2px;margin-right:4px;"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>`;
const STATUS_COMPLETE = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#2e7d32" stroke-width="2.5" style="vertical-align:-2px;margin-right:4px;"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>`;

function makeIcon(color, svg, size = 30, extraClass = "") {
  return L.divIcon({
    className: 'custom-leaflet-icon',
    html: `<div class="marker-container ${extraClass}" style="background:${color};color:#fff;border-radius:50%;width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center;border:2px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.3);">${svg}</div>`,
    iconSize: [size, size], iconAnchor: [size/2, size/2], popupAnchor: [0, -size/2]
  });
}

function greyOf(color) {
  const map = { '#4CAF50':'#A5D6A7', '#FF9800':'#FFCC80', '#F44336':'#EF9A9A' };
  return map[color] || '#BDBDBD';
}

/** Haversine distance in metres */
function haversineM(lat1, lng1, lat2, lng2) {
  const R=6371000, d2r=Math.PI/180;
  const dLat=(lat2-lat1)*d2r, dLng=(lng2-lng1)*d2r;
  const a=Math.sin(dLat/2)**2+Math.cos(lat1*d2r)*Math.cos(lat2*d2r)*Math.sin(dLng/2)**2;
  return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
}

/** Traffic-adjusted duration in minutes for a leg */
function trafficMins(leg) {
  const base = leg.duration / 60;
  if (!leg.trafficSegs || leg.trafficSegs.length === 0) return base;
  const total = leg.trafficSegs.reduce((s,seg) => s + Math.max(1, seg.ei - seg.si), 0);
  const wtd   = leg.trafficSegs.reduce((s,seg) => s + Math.max(1, seg.ei - seg.si) * seg.mult, 0);
  return base * (total > 0 ? wtd/total : 1);
}

// ============================================================
// 5.  MAP INIT
// ============================================================
function initMap() {
  map = L.map('map').setView([19.076, 72.878], 11);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '© OpenStreetMap'
  }).addTo(map);
}

// ============================================================
// 6.  INVENTORY
// ============================================================
function renderInventory() {
  inventoryBar.innerHTML = '';
  mockLocations.filter(l => !l.isWarehouse).forEach(p => {
    const card = document.createElement('div');
    card.className = 'parcel-card';
    card.id = `card-${p.id}`;
    card.innerHTML = `
      <div class="parcel-info">
        <div class="parcel-title">${p.name}</div>
        <div class="parcel-subtitle">ID: ${p.id}</div>
      </div>
      <div class="parcel-icon">${PKG_SVG}</div>`;
    card.addEventListener('click', () => toggleParcel(p.id, card));
    inventoryBar.appendChild(card);
  });
}

function toggleParcel(id, el) {
  if (selectedParcels.has(id)) {
    selectedParcels.delete(id); el.classList.remove('active');
  } else {
    if (selectedParcels.size >= maxParcels) { alert("Maximum 10 parcels allowed!"); return; }
    selectedParcels.add(id); el.classList.add('active');
  }
  parcelCountEl.innerText = selectedParcels.size;
  redrawMarkers();
}

// ============================================================
// 7.  MARKERS
// ============================================================
function redrawMarkers() {
  markers.forEach(m => m.marker && map.removeLayer(m.marker));
  markers = [];
  clearAllRoutes();
  routeResult.classList.add('hidden');
  simControls.classList.add('hidden');
  if (startingWarehouseId) {
    const wh = mockLocations.find(l => l.id === startingWarehouseId);
    if (wh) drawPin(wh, true, false);
  }
  selectedParcels.forEach(id => {
    const loc = mockLocations.find(l => l.id === id);
    if (loc) drawPin(loc, false, false);
  });
  if (markers.length > 0)
    map.fitBounds(new L.featureGroup(markers.map(m => m.marker)).getBounds(), { padding:[20,20], maxZoom:14 });
}

function drawPin(loc, isWarehouse, isDelivered, state = 'pending') {
  // state: 'pending' | 'traveling-to' | 'delivered' | 'warehouse'
  let color = '#777';
  if (isWarehouse) color = '#1a1a2e';
  else if (state === 'delivered')   color = '#2e7d32';
  else if (state === 'traveling-to') color = '#FF9800';
  const icon = isWarehouse ? STORE_SVG : (state === 'delivered' ? CHECK_SVG : PKG_SVG);
  const cls  = state === 'traveling-to' ? 'delivering-anim'
             : (state === 'delivered' && !isWarehouse ? 'delivered-anim' : '');
  const size = state === 'traveling-to' ? 36 : 30;
  const m = L.marker([loc.lat, loc.lng], { icon: makeIcon(color, icon, size, cls) })
              .bindPopup(`<b>${loc.name}</b>`).addTo(map);
  markers.push({ id: loc.id, marker: m });
  return m;
}

// ============================================================
// 8.  ROUTE CLEANUP
// ============================================================
function clearAllRoutes() {
  routeLegs.forEach(leg => leg.subSegments?.forEach(s => s.polyline && map.removeLayer(s.polyline)));
  routeLegs = [];
  clearGhost();
  if (deliveryCursor)   { map.removeLayer(deliveryCursor); deliveryCursor = null; }
  if (currentAnimFrame) { cancelAnimationFrame(currentAnimFrame); currentAnimFrame = null; }
  simRunning = false;
}


function clearGhost() { ghostPolylines.forEach(p => map.removeLayer(p)); ghostPolylines = []; }

// ============================================================
// 9.  OSRM FETCH
// ============================================================
async function fetchRouteLegs(waypoints) {
  const coordStr = waypoints.map(w => `${w.lng},${w.lat}`).join(';');
  try {
    const resp = await fetch(
      `https://router.project-osrm.org/route/v1/driving/${coordStr}?overview=false&steps=true&geometries=geojson`
    );
    const data = await resp.json();
    if (data.code === 'Ok' && data.routes?.[0]?.legs) {
      return data.routes[0].legs.map(leg => {
        const coords = [];
        leg.steps.forEach(s => {
          const sc = s.geometry.coordinates.map(c => [c[1], c[0]]);
          coords.length === 0 ? coords.push(...sc) : coords.push(...sc.slice(1));
        });
        return { coords, distance: leg.distance, duration: leg.duration };
      });
    }
  } catch(e) { console.warn('OSRM route fetch failed:', e); }
  // Fallback: straight-line legs
  return waypoints.slice(0,-1).map((w, i) => {
    const d = haversineM(w.lat, w.lng, waypoints[i+1].lat, waypoints[i+1].lng);
    return { coords:[[w.lat,w.lng],[waypoints[i+1].lat,waypoints[i+1].lng]], distance:d, duration:d/8.33 };
  });
}

// ============================================================
// 10. TRAFFIC SUB-SEGMENTS
// ============================================================
function buildSubSegments(coords) {
  if (coords.length < 6) return [{ si:0, ei:coords.length-1, color:'#4CAF50', mult:1 }];
  const n = 3 + Math.floor(Math.random() * 4);
  let breaks = [0];
  for (let i=1; i<n; i++) {
    const minB = breaks[breaks.length-1] + Math.max(3, Math.floor(coords.length/(n*2)));
    const maxB = Math.min(coords.length-3, Math.floor(coords.length*(i/n)+coords.length/(n*0.8)));
    breaks.push(Math.max(minB, Math.min(maxB, minB + Math.floor(Math.random()*(maxB-minB+1)))));
  }
  breaks.push(coords.length - 1);
  return breaks.slice(0,-1).map((b, i) => {
    const roll = Math.random();
    const color = roll < 0.12 ? '#F44336' : roll < 0.35 ? '#FF9800' : '#4CAF50';
    const mult  = roll < 0.12 ? 3.0       : roll < 0.35 ? 1.5       : 1.0;
    return { si:b, ei:breaks[i+1], color, mult };
  });
}

// ============================================================
// 11. DRAW / CLEAR LEGS
// ============================================================
function drawRouteLeg(legData, isCompleted) {
  legData.subSegments = legData.trafficSegs.map(seg => {
    const slice = legData.coords.slice(seg.si, seg.ei+1);
    const color = isCompleted ? greyOf(seg.color) : seg.color;
    const poly  = L.polyline(slice, {
      color, weight: 5, opacity: 0.9,
      dashArray: isCompleted ? '8,8' : null
    }).addTo(map);
    return { ...seg, polyline: poly };
  });
}

function clearFutureLegs(fromLeg) {
  for (let i = fromLeg; i < routeLegs.length; i++)
    routeLegs[i].subSegments?.forEach(s => s.polyline && map.removeLayer(s.polyline));
}

async function drawFullRoute(sequence, payload, completedLegs = 0) {
  const waypoints = sequence.map(idx => payload[idx]);
  const geos      = await fetchRouteLegs(waypoints);
  clearFutureLegs(completedLegs);
  routeLegs = routeLegs.slice(0, completedLegs);
  geos.forEach((geo, i) => {
    const leg = {
      coords:      geo.coords,
      distance:    geo.distance,
      duration:    geo.duration,
      trafficSegs: buildSubSegments(geo.coords),
      subSegments: [],
      completed:   false
    };
    drawRouteLeg(leg, false);
    routeLegs.push(leg);
  });
}



/** Save current future legs as ghost lines, then fade them out after delay */
function ghostifyFutureLegs(fromLeg) {
  clearGhost();
  for (let i = fromLeg; i < routeLegs.length; i++) {
    const leg = routeLegs[i];
    const coords = leg.coords;
    if (!coords || coords.length < 2) continue;
    const poly = L.polyline(coords, { color:'#FF9800', weight:3, opacity:0.4, dashArray:'5,7' }).addTo(map);
    ghostPolylines.push(poly);
  }
  // Fade out ghost after 4 seconds
  setTimeout(() => {
    ghostPolylines.forEach(p => {
      let op = 0.4;
      const iv = setInterval(() => {
        op -= 0.05;
        if (op <= 0) { try { map.removeLayer(p); } catch(e){} clearInterval(iv); }
        else { try { p.setStyle({ opacity: op }); } catch(e){ clearInterval(iv); } }
      }, 150);
    });
  }, 2000);
}

// ============================================================
// 12. TIMELINE (complete node-state machine)
// ============================================================
/**
 * State for each timeline node:
 *  'pending'     – grey, not yet visited
 *  'active'      – pulsing, truck is travelling here
 *  'delivered'   – green checkmark
 *  'warehouse'   – dark house icon (start / return)
 */
function buildTimeline(sequence, payload) {
  timelineSection.style.display = 'block';
  routeTimeline.innerHTML = '';
  sequence.forEach((idx, step) => {
    const loc   = payload[idx];
    const isHub = step === 0 || step === sequence.length - 1;
    const label = step === 0 ? 'START' : step === sequence.length - 1 ? 'RETURN' : `STOP ${step}`;
    const node  = document.createElement('div');
    node.className = 'timeline-node';
    node.id        = `tl-node-${step}`;
    node.innerHTML = `
      <div class="timeline-dot" id="tl-dot-${step}">${isHub ? STORE_SVG : PKG_SVG}</div>
      <div class="timeline-label" id="tl-label-${step}">${loc.name}</div>
      <div class="timeline-sub" id="tl-sub-${step}">${label}</div>`;
    routeTimeline.appendChild(node);
  });
}

/** Update a single timeline node's state without re-rendering the whole list */
function setTimelineState(step, state, seqLen) {
  const node  = document.getElementById(`tl-node-${step}`);
  const dot   = document.getElementById(`tl-dot-${step}`);
  const label = document.getElementById(`tl-label-${step}`);
  if (!node || !dot) return;

  // Remove all state classes first
  node.classList.remove('tl-pending','tl-active','tl-delivered','tl-hub');
  dot.classList.remove('tl-pending','tl-active','tl-delivered','tl-hub');

  const isHub = step === 0 || step === seqLen - 1;

  switch(state) {
    case 'active':
      node.classList.add('tl-active');
      dot.classList.add('tl-active');
      dot.innerHTML = isHub ? STORE_SVG : PKG_SVG;
      node.scrollIntoView({ behavior:'smooth', block:'nearest', inline:'center' });
      break;
    case 'delivered':
      node.classList.add('tl-delivered');
      dot.classList.add('tl-delivered');
      dot.innerHTML = isHub ? STORE_SVG : CHECK_SVG;
      break;
    case 'hub':
      node.classList.add('tl-hub');
      dot.classList.add('tl-hub');
      dot.innerHTML = STORE_SVG;
      break;
    default: // pending
      node.classList.add('tl-pending');
      dot.classList.add('tl-pending');
      dot.innerHTML = isHub ? STORE_SVG : PKG_SVG;
  }
}

function initTimelineStates(sequence) {
  sequence.forEach((_, step) => {
    const isHub = step === 0 || step === sequence.length - 1;
    setTimelineState(step, isHub ? 'hub' : 'pending', sequence.length);
  });
}

// ============================================================
// 13. STATS PANEL
// ============================================================
function totalRouteStats() {
  let km = 0, mins = 0;
  routeLegs.forEach(leg => { km += leg.distance/1000; mins += trafficMins(leg); });
  return { km, mins };
}

/** Render stats during / after simulation */
function renderStats(travelledKm, travelledMins, completed = false) {
  const { km: totalKm, mins: totalMins } = totalRouteStats();
  const pct = totalKm > 0 ? Math.min(100, (travelledKm / totalKm) * 100) : 0;

  const el = document.getElementById('route-stats');
  if (!el) return;
  el.style.display = 'flex';

  if (completed) {
    const avgSpeed = travelledMins > 0 ? (travelledKm / (travelledMins / 60)).toFixed(1) : 0;
    el.innerHTML = `
      <div class="stats-complete">
        <div class="stats-complete-title">${CHECK_SVG}&nbsp;Trip Complete</div>
        <div class="stats-row">
          <span class="stat-item"><b>${travelledKm.toFixed(1)} km</b><span>Actual Distance</span></span>
          <span class="stat-item"><b>${Math.ceil(travelledMins)} min</b><span>Actual Time</span></span>
          <span class="stat-item"><b>${avgSpeed} km/h</b><span>Avg Speed</span></span>
        </div>
        ${originalRouteKm > 0 ? `<div class="stats-row stats-comparison">
          <span class="stat-item"><b>${originalRouteKm.toFixed(1)} km</b><span>Optimal Route</span></span>
          <span class="stat-item"><b>~${Math.ceil(originalRouteMins)} min</b><span>Optimal Time</span></span>
          <span class="stat-item" style="color:${travelledKm > originalRouteKm ? '#E53935' : '#2e7d32'};"><b>+${Math.max(0, (travelledKm - originalRouteKm)).toFixed(1)} km</b><span>Traffic Overhead</span></span>
        </div>` : ''}
      </div>`;
  } else {
    el.innerHTML = `
      <div class="stats-live">
        <div class="stats-progress-row">
          <div class="stats-progress-bar"><div class="stats-progress-fill" style="width:${pct.toFixed(1)}%"></div></div>
          <span class="stats-pct">${Math.round(pct)}%</span>
        </div>
        <div class="stats-row">
          <span class="stat-item"><b id="dyn-dist">${travelledKm.toFixed(1)}</b>&thinsp;/&thinsp;${totalKm.toFixed(1)} km<span>Distance</span></span>
          <span class="stat-item"><b id="dyn-time">${Math.ceil(travelledMins)}</b>&thinsp;/&thinsp;${Math.ceil(totalMins)} min<span>Est. Time</span></span>
        </div>
      </div>`;
  }
}

/** Initial stats panel after route compute (before simulation) */
function renderInitialStats() {
  const el = document.getElementById('route-stats');
  if (!el) return;
  const { km, mins } = totalRouteStats();
  el.style.display = 'flex';
  el.innerHTML = `
    <div class="stats-initial">
      <div class="stats-row">
        <span class="stat-item"><b>${km.toFixed(1)} km</b><span>Total Route</span></span>
        <span class="stat-item"><b>~${Math.ceil(mins)} min</b><span>Est. Time</span></span>
        <span class="stat-item"><b>${selectedParcels.size}</b><span>Stops</span></span>
      </div>
      <div class="tsp-note">Route optimised via TSP Dynamic Programming · ${selectedParcels.size + 1} nodes</div>
    </div>`;
}

// ============================================================
// 14. GENERATE OPTIMAL ROUTE
// ============================================================
async function generateOptimalRoute(payload) {
  loadingOverlay.classList.remove('hidden');
  calcBtn.disabled = true;
  simBtn.disabled  = false;
  simBtn.innerText = 'Start Delivery Simulator';

  try {
    const resp = await fetch('/api/calculate-tsp', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ locations: payload, simulateTraffic: false, startIndex: 0, visitedMask: 0 })
    });
    if (!resp.ok) throw new Error(`Server error ${resp.status}`);
    const result = await resp.json();
    lastTspResult = result;

    let seq = result.sequence;
    // Ensure clean path ending at index 0, no duplicates
    while (seq.length > 2 && seq[seq.length-1] === 0 && seq[seq.length-2] === 0) seq.pop();
    if (seq[seq.length-1] !== 0) seq.push(0);
    currentFullSequence = seq;

    // New traffic seed each session
    trafficSeed = Math.floor(Math.random() * 999983);

    // Draw full route with traffic colouring
    await drawFullRoute(seq, payload);

    // Build timeline
    buildTimeline(seq, payload);
    initTimelineStates(seq);

    // Stats panel
    const initStats = totalRouteStats();
    originalRouteKm   = initStats.km;
    originalRouteMins = initStats.mins;
    renderInitialStats();

    routeResult.classList.remove('hidden');
    simControls.classList.remove('hidden');

    // Fit map to route
    const allCoords = routeLegs.flatMap(l => l.coords);
    if (allCoords.length) map.fitBounds(L.latLngBounds(allCoords), { padding:[30,30], maxZoom:13 });

  } catch(e) {
    console.error(e);
    alert('Error computing route. Is the server running? Check console.');
  } finally {
    loadingOverlay.classList.add('hidden');
    calcBtn.disabled = false;
  }
}

// ============================================================
// 15. TRUCK ANIMATION  (traffic-aware speed)
// ============================================================
async function animateLeg(legIdx, speedFactor, distSoFarKm, timeSoFarMins) {
  return new Promise(resolve => {
    const leg = routeLegs[legIdx];
    if (!leg || leg.coords.length < 2 || !deliveryCursor) { resolve(); return; }

    const coords = leg.coords;
    const subs   = leg.subSegments || [];

    // Per-coord-pair real distance (metres)
    const segDists = [];
    let totalRealM = 0;
    for (let i=0; i<coords.length-1; i++) {
      const d = haversineM(coords[i][0],coords[i][1],coords[i+1][0],coords[i+1][1]);
      segDists.push(d);
      totalRealM += d;
    }
    if (totalRealM === 0) { deliveryCursor.setLatLng(coords[coords.length-1]); resolve(); return; }

    // Map each coord index → sub-segment index
    const coordToSeg = new Uint8Array(coords.length);
    subs.forEach((s, si) => { for (let j=s.si; j<=s.ei && j<coords.length; j++) coordToSeg[j]=si; });

    // Cumulative real distance array (for accurate km display)
    const cumReal = [0];
    let runReal = 0;
    for (let i=0; i<coords.length-1; i++) { runReal += segDists[i]; cumReal.push(runReal); }

    // Cumulative TIME-WEIGHTED distance (traffic mult applied) → makes truck slow on red/yellow
    const cumTw = [0];
    let runTw = 0;
    for (let i=0; i<coords.length-1; i++) {
      const si   = coordToSeg[i];
      const mult = subs[si] ? subs[si].mult : 1;
      runTw += segDists[i] * mult;
      cumTw.push(runTw);
    }
    const totalTw   = runTw;
    const legKm     = leg.distance / 1000;
    const legMins   = trafficMins(leg);

    // Animation duration ~1.2 s/km base, clamped, scaled by speed
    const animDur = Math.max(1200, Math.min(7000, legKm * 1200)) / speedFactor;

    let lastGreyed = -1;
    const t0 = performance.now();

    function step(now) {
      if (!simRunning) { resolve(); return; }
      const progress = Math.min((now - t0) / animDur, 1);
      const targetTw = progress * totalTw;

      // Binary search in cumTw
      let lo=0, hi=cumTw.length-1;
      while (lo < hi-1) { const m=(lo+hi)>>1; cumTw[m]<=targetTw ? lo=m : hi=m; }
      const twSeg = cumTw[hi]-cumTw[lo];
      const frac  = twSeg>0 ? (targetTw-cumTw[lo])/twSeg : 0;

      // Move truck
      const lat = coords[lo][0] + (coords[hi][0]-coords[lo][0])*frac;
      const lng = coords[lo][1] + (coords[hi][1]-coords[lo][1])*frac;
      deliveryCursor.setLatLng([lat, lng]);

      // Grey passed sub-segments
      const curSeg = coordToSeg[lo];
      if (curSeg > lastGreyed) {
        for (let s = lastGreyed+1; s < curSeg; s++) {
          if (subs[s]?.polyline)
            subs[s].polyline.setStyle({ color: greyOf(subs[s].color), opacity:0.85, weight:5, dashArray:'8,8' });
        }
        lastGreyed = curSeg - 1;
      }

      // Live stats: interpolate REAL distance/time (accurate numbers)
      const realOnLeg = cumReal[lo] + (cumReal[hi]-cumReal[lo])*frac;
      const scaledKm  = (realOnLeg/totalRealM) * legKm;   // scaled to OSRM distance
      const nowKm     = distSoFarKm  + scaledKm;
      const nowMins   = timeSoFarMins + progress * legMins;

      const dEl = document.getElementById('dyn-dist');
      const tEl = document.getElementById('dyn-time');
      if (dEl) dEl.innerText = nowKm.toFixed(1);
      if (tEl) tEl.innerText = Math.ceil(nowMins);

      if (progress < 1) { currentAnimFrame = requestAnimationFrame(step); }
      else {
        subs.forEach(s => {
          if (s?.polyline) s.polyline.setStyle({ color: greyOf(s.color), opacity:0.85, weight:5, dashArray:'8,8' });
        });
        leg.completed = true;
        currentAnimFrame = null;
        resolve();
      }
    }
    currentAnimFrame = requestAnimationFrame(step);
  });
}

// ============================================================
// 16. RECALCULATE ROUTE  (dynamic rerouting)
// ============================================================
async function recalcRoute(payload, currentPath, completedLegs) {
  const curNode = currentPath[completedLegs];
  let visited = 0;
  for (let k=0; k<=completedLegs; k++) visited |= (1<<currentPath[k]);

  try {
    const resp = await fetch('/api/calculate-tsp', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({
        locations: payload, simulateTraffic: true,
        startIndex: curNode, visitedMask: visited,
        trafficSeed
      })
    });
    if (!resp.ok) throw new Error('Server error');
    const result = await resp.json();

    let newRem = result.sequence.slice(1);
    if (!newRem.length || newRem[newRem.length-1] !== 0) newRem.push(0);
    while (newRem.length>1 && newRem[newRem.length-1]===0 && newRem[newRem.length-2]===0) newRem.pop();

    const oldRem  = currentPath.slice(completedLegs+1);
    const changed = JSON.stringify(newRem) !== JSON.stringify(oldRem);
    const newPath = currentPath.slice(0, completedLegs+1).concat(newRem);
    return { newPath, changed };
  } catch(e) {
    console.warn('Recalc failed:', e);
    return { newPath: currentPath, changed: false };
  }
}

// ============================================================
// 17. SIMULATION
// ============================================================
async function startSimulation() {
  if (!routeLegs.length) return;

  simBtn.disabled  = true;
  simBtn.innerText = 'Simulating...';
  simRunning       = true;

  const payload      = originalPayload.slice();
  let   currentPath  = [...currentFullSequence];
  const totalDrops   = currentPath.length - 2;  // excluding hub start/return
  let   completedLegs= 0;
  let   rerouteCount = 0;
  let   distKm       = 0;
  let   timeMins     = 0;

  // Truck marker at starting hub
  const startLoc = payload[currentPath[0]];
  deliveryCursor = L.marker([startLoc.lat, startLoc.lng], {
    icon: makeIcon('#1976D2', TRUCK_SVG, 38), zIndexOffset:1000
  }).addTo(map);

  // Initial timeline state: hub=hub, rest=pending, first dest = active
  initTimelineStates(currentPath);
  setTimelineState(0, 'hub', currentPath.length);
  if (currentPath.length > 1) setTimelineState(1, 'active', currentPath.length);

  // Initial live stats
  renderStats(0, 0);

  while (completedLegs < currentPath.length - 1 && simRunning) {
    const isReturn = completedLegs === currentPath.length - 2;
    const speed    = parseInt(simSpeedSel.value) || 1;
    const destStep = completedLegs + 1;
    const destLoc  = payload[currentPath[destStep]];

    simStatus.innerText = isReturn
      ? 'Returning to warehouse...'
      : `Leg ${completedLegs+1}/${currentPath.length-1} — heading to ${destLoc.name}`;
    simStatus.style.color = '#1976D2';

    await animateLeg(completedLegs, speed, distKm, timeMins);
    if (!simRunning) break;

    // Accumulate real distance & time
    const legInfo  = routeLegs[completedLegs];
    distKm        += legInfo.distance / 1000;
    timeMins      += trafficMins(legInfo);
    completedLegs++;

    // Update timeline: previous node → delivered, next → active
    setTimelineState(completedLegs - 1, completedLegs - 1 === 0 ? 'hub' : 'delivered', currentPath.length);
    const nextStep = completedLegs;
    if (nextStep < currentPath.length) {
      const nextIsHub = nextStep === currentPath.length - 1;
      setTimelineState(nextStep, nextIsHub ? 'hub' : 'active', currentPath.length);
    }

    // Update map markers
    markers.forEach(m => m.marker && map.removeLayer(m.marker));
    markers = [];
    payload.forEach((loc, pIdx) => {
      const isW       = pIdx === 0;
      let markerState = 'pending';
      if (isW) {
        markerState = 'warehouse';
      } else {
        // Check all visited stops up to completedLegs
        for (let k=1; k<currentPath.length; k++) {
          if (currentPath[k] === pIdx) {
            if (k < completedLegs) {
              markerState = 'delivered';
            } else if (k === completedLegs) {
              // This is the stop we just arrived at
              markerState = 'delivered';
            } else if (k === completedLegs + 1 && completedLegs < currentPath.length - 1) {
              // Next stop — show as traveling-to
              markerState = 'traveling-to';
            }
            break;
          }
        }
      }
      drawPin(loc, isW, markerState === 'delivered', markerState);
    });

    // Pause at delivery point
    if (!isReturn && simRunning) {
      simStatus.innerHTML = `${STATUS_DELIVERED} Delivered to ${destLoc.name}`;
      simStatus.style.color = '#2e7d32';
      await delay(2000 / speed);
      // Close any open popups
      map.closePopup();

      // Dynamic rerouting
      const remaining = (currentPath.length - 1) - completedLegs - 1;
      if (remaining > 0 && dynRerouteCheck.checked) {
        simStatus.innerText = 'Checking traffic conditions…';
        simStatus.style.color = '#999';
        await delay(500 / speed);

        // Evolve traffic seed so backend sees NEW traffic conditions each check
        trafficSeed = Math.floor(trafficSeed * 31 + completedLegs * 997 + Date.now() % 100003) % 999983;

        const { newPath, changed } = await recalcRoute(payload, currentPath, completedLegs);
        if (changed) {
          rerouteCount++;
          // Ghostify the old future legs before replacing them
          ghostifyFutureLegs(completedLegs);

          currentPath              = newPath;
          currentFullSequence      = newPath;
          simStatus.innerHTML      = `${STATUS_WARNING} Traffic detected — route re-optimised! (reroute #${rerouteCount})`;
          simStatus.style.color    = '#E53935';

          // Fetch new geo for future legs
          const futWps  = currentPath.slice(completedLegs).map(idx => payload[idx]);
          const newGeos = await fetchRouteLegs(futWps);
          clearFutureLegs(completedLegs);
          routeLegs = routeLegs.slice(0, completedLegs);
          newGeos.forEach((geo, i) => {
            const leg = { coords:geo.coords, distance:geo.distance, duration:geo.duration,
                          trafficSegs: buildSubSegments(geo.coords), subSegments:[], completed:false };
            drawRouteLeg(leg, false);
            routeLegs.push(leg);
          });
          // Rebuild timeline from current state
          buildTimeline(currentPath, payload);
          initTimelineStates(currentPath);
          for (let k=0; k<=completedLegs; k++)
            setTimelineState(k, k===0 ? 'hub' : 'delivered', currentPath.length);
          if (completedLegs < currentPath.length)
            setTimelineState(completedLegs, 'active', currentPath.length);

          renderStats(distKm, timeMins);
        } else {
          simStatus.innerHTML   = `${STATUS_CHECK} Route optimal — no change needed.`;
          simStatus.style.color = '#4CAF50';
        }
        await delay(600 / speed);
      }
    }

    // Update live progress stats every leg
    if (simRunning) renderStats(distKm, timeMins);
  }

  // ── Simulation complete ──
  simRunning       = false;
  simBtn.disabled  = false;
  simBtn.innerText = 'Simulation Complete';

  if (deliveryCursor) { map.removeLayer(deliveryCursor); deliveryCursor = null; }
  const rerouteMsg = rerouteCount > 0 ? ` (${rerouteCount} reroute${rerouteCount > 1 ? 's' : ''} applied)` : '';
  simStatus.innerHTML   = `${STATUS_COMPLETE} All ${totalDrops} deliveries completed. Back at warehouse.${rerouteMsg}`;
  simStatus.style.color = '#2e7d32';

  // Mark all nodes delivered / hub
  currentPath.forEach((_, step) => {
    const isHub = step === 0 || step === currentPath.length-1;
    setTimelineState(step, isHub ? 'hub' : 'delivered', currentPath.length);
  });

  // Final trip summary
  renderStats(distKm, timeMins, true);
}

// ============================================================
// 18. EVENTS
// ============================================================
function setupEvents() {
  warehouseSelect.addEventListener('change', e => {
    const warehouseMap = { W1:'P1', W2:'P2', W3:'P3', W4:'P4', W5:'P5' };
    startingWarehouseId = warehouseMap[e.target.value];
    redrawMarkers();
  });

  calcBtn.addEventListener('click', () => {
    if (!startingWarehouseId)       return alert('Select a starting warehouse first.');
    if (!selectedParcels.size)      return alert('Select at least 1 parcel to deliver.');
    const payload = [startingWarehouseId, ...Array.from(selectedParcels)]
                      .map(id => mockLocations.find(l => l.id === id));
    originalPayload = payload;
    generateOptimalRoute(payload);
  });

  simBtn.addEventListener('click', () => {
    if (simRunning) return;
    startSimulation();
  });
}

// ============================================================
// 19. INIT
// ============================================================
window.onload = () => { initMap(); renderInventory(); setupEvents(); };
