import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import { apiRequest } from '../lib/api.ts';
import {
  CATEGORIES,
  CampusLocationConfig,
  CampusLocationName,
  ComplaintRecord,
  LOCATIONS,
} from '../shared/campus.ts';

interface HeatmapApiLocation extends CampusLocationConfig {
  id: number;
}

interface CampusHeatmapViewProps {
  token: string;
  initialLocationScope: 'campus' | CampusLocationName;
  onViewPhoto: (imageUrl: string) => void;
}

interface HeatPoint {
  lat: number;
  lng: number;
  count: number;
}

function deterministicSubOffset(text: string, radiusMeters: number) {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  }
  const angle = ((hash % 360) * Math.PI) / 180;
  const dist = Math.max(12, radiusMeters * 0.65) * (0.15 + ((hash % 65) / 100) * 0.55);
  return {
    dLat: (dist * Math.sin(angle)) / 111320,
    dLng: (dist * Math.cos(angle)) / (111320 * Math.cos((18.882 * Math.PI) / 180)),
  };
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function escapeHtml(str: string): string {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Build 256-entry RGBA lookup table matching the legend gradient:
// #3b82f6 (0%) -> #06b6d4 (28%) -> #22c55e (52%) -> #f59e0b (76%) -> #dc2626 (100%)
function buildHeatmapPalette(): Uint8ClampedArray {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 1;
  const ctx = canvas.getContext('2d');
  if (!ctx) return new Uint8ClampedArray(256 * 4);
  const grad = ctx.createLinearGradient(0, 0, 256, 0);
  grad.addColorStop(0.0, '#3b82f6');
  grad.addColorStop(0.28, '#06b6d4');
  grad.addColorStop(0.52, '#22c55e');
  grad.addColorStop(0.76, '#f59e0b');
  grad.addColorStop(1.0, '#dc2626');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 256, 1);
  return ctx.getImageData(0, 0, 256, 1).data;
}

class CanvasHeatmapLayer extends L.Layer {
  private mapRef: L.Map | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private points: HeatPoint[] = [];
  private maxVal = 3;
  private radiusPx = 56;
  private palette: Uint8ClampedArray | null = null;

  setData(maxVal: number, points: HeatPoint[], radiusPx = 56) {
    this.maxVal = Math.max(1, maxVal);
    this.points = points;
    this.radiusPx = radiusPx;
    this.redraw();
  }

  onAdd(map: L.Map): this {
    this.mapRef = map;
    if (!this.palette) {
      this.palette = buildHeatmapPalette();
    }
    const canvas = document.createElement('canvas');
    canvas.style.position = 'absolute';
    canvas.style.top = '0';
    canvas.style.left = '0';
    canvas.style.pointerEvents = 'none';
    this.canvas = canvas;
    map.getPanes().overlayPane.appendChild(canvas);

    map.on('moveend zoomend viewreset resize', this.redraw, this);
    this.redraw();
    return this;
  }

  onRemove(map: L.Map): this {
    map.off('moveend zoomend viewreset resize', this.redraw, this);
    if (this.canvas && this.canvas.parentNode) {
      this.canvas.parentNode.removeChild(this.canvas);
    }
    this.canvas = null;
    this.mapRef = null;
    return this;
  }

  private redraw = () => {
    const map = this.mapRef;
    const canvas = this.canvas;
    if (!map || !canvas) return;

    const size = map.getSize();
    const topLeft = map.containerPointToLayerPoint([0, 0]);
    L.DomUtil.setPosition(canvas, topLeft);

    canvas.width = size.x;
    canvas.height = size.y;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, size.x, size.y);

    if (this.points.length === 0 || !this.palette) return;

    const r = this.radiusPx;
    for (const pt of this.points) {
      const p = map.latLngToContainerPoint([pt.lat, pt.lng]);
      const alpha = Math.min(1, Math.max(0.18, pt.count / this.maxVal));
      const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
      grad.addColorStop(0, `rgba(0, 0, 0, ${alpha})`);
      grad.addColorStop(0.5, `rgba(0, 0, 0, ${alpha * 0.55})`);
      grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fill();
    }

    const img = ctx.getImageData(0, 0, size.x, size.y);
    const data = img.data;
    const pal = this.palette;
    for (let i = 0; i < data.length; i += 4) {
      const a = data[i + 3];
      if (a > 0) {
        const idx = a * 4;
        data[i] = pal[idx];
        data[i + 1] = pal[idx + 1];
        data[i + 2] = pal[idx + 2];
        data[i + 3] = Math.min(205, Math.round(a * 0.85));
      }
    }
    ctx.putImageData(img, 0, 0);
  };
}

export function CampusHeatmapView({
  token,
  initialLocationScope,
  onViewPhoto,
}: CampusHeatmapViewProps) {
  const [mapLocScope, setMapLocScope] = useState<'campus' | CampusLocationName>(
    initialLocationScope
  );
  const [inspectorLoc, setInspectorLoc] = useState<CampusLocationName>(
    initialLocationScope === 'campus' ? 'Boys Hostel Complex' : initialLocationScope
  );
  const [mapCategory, setMapCategory] = useState<string>('All');
  const [mapScope, setMapScope] = useState<'all' | 'active'>('all');

  const [locations, setLocations] = useState<HeatmapApiLocation[]>([]);
  const [complaints, setComplaints] = useState<ComplaintRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const leafletMapRef = useRef<L.Map | null>(null);
  const heatLayerRef = useRef<CanvasHeatmapLayer | null>(null);
  const overlayLayerRef = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    setMapLocScope(initialLocationScope);
    if (initialLocationScope !== 'campus') {
      setInspectorLoc(initialLocationScope);
    }
  }, [initialLocationScope]);

  const fetchHeatmapData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        category: mapCategory,
        scope: mapScope,
      });
      const res = await apiRequest<{
        locations: HeatmapApiLocation[];
        complaints: ComplaintRecord[];
      }>(`/api/admin/heatmap?${params.toString()}`, { token });
      setLocations(res.locations);
      setComplaints(res.complaints);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load heatmap data.');
    } finally {
      setLoading(false);
    }
  }, [token, mapCategory, mapScope]);

  useEffect(() => {
    fetchHeatmapData();
  }, [fetchHeatmapData]);

  // Initialize Leaflet map once
  useEffect(() => {
    const container = mapContainerRef.current;
    if (!container || leafletMapRef.current) return;

    const map = L.map(container, { center: [18.882, 77.9208], zoom: 17 });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap · RGUKT Basar',
      maxZoom: 19,
    }).addTo(map);

    const heatLayer = new CanvasHeatmapLayer();
    heatLayer.addTo(map);

    const overlay = L.layerGroup().addTo(map);

    leafletMapRef.current = map;
    heatLayerRef.current = heatLayer;
    overlayLayerRef.current = overlay;

    const timer = setTimeout(() => map.invalidateSize(), 80);

    return () => {
      clearTimeout(timer);
      map.remove();
      leafletMapRef.current = null;
      heatLayerRef.current = null;
      overlayLayerRef.current = null;
    };
  }, []);

  const locationMap = useMemo(() => {
    const record: Record<string, HeatmapApiLocation> = {};
    for (const loc of locations) {
      record[loc.name] = loc;
    }
    return record;
  }, [locations]);

  const locFiltered = useMemo(() => {
    return mapLocScope === 'campus'
      ? complaints
      : complaints.filter((c) => c.location === mapLocScope);
  }, [complaints, mapLocScope]);

  // Update Leaflet markers & heatmap layer whenever data/scope changes
  useEffect(() => {
    const map = leafletMapRef.current;
    const heatLayer = heatLayerRef.current;
    const overlayLayer = overlayLayerRef.current;
    if (!map || !heatLayer || !overlayLayer || locations.length === 0) return;

    overlayLayer.clearLayers();
    const heatPoints: HeatPoint[] = [];
    const maxCount = Math.max(
      ...LOCATIONS.map((l) => complaints.filter((c) => c.location === l).length),
      1
    );

    if (mapLocScope === 'campus') {
      const boundsCoords: [number, number][] = [];
      LOCATIONS.forEach((locName) => {
        const coord = locationMap[locName];
        if (!coord) return;
        boundsCoords.push([coord.lat, coord.lng]);
        const count = complaints.filter((c) => c.location === locName).length;
        if (count > 0) {
          heatPoints.push({ lat: coord.lat, lng: coord.lng, count });
        }

        const ratio = count / maxCount;
        const fill =
          count === 0
            ? '#94a3b8'
            : ratio >= 0.78 || count >= 4
            ? '#dc2626'
            : ratio >= 0.55 || count === 3
            ? '#ea580c'
            : ratio >= 0.3 || count === 2
            ? '#f59e0b'
            : '#3b82f6';

        L.circle([coord.lat, coord.lng], {
          radius: coord.radiusMeters,
          color: fill,
          weight: 1,
          dashArray: '4 4',
          fillColor: fill,
          fillOpacity: 0.08,
        }).addTo(overlayLayer);

        const marker = L.circleMarker([coord.lat, coord.lng], {
          radius: 11 + Math.min(count * 3, 14),
          color: '#fff',
          weight: 2,
          fillColor: fill,
          fillOpacity: 0.9,
        });
        marker.bindTooltip(
          `<strong>${escapeHtml(locName)}</strong><br/>${count} real complaint(s)`
        );
        marker.on('click', () => {
          setMapLocScope(locName);
          setInspectorLoc(locName);
        });
        marker.addTo(overlayLayer);
      });

      if (boundsCoords.length > 0) {
        map.fitBounds(L.latLngBounds(boundsCoords), { padding: [55, 55], maxZoom: 17 });
      }
      heatLayer.setData(Math.max(maxCount, 3), heatPoints, 58);
    } else {
      const coord = locationMap[mapLocScope];
      if (coord) {
        L.circle([coord.lat, coord.lng], {
          radius: coord.radiusMeters,
          color: '#1d4ed8',
          weight: 2,
          dashArray: '5 4',
          fillColor: '#2563eb',
          fillOpacity: 0.1,
        }).addTo(overlayLayer);

        locFiltered.forEach((c) => {
          const off = deterministicSubOffset(
            `${c.buildingBlock}|${c.floorRoom}|${c.complaintCode}`,
            coord.radiusMeters
          );
          const pt = { lat: coord.lat + off.dLat, lng: coord.lng + off.dLng, count: 1 };
          heatPoints.push(pt);
          const pinColor =
            c.status === 'Resolved'
              ? '#16a34a'
              : c.status === 'In Progress'
              ? '#2563eb'
              : '#dc2626';
          L.circleMarker([pt.lat, pt.lng], {
            radius: 7,
            color: '#fff',
            weight: 2,
            fillColor: pinColor,
            fillOpacity: 0.92,
          })
            .bindTooltip(
              `<strong>${escapeHtml(c.complaintCode)}</strong> · ${escapeHtml(
                c.buildingBlock
              )}<br/>${escapeHtml(c.floorRoom)} · ${escapeHtml(c.title)}`
            )
            .addTo(overlayLayer);
        });

        map.setView([coord.lat, coord.lng], 18, { animate: true });
      }
      heatLayer.setData(3, heatPoints, 46);
    }
  }, [locations, locationMap, complaints, locFiltered, mapLocScope]);

  const activeLoc: CampusLocationName =
    mapLocScope === 'campus' ? inspectorLoc : mapLocScope;
  const activeCoord = locationMap[activeLoc];
  const inspectorItems = useMemo(
    () => complaints.filter((c) => c.location === activeLoc),
    [complaints, activeLoc]
  );

  // Building / floor breakdown for inspected location
  const buildingFloorSummary = useMemo(() => {
    const counts = new Map<string, { building: string; floor: string; count: number }>();
    for (const c of inspectorItems) {
      const key = `${c.buildingBlock}||${c.floorRoom}`;
      const existing = counts.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        counts.set(key, {
          building: c.buildingBlock,
          floor: c.floorRoom,
          count: 1,
        });
      }
    }
    return Array.from(counts.values()).sort((a, b) => b.count - a.count);
  }, [inspectorItems]);

  function handleSelectLocationScope(val: 'campus' | CampusLocationName) {
    setMapLocScope(val);
    if (val !== 'campus') {
      setInspectorLoc(val);
    }
  }

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3.5 rounded-xl border border-slate-200 bg-white px-4 py-3.5">
        <div className="flex flex-wrap items-center gap-2.5">
          <select
            value={mapLocScope}
            onChange={(e) =>
              handleSelectLocationScope(e.target.value as 'campus' | CampusLocationName)
            }
            className="w-auto rounded-lg border border-slate-300 bg-white px-3 py-2 text-[13px] text-slate-900"
          >
            <option value="campus">Complete RGUKT Basar Campus Heatmap</option>
            {LOCATIONS.map((l) => (
              <option key={l} value={l}>
                Location Heatmap: {l}
              </option>
            ))}
          </select>

          {mapLocScope !== 'campus' && (
            <button
              type="button"
              onClick={() => handleSelectLocationScope('campus')}
              className="cursor-pointer rounded-lg border border-blue-200 bg-blue-50 px-3.5 py-2 text-xs font-semibold text-blue-700 hover:bg-blue-100"
            >
              ← Return to Complete Campus Heatmap
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <div className="inline-flex flex-wrap gap-1 rounded-lg bg-slate-100 p-1">
            {['All', ...CATEGORIES].map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setMapCategory(c)}
                className={`cursor-pointer rounded-md px-3 py-1.5 text-xs font-semibold ${
                  mapCategory === c
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {c}
              </button>
            ))}
          </div>

          <div className="inline-flex gap-1 rounded-lg bg-slate-100 p-1">
            <button
              type="button"
              onClick={() => setMapScope('all')}
              className={`cursor-pointer rounded-md px-3 py-1.5 text-xs font-semibold ${
                mapScope === 'all'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              All
            </button>
            <button
              type="button"
              onClick={() => setMapScope('active')}
              className={`cursor-pointer rounded-md px-3 py-1.5 text-xs font-semibold ${
                mapScope === 'active'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Unresolved
            </button>
          </div>

          <button
            type="button"
            onClick={fetchHeatmapData}
            disabled={loading}
            className="cursor-pointer rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            {loading ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs font-medium text-red-700">
          {error}
        </div>
      )}

      <div className="grid grid-cols-12 gap-5">
        <div className="col-span-12 overflow-hidden rounded-xl border border-slate-200 bg-white lg:col-span-7">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-3.5">
            <div>
              <div className="text-[15px] font-semibold text-slate-900">
                {mapLocScope === 'campus'
                  ? 'RGUKT Basar — Complete Campus Heatmap'
                  : `RGUKT Basar — ${mapLocScope} Heatmap`}
              </div>
              <div className="mt-0.5 text-xs text-slate-500">
                OpenStreetMap Basar, Nirmal, Telangana (18.8820°N, 77.9208°E) · Real student
                complaints only (demo records excluded)
              </div>
            </div>
            <div className="mono text-xs text-slate-600">{locFiltered.length} records</div>
          </div>

          <div ref={mapContainerRef} className="h-[500px] w-full bg-slate-200" />

          <div className="flex flex-col gap-2.5 border-t border-slate-200 bg-slate-50 px-5 py-3.5">
            <div className="flex flex-wrap items-center gap-2.5">
              <span className="text-xs font-semibold text-slate-800">Intensity Legend</span>
              <span className="text-[11px] text-slate-500">Low</span>
              <div className="gradient-scale" />
              <span className="text-[11px] text-slate-500">Critical</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => handleSelectLocationScope('campus')}
                className={`cursor-pointer rounded-lg border px-3 py-1.5 text-xs font-semibold ${
                  mapLocScope === 'campus'
                    ? 'border-blue-700 bg-blue-700 text-white'
                    : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-100'
                }`}
              >
                All Campus ({complaints.length})
              </button>
              {LOCATIONS.map((l) => {
                const count = complaints.filter((c) => c.location === l).length;
                return (
                  <button
                    key={l}
                    type="button"
                    onClick={() => handleSelectLocationScope(l)}
                    className={`cursor-pointer rounded-lg border px-3 py-1.5 text-xs font-semibold ${
                      mapLocScope === l
                        ? 'border-slate-900 bg-slate-900 text-white'
                        : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    {l} ({count})
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="col-span-12 overflow-hidden rounded-xl border border-slate-200 bg-white lg:col-span-5">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-3.5">
            <div>
              <div className="text-xs text-slate-500">
                Location Inspector · {activeCoord?.code || ''}
              </div>
              <div className="text-[17px] font-semibold text-slate-900">{activeLoc}</div>
              <div className="mt-0.5 text-xs text-slate-500">
                {activeCoord?.description || ''}
              </div>
            </div>
            <div className="mono text-[11px] text-slate-500">
              {activeCoord
                ? `${activeCoord.lat.toFixed(4)}, ${activeCoord.lng.toFixed(4)}`
                : ''}
            </div>
          </div>

          <div className="grid grid-cols-4 border-b border-slate-200 bg-slate-50">
            <div className="border-r border-slate-200 p-3 text-center">
              <div className="text-[11px] text-slate-500">Total</div>
              <div className="mono mt-0.5 text-xl font-bold text-slate-900">
                {inspectorItems.length}
              </div>
            </div>
            <div className="border-r border-slate-200 p-3 text-center">
              <div className="text-[11px] text-amber-700">Pending</div>
              <div className="mono mt-0.5 text-xl font-bold text-amber-700">
                {
                  inspectorItems.filter(
                    (c) => c.status === 'Reported' || c.status === 'Acknowledged'
                  ).length
                }
              </div>
            </div>
            <div className="border-r border-slate-200 p-3 text-center">
              <div className="text-[11px] text-blue-700">In Progress</div>
              <div className="mono mt-0.5 text-xl font-bold text-blue-700">
                {inspectorItems.filter((c) => c.status === 'In Progress').length}
              </div>
            </div>
            <div className="p-3 text-center">
              <div className="text-[11px] text-green-700">Resolved</div>
              <div className="mono mt-0.5 text-xl font-bold text-green-700">
                {inspectorItems.filter((c) => c.status === 'Resolved').length}
              </div>
            </div>
          </div>

          {buildingFloorSummary.length > 0 && (
            <div className="border-b border-slate-200 bg-slate-50/60 px-4 py-2.5">
              <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Building & Floor Breakdown
              </div>
              <div className="flex flex-wrap gap-1.5">
                {buildingFloorSummary.map((item) => (
                  <span
                    key={`${item.building}-${item.floor}`}
                    className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-0.5 text-[11px] text-slate-700"
                  >
                    <strong>{item.building}</strong> · {item.floor}
                    <span className="mono font-semibold text-blue-700">({item.count})</span>
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="max-h-[430px] overflow-y-auto">
            {inspectorItems.length === 0 ? (
              <div className="px-6 py-10 text-center text-[13px] text-slate-500">
                No real student complaints match the selected filter in {activeLoc}.
              </div>
            ) : (
              inspectorItems.map((c) => (
                <div key={c.id} className="border-b border-slate-100 px-4 py-3.5 last:border-b-0">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="text-[13px] font-semibold text-slate-900">{c.title}</div>
                      <div className="mt-0.5 text-xs text-slate-500">
                        <span className="mono">{c.complaintCode}</span> ·{' '}
                        <strong className="text-slate-700">{c.category}</strong> · {c.buildingBlock}{' '}
                        ({c.floorRoom})
                      </div>
                    </div>
                    <span className="shrink-0 text-xs font-semibold text-slate-800">{c.status}</span>
                  </div>
                  <p className="mt-1.5 text-xs text-slate-600">{c.description}</p>
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
                    <span>
                      {c.studentName} ({c.rollNumber}) · {formatDate(c.createdAt)}
                    </span>
                    <div className="flex items-center gap-3">
                      {c.imageUrl && (
                        <button
                          type="button"
                          onClick={() => onViewPhoto(c.imageUrl!)}
                          className="cursor-pointer font-semibold text-blue-700 hover:underline"
                        >
                          View Photo
                        </button>
                      )}
                      <a
                        href={`tel:${c.studentMobile}`}
                        className="mono font-semibold text-green-700 hover:underline"
                      >
                        Call {c.studentMobile}
                      </a>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
