import { useCallback, useEffect, useRef, useState } from 'react';
import Chart from 'chart.js/auto';
import { apiRequest } from '../lib/api.ts';
import {
  AnalyticsResponse,
  CampusLocationName,
  STATUSES,
} from '../shared/campus.ts';

interface AnalyticsViewProps {
  token: string;
  onOpenLocationHeatmap: (location: CampusLocationName) => void;
}

export function AnalyticsView({ token, onOpenLocationHeatmap }: AnalyticsViewProps) {
  const [data, setData] = useState<AnalyticsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const catCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const locCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const statusCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const chartsRef = useRef<Chart[]>([]);

  const loadAnalytics = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiRequest<AnalyticsResponse>('/api/admin/analytics', { token });
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load analytics.');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    loadAnalytics();
  }, [loadAnalytics]);

  useEffect(() => {
    chartsRef.current.forEach((ch) => ch.destroy());
    chartsRef.current = [];

    if (!data) return;

    if (catCanvasRef.current) {
      chartsRef.current.push(
        new Chart(catCanvasRef.current, {
          type: 'bar',
          data: {
            labels: data.byCategory.map((d) => d.category),
            datasets: [
              {
                data: data.byCategory.map((d) => d.count),
                backgroundColor: ['#2563eb', '#d97706', '#059669', '#4f46e5', '#475569'],
                borderRadius: 6,
              },
            ],
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } },
          },
        })
      );
    }

    if (locCanvasRef.current) {
      chartsRef.current.push(
        new Chart(locCanvasRef.current, {
          type: 'bar',
          data: {
            labels: data.byLocation.map((d) => d.location),
            datasets: [
              {
                label: 'Pending',
                data: data.byLocation.map((d) => d.reported + d.acknowledged),
                backgroundColor: '#f59e0b',
              },
              {
                label: 'In Progress',
                data: data.byLocation.map((d) => d.inProgress),
                backgroundColor: '#2563eb',
              },
              {
                label: 'Resolved',
                data: data.byLocation.map((d) => d.resolved),
                backgroundColor: '#16a34a',
              },
            ],
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
              x: { stacked: true },
              y: { stacked: true, beginAtZero: true, ticks: { stepSize: 1 } },
            },
            plugins: { legend: { position: 'bottom' } },
          },
        })
      );
    }

    if (statusCanvasRef.current) {
      chartsRef.current.push(
        new Chart(statusCanvasRef.current, {
          type: 'doughnut',
          data: {
            labels: [...STATUSES],
            datasets: [
              {
                data: [
                  data.byStatus.Reported,
                  data.byStatus.Acknowledged,
                  data.byStatus['In Progress'],
                  data.byStatus.Resolved,
                ],
                backgroundColor: ['#f59e0b', '#6366f1', '#2563eb', '#16a34a'],
              },
            ],
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '62%',
            plugins: { legend: { position: 'bottom' } },
          },
        })
      );
    }

    return () => {
      chartsRef.current.forEach((ch) => ch.destroy());
      chartsRef.current = [];
    };
  }, [data]);

  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs font-medium text-red-700">
        {error}
      </div>
    );
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="text-xs text-slate-500">
          Real student complaint statistics (demo sample records excluded)
        </div>
        <button
          type="button"
          onClick={loadAnalytics}
          disabled={loading}
          className="cursor-pointer rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
        >
          {loading ? 'Refreshing...' : 'Refresh Analytics'}
        </button>
      </div>

      <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white px-5 py-4.5">
          <div className="text-xs text-slate-500">Total Complaints</div>
          <div className="mono mt-1.5 text-2xl font-bold text-slate-900">
            {data?.total ?? 0}
          </div>
          <div className="mt-1 text-xs text-slate-500">
            {data ? `${data.pendingCount} pending · ${data.inProgressCount} active` : '—'}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white px-5 py-4.5">
          <div className="text-xs text-slate-500">Most Reported Category</div>
          <div className="mt-1.5 text-2xl font-bold text-slate-900">
            {data?.topCategory ? data.topCategory.category : '—'}
          </div>
          <div className="mt-1 text-xs text-slate-500">
            {data?.topCategory ? `${data.topCategory.count} reports` : 'No reports yet'}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white px-5 py-4.5">
          <div className="text-xs text-slate-500">Highest Complaint Location</div>
          <div className="mt-1.5 text-lg font-bold text-slate-900">
            {data?.topLocation ? data.topLocation.location : '—'}
          </div>
          <div className="mt-1 text-xs text-slate-500">
            {data?.topLocation ? (
              <>
                {data.topLocation.count} issues ·{' '}
                <button
                  type="button"
                  onClick={() =>
                    onOpenLocationHeatmap(data.topLocation!.location as CampusLocationName)
                  }
                  className="cursor-pointer font-semibold text-blue-700 hover:underline"
                >
                  Open heatmap
                </button>
              </>
            ) : (
              'No reports yet'
            )}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white px-5 py-4.5">
          <div className="text-xs text-slate-500">Resolution Rate</div>
          <div className="mono mt-1.5 text-2xl font-bold text-green-700">
            {data ? `${data.resolutionRate}%` : '0%'}
          </div>
          <div className="mt-1 text-xs text-slate-500">
            {data ? `${data.resolvedCount} of ${data.total} resolved` : '—'}
          </div>
        </div>
      </div>

      <div className="mb-5 grid grid-cols-12 gap-5">
        <div className="col-span-12 rounded-xl border border-slate-200 bg-white p-5 lg:col-span-5">
          <div className="text-[15px] font-semibold text-slate-900">Category-Wise Volume</div>
          <div className="relative mt-3 h-[260px]">
            <canvas ref={catCanvasRef} />
          </div>
        </div>
        <div className="col-span-12 rounded-xl border border-slate-200 bg-white p-5 lg:col-span-4">
          <div className="text-[15px] font-semibold text-slate-900">
            RGUKT Basar Location Breakdown
          </div>
          <div className="relative mt-3 h-[260px]">
            <canvas ref={locCanvasRef} />
          </div>
        </div>
        <div className="col-span-12 rounded-xl border border-slate-200 bg-white p-5 lg:col-span-3">
          <div className="text-[15px] font-semibold text-slate-900">Workflow Status Mix</div>
          <div className="relative mt-3 h-[260px]">
            <canvas ref={statusCanvasRef} />
          </div>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-5 py-3.5">
          <div className="text-[15px] font-semibold text-slate-900">
            Location Statistics Matrix (Click row to open location heatmap)
          </div>
        </div>
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr>
              <th className="border-b border-slate-200 bg-slate-50 px-4 py-2.5 text-left text-xs font-semibold text-slate-500">
                Campus Location
              </th>
              <th className="border-b border-slate-200 bg-slate-50 px-4 py-2.5 text-right text-xs font-semibold text-slate-500">
                Total
              </th>
              <th className="border-b border-slate-200 bg-slate-50 px-4 py-2.5 text-right text-xs font-semibold text-slate-500">
                Reported
              </th>
              <th className="border-b border-slate-200 bg-slate-50 px-4 py-2.5 text-right text-xs font-semibold text-slate-500">
                Acknowledged
              </th>
              <th className="border-b border-slate-200 bg-slate-50 px-4 py-2.5 text-right text-xs font-semibold text-slate-500">
                In Progress
              </th>
              <th className="border-b border-slate-200 bg-slate-50 px-4 py-2.5 text-right text-xs font-semibold text-slate-500">
                Resolved
              </th>
            </tr>
          </thead>
          <tbody>
            {(data?.byLocation || []).map((row) => (
              <tr
                key={row.location}
                onClick={() => onOpenLocationHeatmap(row.location)}
                className="cursor-pointer border-b border-slate-100 hover:bg-slate-50 last:border-b-0"
              >
                <td className="px-4 py-2.5 font-semibold text-slate-900">{row.location}</td>
                <td className="mono px-4 py-2.5 text-right">{row.total}</td>
                <td className="mono px-4 py-2.5 text-right">{row.reported}</td>
                <td className="mono px-4 py-2.5 text-right">{row.acknowledged}</td>
                <td className="mono px-4 py-2.5 text-right">{row.inProgress}</td>
                <td className="mono px-4 py-2.5 text-right">{row.resolved}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
