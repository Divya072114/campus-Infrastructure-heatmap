import React, { useCallback, useEffect, useState } from 'react';
import { signInWithPopup } from 'firebase/auth';
import { apiRequest } from '../lib/api.ts';
import { auth, googleAuthProvider } from '../lib/firebase.ts';
import {
  CATEGORIES,
  LOCATIONS,
  STATUSES,
} from '../shared/campus.ts';

import type {
  AuthUser,
  CampusLocationConfig,
  CampusLocationName,
  ComplaintRecord,
  ComplaintStatus,
} from '../shared/campus.ts';

interface AdminConsoleProps {
  user: AuthUser | null;
  token: string | null;
  onAuthenticated: (token: string, user: AuthUser) => void;
  onOpenLocationHeatmap: (location: CampusLocationName) => void;
  onViewPhoto: (imageUrl: string) => void;
}

interface LocationRow extends CampusLocationConfig {
  id: number;
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

export function AdminConsole({
  user,
  token,
  onAuthenticated,
  onOpenLocationHeatmap,
  onViewPhoto,
}: AdminConsoleProps) {
  // Admin Auth State
  const [needsSetup, setNeedsSetup] = useState<boolean | null>(null);
  const [authEmail, setAuthEmail] = useState('');
  const [authPass, setAuthPass] = useState('');
  const [authConfirmPass, setAuthConfirmPass] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);
  const [authBusy, setAuthBusy] = useState(false);

  // Admin Workspace State
  const [complaints, setComplaints] = useState<ComplaintRecord[]>([]);
  const [counts, setCounts] = useState({ realTotal: 0, demoTotal: 0, filteredTotal: 0 });
  const [loading, setLoading] = useState(false);
  const [banner, setBanner] = useState<{ type: 'error' | 'success'; text: string } | null>(null);

  // Filters
  const [search, setSearch] = useState('');
  const [filterCat, setFilterCat] = useState('All');
  const [filterLoc, setFilterLoc] = useState('All');
  const [filterStatus, setFilterStatus] = useState('All');
  const [includeDemo, setIncludeDemo] = useState(false);

  // Row action states
  const [updatingId, setUpdatingId] = useState<number | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [resettingDemo, setResettingDemo] = useState(false);

  // Building Locations Config Editor
  const [showCoordEditor, setShowCoordEditor] = useState(false);
  const [coordEdits, setCoordEdits] = useState<LocationRow[]>([]);
  const [savingCoords, setSavingCoords] = useState(false);

  useEffect(() => {
    if (user && user.role === 'admin') return;
    apiRequest<{ needsSetup: boolean }>('/api/auth/admin/status')
      .then((res) => setNeedsSetup(res.needsSetup))
      .catch(() => setNeedsSetup(false));
  }, [user]);

  const loadComplaints = useCallback(async () => {
    if (!token || !user || user.role !== 'admin') return;
    setLoading(true);
    try {
      const params = new URLSearchParams({
        search,
        category: filterCat,
        location: filterLoc,
        status: filterStatus,
        includeDemo: includeDemo ? 'true' : 'false',
      });
      const res = await apiRequest<{
        complaints: ComplaintRecord[];
        counts: { realTotal: number; demoTotal: number; filteredTotal: number };
      }>(`/api/admin/complaints?${params.toString()}`, { token });
      setComplaints(res.complaints);
      setCounts(res.counts);
    } catch (err) {
      setBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to load complaints.',
      });
    } finally {
      setLoading(false);
    }
  }, [token, user, search, filterCat, filterLoc, filterStatus, includeDemo]);

  useEffect(() => {
    if (user && user.role === 'admin' && token) {
      loadComplaints();
    }
  }, [user, token, loadComplaints]);

  async function handleAdminLogin(e: React.FormEvent) {
    e.preventDefault();
    if (authBusy) return;
    setAuthError(null);
    setAuthBusy(true);
    try {
      const res = await apiRequest<{ token: string; user: AuthUser }>('/api/auth/admin/login', {
        method: 'POST',
        body: { email: authEmail, password: authPass },
      });
      onAuthenticated(res.token, res.user);
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Invalid administrator credentials.');
    } finally {
      setAuthBusy(false);
    }
  }

  async function handleAdminSetup(e: React.FormEvent) {
    e.preventDefault();
    if (authBusy) return;
    setAuthError(null);
    if (authPass !== authConfirmPass) {
      setAuthError('Passwords do not match.');
      return;
    }
    setAuthBusy(true);
    try {
      const res = await apiRequest<{ token: string; user: AuthUser }>('/api/auth/admin/setup', {
        method: 'POST',
        body: { email: authEmail, password: authPass },
      });
      setNeedsSetup(false);
      onAuthenticated(res.token, res.user);
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Failed to initialize administrator.');
    } finally {
      setAuthBusy(false);
    }
  }

  async function handleGoogleAdminSignIn() {
    if (authBusy) return;
    setAuthError(null);
    setAuthBusy(true);
    try {
      const credential = await signInWithPopup(auth, googleAuthProvider);
      const idToken = await credential.user.getIdToken();
      const res = await apiRequest<{ user: AuthUser }>('/api/auth/firebase', {
        method: 'POST',
        token: idToken,
        body: { mode: 'admin' },
      });
      onAuthenticated(idToken, res.user);
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Google admin sign-in failed.');
    } finally {
      setAuthBusy(false);
    }
  }

  async function handleStatusChange(id: number, newStatus: ComplaintStatus) {
    if (!token) return;
    setUpdatingId(id);
    setBanner(null);
    try {
      const res = await apiRequest<{ complaint: ComplaintRecord }>(
        `/api/admin/complaints/${id}/status`,
        {
          method: 'PATCH',
          token,
          body: { status: newStatus },
        }
      );
      setComplaints((prev) => prev.map((c) => (c.id === id ? res.complaint : c)));
      setBanner({
        type: 'success',
        text: `Updated ${res.complaint.complaintCode} status to "${res.complaint.status}".`,
      });
    } catch (err) {
      setBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to update status.',
      });
    } finally {
      setUpdatingId(null);
    }
  }

  async function handleDeleteComplaint(id: number) {
    if (!token) return;
    setDeletingId(id);
    setBanner(null);
    try {
      await apiRequest(`/api/admin/complaints/${id}`, {
        method: 'DELETE',
        token,
      });
      setConfirmDeleteId(null);
      setBanner({ type: 'success', text: 'Complaint deleted from database.' });
      await loadComplaints();
    } catch (err) {
      setBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to delete complaint.',
      });
    } finally {
      setDeletingId(null);
    }
  }

  async function handleToggleCoordEditor() {
    if (!showCoordEditor && token) {
      try {
        const res = await apiRequest<{ locations: LocationRow[] }>('/api/locations', { token });
        setCoordEdits(res.locations);
      } catch (err) {
        setBanner({
          type: 'error',
          text: err instanceof Error ? err.message : 'Failed to load building locations.',
        });
        return;
      }
    }
    setShowCoordEditor((prev) => !prev);
  }

  async function handleSaveCoords() {
    if (!token || savingCoords) return;
    setSavingCoords(true);
    setBanner(null);
    try {
      const res = await apiRequest<{ locations: LocationRow[] }>('/api/locations', {
        method: 'PUT',
        token,
        body: { locations: coordEdits },
      });
      setCoordEdits(res.locations);
      setBanner({ type: 'success', text: 'Campus building locations saved to database.' });
    } catch (err) {
      setBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to save building locations.',
      });
    } finally {
      setSavingCoords(false);
    }
  }

  async function handleResetCoords() {
    if (!token || savingCoords) return;
    setSavingCoords(true);
    setBanner(null);
    try {
      const res = await apiRequest<{ locations: LocationRow[] }>('/api/locations/reset', {
        method: 'POST',
        token,
      });
      setCoordEdits(res.locations);
      setBanner({ type: 'success', text: 'Campus locations reset to RGUKT Basar defaults.' });
    } catch (err) {
      setBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to reset campus locations.',
      });
    } finally {
      setSavingCoords(false);
    }
  }

  async function handleResetDemoData() {
    if (!token || resettingDemo) return;
    setResettingDemo(true);
    setBanner(null);
    try {
      const res = await apiRequest<{ ok: boolean; demoCount: number }>(
        '/api/admin/demo/reset',
        { method: 'POST', token }
      );
      setBanner({
        type: 'success',
        text: `Reset ${res.demoCount} sample demo records. All real student complaints remain untouched.`,
      });
      await loadComplaints();
    } catch (err) {
      setBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to reset demo records.',
      });
    } finally {
      setResettingDemo(false);
    }
  }

  async function handleExportCsv() {
    if (!token) return;
    setBanner(null);
    try {
      const url = `/api/admin/export?includeDemo=${includeDemo ? 'true' : 'false'}`;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        throw new Error('Failed to export CSV.');
      }
      const csvText = await res.text();
      const blobUrl = URL.createObjectURL(new Blob([csvText], { type: 'text/csv' }));
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = 'rgukt-basar-complaints.csv';
      a.click();
      URL.revokeObjectURL(blobUrl);
    } catch (err) {
      setBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'CSV export failed.',
      });
    }
  }

  if (!user || user.role !== 'admin') {
    return (
      <div className="mx-auto max-w-[460px] rounded-xl border border-slate-200 bg-white p-6">
        <div className="text-xs font-semibold text-blue-700">
          Administrator Authentication Required
        </div>
        <h2 className="mt-1 text-lg font-bold text-slate-900">
          {needsSetup
            ? 'RGUKT Basar — First-Run Admin Setup'
            : 'RGUKT Basar — Admin Login'}
        </h2>
        <p className="mb-4 mt-1 text-xs text-slate-500">
          {needsSetup
            ? 'No administrator password has been configured yet. Create the primary administrator account or sign in with your authorized Google account.'
            : 'Heatmap, analytics, and student contact numbers are accessible only after Admin sign-in.'}
        </p>

        {authError && (
          <div className="mb-3.5 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs font-medium text-red-700">
            {authError}
          </div>
        )}

        {needsSetup ? (
          <form onSubmit={handleAdminSetup} className="flex flex-col gap-3">
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-slate-700">
                Administrator Email
              </label>
              <input
                type="email"
                required
                value={authEmail}
                onChange={(e) => setAuthEmail(e.target.value)}
                placeholder="admin@rgukt.ac.in"
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-[13px] text-slate-900"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-slate-700">
                Create Password (min 8 characters)
              </label>
              <input
                type="password"
                required
                minLength={8}
                value={authPass}
                onChange={(e) => setAuthPass(e.target.value)}
                placeholder="Create a strong password"
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-[13px] text-slate-900"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-slate-700">
                Confirm Password
              </label>
              <input
                type="password"
                required
                minLength={8}
                value={authConfirmPass}
                onChange={(e) => setAuthConfirmPass(e.target.value)}
                placeholder="Re-enter password"
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-[13px] text-slate-900"
              />
            </div>
            <button
              type="submit"
              disabled={authBusy}
              className="w-full cursor-pointer rounded-lg bg-slate-900 px-4 py-2.5 text-[13px] font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
            >
              {authBusy ? 'Creating Admin Account...' : 'Create Administrator & Sign In'}
            </button>
            <button
              type="button"
              disabled={authBusy}
              onClick={handleGoogleAdminSignIn}
              className="w-full cursor-pointer rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-[13px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              Sign in with Google (Authorized Admin)
            </button>
          </form>
        ) : (
          <form onSubmit={handleAdminLogin} className="flex flex-col gap-3">
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-slate-700">
                Admin Email
              </label>
              <input
                type="email"
                required
                value={authEmail}
                onChange={(e) => setAuthEmail(e.target.value)}
                placeholder="admin@rgukt.ac.in"
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-[13px] text-slate-900"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-slate-700">
                Password
              </label>
              <input
                type="password"
                required
                value={authPass}
                onChange={(e) => setAuthPass(e.target.value)}
                placeholder="Enter password"
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-[13px] text-slate-900"
              />
            </div>
            <button
              type="submit"
              disabled={authBusy}
              className="w-full cursor-pointer rounded-lg bg-slate-900 px-4 py-2.5 text-[13px] font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
            >
              {authBusy ? 'Signing In...' : 'Sign In as Administrator'}
            </button>
            <button
              type="button"
              disabled={authBusy}
              onClick={handleGoogleAdminSignIn}
              className="w-full cursor-pointer rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-[13px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              Sign in with Google (Authorized Admin)
            </button>
          </form>
        )}
      </div>
    );
  }

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3.5 rounded-xl border border-slate-200 bg-white px-4 py-3.5">
        <div>
          <div className="text-xs text-slate-500">
            RGUKT Basar Estates &amp; Maintenance Triage
          </div>
          <div className="text-[15px] font-semibold text-slate-900">
            Campus Estates Administrator ({counts.realTotal} real complaints · {counts.demoTotal}{' '}
            demo records)
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={handleToggleCoordEditor}
            className="cursor-pointer rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            Configure Building Locations
          </button>
          <button
            type="button"
            onClick={handleExportCsv}
            className="cursor-pointer rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            Export CSV
          </button>
          <button
            type="button"
            onClick={handleResetDemoData}
            disabled={resettingDemo}
            className="cursor-pointer rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
          >
            {resettingDemo ? 'Resetting Demo...' : 'Reset Demo Data'}
          </button>
        </div>
      </div>

      {banner && (
        <div
          className={`mb-4 rounded-lg border px-3.5 py-2.5 text-xs font-medium ${
            banner.type === 'success'
              ? 'border-green-200 bg-green-50 text-green-700'
              : 'border-red-200 bg-red-50 text-red-700'
          }`}
        >
          {banner.text}
        </div>
      )}

      {showCoordEditor && (
        <div className="mb-5 rounded-xl border border-slate-200 bg-white p-5">
          <div className="text-[15px] font-semibold text-slate-900">
            RGUKT Basar — Building Locations &amp; Boundary Configuration
          </div>
          <div className="mb-3 mt-0.5 text-xs text-slate-500">
            Configure Lat, Lng, and boundary radius (meters) for each campus zone
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {coordEdits.map((loc, idx) => (
              <div key={loc.name} className="rounded-lg border border-slate-200 p-3">
                <div className="text-xs font-semibold text-slate-900">{loc.name}</div>
                <div className="mt-2 grid grid-cols-3 gap-2">
                  <div>
                    <label className="mb-1 block text-[11px] text-slate-500">Lat</label>
                    <input
                      type="number"
                      step="0.0001"
                      value={loc.lat}
                      onChange={(e) => {
                        const val = parseFloat(e.target.value);
                        setCoordEdits((prev) =>
                          prev.map((item, i) =>
                            i === idx ? { ...item, lat: Number.isNaN(val) ? 0 : val } : item
                          )
                        );
                      }}
                      className="w-full rounded border border-slate-300 px-2 py-1 text-xs"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-[11px] text-slate-500">Lng</label>
                    <input
                      type="number"
                      step="0.0001"
                      value={loc.lng}
                      onChange={(e) => {
                        const val = parseFloat(e.target.value);
                        setCoordEdits((prev) =>
                          prev.map((item, i) =>
                            i === idx ? { ...item, lng: Number.isNaN(val) ? 0 : val } : item
                          )
                        );
                      }}
                      className="w-full rounded border border-slate-300 px-2 py-1 text-xs"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-[11px] text-slate-500">Radius (m)</label>
                    <input
                      type="number"
                      min={20}
                      max={1000}
                      value={loc.radiusMeters}
                      onChange={(e) => {
                        const val = parseInt(e.target.value, 10);
                        setCoordEdits((prev) =>
                          prev.map((item, i) =>
                            i === idx
                              ? { ...item, radiusMeters: Number.isNaN(val) ? 20 : val }
                              : item
                          )
                        );
                      }}
                      className="w-full rounded border border-slate-300 px-2 py-1 text-xs"
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-3.5 flex justify-end gap-2.5">
            <button
              type="button"
              onClick={handleResetCoords}
              disabled={savingCoords}
              className="cursor-pointer rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              Reset Defaults
            </button>
            <button
              type="button"
              onClick={handleSaveCoords}
              disabled={savingCoords}
              className="cursor-pointer rounded-lg bg-blue-700 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-800 disabled:opacity-60"
            >
              {savingCoords ? 'Saving...' : 'Save Locations'}
            </button>
          </div>
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="grid grid-cols-1 gap-2.5 border-b border-slate-200 p-4 sm:grid-cols-2 lg:grid-cols-6">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search ID, title, block, student, mobile..."
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-[13px] text-slate-900 lg:col-span-2"
          />
          <select
            value={filterCat}
            onChange={(e) => setFilterCat(e.target.value)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-[13px] text-slate-900"
          >
            <option value="All">All Categories</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <select
            value={filterLoc}
            onChange={(e) => setFilterLoc(e.target.value)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-[13px] text-slate-900"
          >
            <option value="All">All Locations</option>
            {LOCATIONS.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-[13px] text-slate-900"
          >
            <option value="All">All Statuses</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <select
            value={includeDemo ? 'all' : 'real'}
            onChange={(e) => setIncludeDemo(e.target.value === 'all')}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-[13px] text-slate-900"
          >
            <option value="real">Real Student Complaints Only</option>
            <option value="all">Include Demo Sample Records</option>
          </select>
        </div>

        <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50 px-4 py-2 text-xs text-slate-500">
          <span>
            Showing <strong>{complaints.length}</strong> record(s) (newest first)
          </span>
          <button
            type="button"
            onClick={loadComplaints}
            disabled={loading}
            className="cursor-pointer font-semibold text-blue-700 hover:underline"
          >
            {loading ? 'Loading...' : 'Refresh Table'}
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr>
                <th className="whitespace-nowrap border-b border-slate-200 bg-slate-50 px-4 py-2.5 text-left text-xs font-semibold text-slate-500">
                  ID
                </th>
                <th className="whitespace-nowrap border-b border-slate-200 bg-slate-50 px-4 py-2.5 text-left text-xs font-semibold text-slate-500">
                  Complaint &amp; Spot
                </th>
                <th className="whitespace-nowrap border-b border-slate-200 bg-slate-50 px-4 py-2.5 text-left text-xs font-semibold text-slate-500">
                  Category
                </th>
                <th className="whitespace-nowrap border-b border-slate-200 bg-slate-50 px-4 py-2.5 text-left text-xs font-semibold text-slate-500">
                  Location
                </th>
                <th className="whitespace-nowrap border-b border-slate-200 bg-slate-50 px-4 py-2.5 text-left text-xs font-semibold text-slate-500">
                  Student &amp; Mobile
                </th>
                <th className="whitespace-nowrap border-b border-slate-200 bg-slate-50 px-4 py-2.5 text-left text-xs font-semibold text-slate-500">
                  Submitted
                </th>
                <th className="whitespace-nowrap border-b border-slate-200 bg-slate-50 px-4 py-2.5 text-left text-xs font-semibold text-slate-500">
                  Status
                </th>
                <th className="whitespace-nowrap border-b border-slate-200 bg-slate-50 px-4 py-2.5 text-right text-xs font-semibold text-slate-500">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {complaints.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-sm text-slate-500">
                    {loading
                      ? 'Loading complaints from database...'
                      : includeDemo
                      ? 'No complaints match your filters.'
                      : 'No real student complaints match your filters yet.'}
                  </td>
                </tr>
              ) : (
                complaints.map((c) => (
                  <tr key={c.id} className="border-b border-slate-100 last:border-b-0">
                    <td className="mono whitespace-nowrap px-4 py-3 align-middle text-xs">
                      <div>{c.complaintCode}</div>
                      {c.isDemo && (
                        <span className="mt-1 inline-block rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-semibold text-slate-700">
                          DEMO
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 align-middle">
                      <div className="font-semibold text-slate-900">{c.title}</div>
                      <div className="text-[11px] text-slate-500">
                        {c.buildingBlock} · {c.floorRoom}
                      </div>
                      {c.imageUrl && (
                        <button
                          type="button"
                          onClick={() => onViewPhoto(c.imageUrl!)}
                          className="mt-1 cursor-pointer text-[11px] font-semibold text-blue-700 hover:underline"
                        >
                          View Photo
                        </button>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 align-middle">{c.category}</td>
                    <td className="px-4 py-3 align-middle">
                      <button
                        type="button"
                        onClick={() => onOpenLocationHeatmap(c.location)}
                        className="cursor-pointer text-left text-xs font-semibold text-blue-700 hover:underline"
                      >
                        {c.location}
                      </button>
                    </td>
                    <td className="px-4 py-3 align-middle">
                      <div>
                        {c.studentName} ({c.rollNumber})
                      </div>
                      <div>
                        <a
                          href={`tel:${c.studentMobile}`}
                          className="mono text-xs font-semibold text-green-700 hover:underline"
                        >
                          {c.studentMobile}
                        </a>
                      </div>
                    </td>
                    <td className="mono whitespace-nowrap px-4 py-3 align-middle text-xs text-slate-600">
                      {formatDate(c.createdAt)}
                    </td>
                    <td className="px-4 py-3 align-middle">
                      <select
                        value={c.status}
                        disabled={updatingId === c.id}
                        onChange={(e) =>
                          handleStatusChange(c.id, e.target.value as ComplaintStatus)
                        }
                        className="w-auto rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs text-slate-900"
                      >
                        {STATUSES.map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right align-middle">
                      {confirmDeleteId === c.id ? (
                        <span className="inline-flex items-center gap-2">
                          <button
                            type="button"
                            disabled={deletingId === c.id}
                            onClick={() => handleDeleteComplaint(c.id)}
                            className="cursor-pointer text-xs font-semibold text-red-700 hover:underline"
                          >
                            {deletingId === c.id ? 'Deleting...' : 'Confirm'}
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(null)}
                            className="cursor-pointer text-xs font-medium text-slate-500 hover:underline"
                          >
                            Cancel
                          </button>
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(c.id)}
                          className="cursor-pointer text-xs font-semibold text-red-700 hover:underline"
                        >
                          Delete
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
