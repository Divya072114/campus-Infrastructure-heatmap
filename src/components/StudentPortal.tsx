import React, { useCallback, useEffect, useState } from 'react';
import { signInWithPopup } from 'firebase/auth';
import { apiRequest } from '../lib/api.ts';
import { auth, googleAuthProvider } from '../lib/firebase.ts';
import {
  AuthUser,
  CATEGORIES,
  Category,
  CampusLocationName,
  ComplaintRecord,
  DEPARTMENTS,
  LOCATIONS,
} from '../shared/campus.ts';

interface StudentPortalProps {
  user: AuthUser | null;
  token: string | null;
  onAuthenticated: (token: string, user: AuthUser) => void;
  onUserUpdated: (user: AuthUser) => void;
  onViewPhoto: (imageUrl: string) => void;
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

function getStatusBadgeClass(status: string): string {
  switch (status) {
    case 'Resolved':
      return 'bg-green-50 text-green-700 border-green-200';
    case 'In Progress':
      return 'bg-blue-50 text-blue-700 border-blue-200';
    case 'Acknowledged':
      return 'bg-indigo-50 text-indigo-700 border-indigo-200';
    default:
      return 'bg-amber-50 text-amber-800 border-amber-200';
  }
}

export function StudentPortal({
  user,
  token,
  onAuthenticated,
  onUserUpdated,
  onViewPhoto,
}: StudentPortalProps) {
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [authError, setAuthError] = useState<string | null>(null);
  const [authBusy, setAuthBusy] = useState(false);

  // Login fields
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPass, setLoginPass] = useState('');

  // Register fields
  const [regName, setRegName] = useState('');
  const [regRoll, setRegRoll] = useState('');
  const [regMobile, setRegMobile] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regDept, setRegDept] = useState<string>(DEPARTMENTS[0]);
  const [regPass, setRegPass] = useState('');

  // Complete profile (Google Sign-In first time)
  const [compName, setCompName] = useState('');
  const [compRoll, setCompRoll] = useState('');
  const [compMobile, setCompMobile] = useState('');
  const [compDept, setCompDept] = useState<string>(DEPARTMENTS[0]);
  const [compError, setCompError] = useState<string | null>(null);
  const [compBusy, setCompBusy] = useState(false);

  // Mobile update
  const [mobileInput, setMobileInput] = useState('');
  const [mobileMsg, setMobileMsg] = useState<{ type: 'error' | 'success'; text: string } | null>(
    null
  );
  const [mobileBusy, setMobileBusy] = useState(false);

  // Complaint submission
  const [cmpTitle, setCmpTitle] = useState('');
  const [cmpCategory, setCmpCategory] = useState<Category>(CATEGORIES[0]);
  const [cmpLocation, setCmpLocation] = useState<CampusLocationName>(LOCATIONS[0]);
  const [cmpBlock, setCmpBlock] = useState('');
  const [cmpFloor, setCmpFloor] = useState('');
  const [cmpDesc, setCmpDesc] = useState('');
  const [uploadedImageId, setUploadedImageId] = useState<string | null>(null);
  const [uploadedImageName, setUploadedImageName] = useState<string | null>(null);
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState<string | null>(null);
  const [photoUploading, setPhotoUploading] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [cmpSubmitting, setCmpSubmitting] = useState(false);
  const [cmpAlert, setCmpAlert] = useState<{ type: 'error' | 'success'; text: string } | null>(
    null
  );

  // Complaint history
  const [history, setHistory] = useState<ComplaintRecord[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);

  const loadMyComplaints = useCallback(async () => {
    if (!token || !user || user.role !== 'student' || user.needsProfileCompletion) return;
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const res = await apiRequest<{ complaints: ComplaintRecord[] }>('/api/complaints/mine', {
        token,
      });
      setHistory(res.complaints);
    } catch (err) {
      setHistoryError(err instanceof Error ? err.message : 'Failed to load complaints.');
    } finally {
      setHistoryLoading(false);
    }
  }, [token, user]);

  useEffect(() => {
    if (user && user.role === 'student') {
      setMobileInput(user.mobileNumber || '');
      setCompName(user.name || '');
      if (!user.needsProfileCompletion) {
        loadMyComplaints();
      }
    }
  }, [user, loadMyComplaints]);

  useEffect(() => {
    return () => {
      if (photoPreviewUrl) {
        URL.revokeObjectURL(photoPreviewUrl);
      }
    };
  }, [photoPreviewUrl]);

  async function handleStudentLogin(e: React.FormEvent) {
    e.preventDefault();
    if (authBusy) return;
    setAuthError(null);
    setAuthBusy(true);
    try {
      const res = await apiRequest<{ token: string; user: AuthUser }>(
        '/api/auth/student/login',
        {
          method: 'POST',
          body: { email: loginEmail, password: loginPass },
        }
      );
      onAuthenticated(res.token, res.user);
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Sign-in failed.');
    } finally {
      setAuthBusy(false);
    }
  }

  async function handleStudentRegister(e: React.FormEvent) {
    e.preventDefault();
    if (authBusy) return;
    setAuthError(null);
    setAuthBusy(true);
    try {
      const res = await apiRequest<{ token: string; user: AuthUser }>(
        '/api/auth/student/register',
        {
          method: 'POST',
          body: {
            name: regName,
            rollNumber: regRoll,
            mobileNumber: regMobile,
            email: regEmail,
            department: regDept,
            password: regPass,
          },
        }
      );
      onAuthenticated(res.token, res.user);
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Registration failed.');
    } finally {
      setAuthBusy(false);
    }
  }

  async function handleGoogleSignIn() {
    if (authBusy) return;
    setAuthError(null);
    setAuthBusy(true);
    try {
      const credential = await signInWithPopup(auth, googleAuthProvider);
      const idToken = await credential.user.getIdToken();
      const res = await apiRequest<{ user: AuthUser }>('/api/auth/firebase', {
        method: 'POST',
        token: idToken,
        body: { mode: 'student' },
      });
      onAuthenticated(idToken, res.user);
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Google sign-in failed.');
    } finally {
      setAuthBusy(false);
    }
  }

  async function handleCompleteProfile(e: React.FormEvent) {
    e.preventDefault();
    if (compBusy || !token) return;
    setCompError(null);
    setCompBusy(true);
    try {
      const res = await apiRequest<{ user: AuthUser }>('/api/auth/student/complete-profile', {
        method: 'POST',
        token,
        body: {
          name: compName,
          rollNumber: compRoll,
          mobileNumber: compMobile,
          department: compDept,
        },
      });
      onUserUpdated(res.user);
    } catch (err) {
      setCompError(err instanceof Error ? err.message : 'Failed to save profile.');
    } finally {
      setCompBusy(false);
    }
  }

  async function handleUpdateMobile() {
    if (mobileBusy || !token) return;
    setMobileMsg(null);
    setMobileBusy(true);
    try {
      const res = await apiRequest<{ user: AuthUser }>('/api/auth/student/mobile', {
        method: 'PATCH',
        token,
        body: { mobileNumber: mobileInput },
      });
      onUserUpdated(res.user);
      setMobileMsg({ type: 'success', text: 'Mobile updated.' });
      await loadMyComplaints();
    } catch (err) {
      setMobileMsg({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to update mobile.',
      });
    } finally {
      setMobileBusy(false);
    }
  }

  function clearUploadedPhoto() {
    if (photoPreviewUrl) {
      URL.revokeObjectURL(photoPreviewUrl);
    }
    setUploadedImageId(null);
    setUploadedImageName(null);
    setPhotoPreviewUrl(null);
    setPhotoError(null);
  }

  async function handlePhotoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !token) return;

    setPhotoError(null);
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (!allowed.includes(file.type)) {
      setPhotoError('Invalid format. Only JPEG, PNG, WebP, or GIF images are allowed.');
      e.target.value = '';
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setPhotoError('Image exceeds 5 MB limit. Please choose a smaller photo.');
      e.target.value = '';
      return;
    }

    setPhotoUploading(true);
    try {
      const formData = new FormData();
      formData.append('photo', file);
      const res = await apiRequest<{ imageId: string; imageUrl: string }>('/api/uploads', {
        method: 'POST',
        token,
        body: formData,
        isFormData: true,
      });

      if (photoPreviewUrl) {
        URL.revokeObjectURL(photoPreviewUrl);
      }
      setUploadedImageId(res.imageId);
      setUploadedImageName(file.name);
      setPhotoPreviewUrl(URL.createObjectURL(file));
    } catch (err) {
      clearUploadedPhoto();
      setPhotoError(err instanceof Error ? err.message : 'Photo upload failed.');
      e.target.value = '';
    } finally {
      setPhotoUploading(false);
    }
  }

  async function handleComplaintSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (cmpSubmitting || photoUploading || !token) return;

    setCmpAlert(null);
    setCmpSubmitting(true);
    try {
      const res = await apiRequest<{ complaint: ComplaintRecord }>('/api/complaints', {
        method: 'POST',
        token,
        body: {
          title: cmpTitle,
          category: cmpCategory,
          location: cmpLocation,
          buildingBlock: cmpBlock,
          floorRoom: cmpFloor,
          description: cmpDesc,
          imageId: uploadedImageId,
        },
      });

      setCmpTitle('');
      setCmpBlock('');
      setCmpFloor('');
      setCmpDesc('');
      clearUploadedPhoto();
      const inputEl = document.getElementById('cmpPhotoInput') as HTMLInputElement | null;
      if (inputEl) inputEl.value = '';

      setCmpAlert({
        type: 'success',
        text: `Complaint ${res.complaint.complaintCode} submitted with status "Reported".`,
      });
      setHistory((prev) => [res.complaint, ...prev]);
    } catch (err) {
      setCmpAlert({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to submit complaint.',
      });
    } finally {
      setCmpSubmitting(false);
    }
  }

  // Unauthenticated view
  if (!user || user.role !== 'student') {
    return (
      <div className="mx-auto max-w-[760px] rounded-xl border border-slate-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-3.5">
          <div>
            <div className="text-[15px] font-semibold text-slate-900">
              RGUKT Basar — Student Complaint Portal
            </div>
            <div className="mt-0.5 text-xs text-slate-500">
              Register with your mandatory 10-digit mobile number or sign in to submit complaints
            </div>
          </div>
          <div className="inline-flex gap-1 rounded-lg bg-slate-100 p-1">
            <button
              type="button"
              onClick={() => {
                setAuthMode('login');
                setAuthError(null);
              }}
              className={`cursor-pointer rounded-md px-3 py-1.5 text-xs font-semibold ${
                authMode === 'login'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Student Login
            </button>
            <button
              type="button"
              onClick={() => {
                setAuthMode('register');
                setAuthError(null);
              }}
              className={`cursor-pointer rounded-md px-3 py-1.5 text-xs font-semibold ${
                authMode === 'register'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Register Account
            </button>
          </div>
        </div>

        <div className="p-6">
          {authError && (
            <div className="mb-3.5 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs font-medium text-red-700">
              {authError}
            </div>
          )}

          {authMode === 'login' ? (
            <form onSubmit={handleStudentLogin}>
              <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-slate-700">
                    RGUKT Email
                  </label>
                  <input
                    type="email"
                    required
                    value={loginEmail}
                    onChange={(e) => setLoginEmail(e.target.value)}
                    placeholder="b201245@rgukt.ac.in"
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
                    value={loginPass}
                    onChange={(e) => setLoginPass(e.target.value)}
                    placeholder="Enter password"
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-[13px] text-slate-900"
                  />
                </div>
              </div>
              <div className="mt-4 flex flex-wrap items-center justify-between gap-2.5">
                <button
                  type="button"
                  disabled={authBusy}
                  onClick={handleGoogleSignIn}
                  className="cursor-pointer rounded-lg border border-slate-300 bg-white px-4 py-2 text-[13px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                >
                  Sign in with Google
                </button>
                <button
                  type="submit"
                  disabled={authBusy}
                  className="cursor-pointer rounded-lg bg-blue-700 px-4 py-2 text-[13px] font-semibold text-white hover:bg-blue-800 disabled:opacity-60"
                >
                  {authBusy ? 'Signing In...' : 'Sign In as Student'}
                </button>
              </div>
            </form>
          ) : (
            <form onSubmit={handleStudentRegister}>
              <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-slate-700">
                    Full Name
                  </label>
                  <input
                    type="text"
                    required
                    value={regName}
                    onChange={(e) => setRegName(e.target.value)}
                    placeholder="e.g. Sai Kiran"
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-[13px] text-slate-900"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-slate-700">
                    RGUKT Roll Number
                  </label>
                  <input
                    type="text"
                    required
                    value={regRoll}
                    onChange={(e) => setRegRoll(e.target.value)}
                    placeholder="e.g. B201245"
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-[13px] text-slate-900"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-slate-700">
                    Mobile Number (Mandatory · 10 digits)
                  </label>
                  <input
                    type="tel"
                    required
                    value={regMobile}
                    onChange={(e) => setRegMobile(e.target.value)}
                    placeholder="e.g. 9876543210"
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-[13px] text-slate-900"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-slate-700">
                    RGUKT Email
                  </label>
                  <input
                    type="email"
                    required
                    value={regEmail}
                    onChange={(e) => setRegEmail(e.target.value)}
                    placeholder="b201245@rgukt.ac.in"
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-[13px] text-slate-900"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-slate-700">
                    Department
                  </label>
                  <select
                    value={regDept}
                    onChange={(e) => setRegDept(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-[13px] text-slate-900"
                  >
                    {DEPARTMENTS.map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-slate-700">
                    Password
                  </label>
                  <input
                    type="password"
                    required
                    minLength={6}
                    value={regPass}
                    onChange={(e) => setRegPass(e.target.value)}
                    placeholder="Minimum 6 characters"
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-[13px] text-slate-900"
                  />
                </div>
              </div>
              <div className="mt-4 flex flex-wrap items-center justify-between gap-2.5">
                <button
                  type="button"
                  disabled={authBusy}
                  onClick={handleGoogleSignIn}
                  className="cursor-pointer rounded-lg border border-slate-300 bg-white px-4 py-2 text-[13px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                >
                  Continue with Google
                </button>
                <button
                  type="submit"
                  disabled={authBusy}
                  className="cursor-pointer rounded-lg bg-slate-900 px-4 py-2 text-[13px] font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
                >
                  {authBusy ? 'Creating Account...' : 'Create Student Account'}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    );
  }

  // First-time Google Sign-In student profile completion
  if (user.needsProfileCompletion) {
    return (
      <div className="mx-auto max-w-[600px] rounded-xl border border-slate-200 bg-white p-6">
        <div className="text-[15px] font-semibold text-slate-900">
          Complete Your RGUKT Student Profile
        </div>
        <div className="mt-1 text-xs text-slate-500">
          Signed in as <span className="font-medium text-slate-700">{user.email}</span>. Enter your
          roll number and mandatory 10-digit mobile number to submit complaints.
        </div>
        {compError && (
          <div className="mt-3.5 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs font-medium text-red-700">
            {compError}
          </div>
        )}
        <form onSubmit={handleCompleteProfile} className="mt-4 grid grid-cols-1 gap-3.5 sm:grid-cols-2">
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-slate-700">Full Name</label>
            <input
              type="text"
              required
              value={compName}
              onChange={(e) => setCompName(e.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-[13px] text-slate-900"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-slate-700">
              RGUKT Roll Number
            </label>
            <input
              type="text"
              required
              value={compRoll}
              onChange={(e) => setCompRoll(e.target.value)}
              placeholder="e.g. B201245"
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-[13px] text-slate-900"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-slate-700">
              Mobile Number (10 digits)
            </label>
            <input
              type="tel"
              required
              value={compMobile}
              onChange={(e) => setCompMobile(e.target.value)}
              placeholder="e.g. 9876543210"
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-[13px] text-slate-900"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-slate-700">Department</label>
            <select
              value={compDept}
              onChange={(e) => setCompDept(e.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-[13px] text-slate-900"
            >
              {DEPARTMENTS.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </div>
          <div className="flex justify-end sm:col-span-2">
            <button
              type="submit"
              disabled={compBusy}
              className="cursor-pointer rounded-lg bg-blue-700 px-4 py-2 text-[13px] font-semibold text-white hover:bg-blue-800 disabled:opacity-60"
            >
              {compBusy ? 'Saving...' : 'Save & Continue to Portal'}
            </button>
          </div>
        </form>
      </div>
    );
  }

  // Authenticated Student Workspace
  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3.5 rounded-xl border border-slate-200 bg-white px-4 py-3.5">
        <div>
          <div className="text-xs text-slate-500">
            Student Profile · {user.rollNumber} · {user.department}
          </div>
          <div className="text-[15px] font-semibold text-slate-900">{user.name}</div>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="text-xs text-slate-700">
            Mobile: <strong className="mono">{user.mobileNumber}</strong>
          </span>
          <input
            type="tel"
            value={mobileInput}
            onChange={(e) => setMobileInput(e.target.value)}
            placeholder="10-digit mobile"
            className="w-[135px] rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-900"
          />
          <button
            type="button"
            disabled={mobileBusy}
            onClick={handleUpdateMobile}
            className="cursor-pointer rounded-lg border border-slate-200 bg-white px-3.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
          >
            {mobileBusy ? 'Updating...' : 'Update Mobile'}
          </button>
          {mobileMsg && (
            <span
              className={`text-xs font-medium ${
                mobileMsg.type === 'success' ? 'text-green-700' : 'text-red-700'
              }`}
            >
              {mobileMsg.text}
            </span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-12 gap-5">
        <div className="col-span-12 rounded-xl border border-slate-200 bg-white p-5 lg:col-span-5">
          <div className="text-[15px] font-semibold text-slate-900">
            Submit RGUKT Basar Complaint
          </div>
          <div className="mb-3.5 mt-0.5 text-xs text-slate-500">
            Maintenance staff use your registered mobile to coordinate repair visits
          </div>

          {cmpAlert && (
            <div
              className={`mb-3.5 rounded-lg border px-3.5 py-2.5 text-xs font-medium ${
                cmpAlert.type === 'success'
                  ? 'border-green-200 bg-green-50 text-green-700'
                  : 'border-red-200 bg-red-50 text-red-700'
              }`}
            >
              {cmpAlert.text}
            </div>
          )}

          <form onSubmit={handleComplaintSubmit} className="flex flex-col gap-3">
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-slate-700">
                Complaint Title
              </label>
              <input
                type="text"
                required
                value={cmpTitle}
                onChange={(e) => setCmpTitle(e.target.value)}
                placeholder="e.g. Water cooler leaking near BH-1 stairs"
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-[13px] text-slate-900"
              />
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1.5 block text-xs font-semibold text-slate-700">
                  Category
                </label>
                <select
                  value={cmpCategory}
                  onChange={(e) => setCmpCategory(e.target.value as Category)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-[13px] text-slate-900"
                >
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-semibold text-slate-700">
                  Campus Location
                </label>
                <select
                  value={cmpLocation}
                  onChange={(e) => setCmpLocation(e.target.value as CampusLocationName)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-[13px] text-slate-900"
                >
                  {LOCATIONS.map((l) => (
                    <option key={l} value={l}>
                      {l}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1.5 block text-xs font-semibold text-slate-700">
                  Building / Block
                </label>
                <input
                  type="text"
                  required
                  value={cmpBlock}
                  onChange={(e) => setCmpBlock(e.target.value)}
                  placeholder="e.g. BH-1 East Wing"
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-[13px] text-slate-900"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-semibold text-slate-700">
                  Floor / Room Number
                </label>
                <input
                  type="text"
                  value={cmpFloor}
                  onChange={(e) => setCmpFloor(e.target.value)}
                  placeholder="e.g. 2nd Floor · Room 204"
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-[13px] text-slate-900"
                />
              </div>
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-semibold text-slate-700">
                Description
              </label>
              <textarea
                rows={3}
                required
                value={cmpDesc}
                onChange={(e) => setCmpDesc(e.target.value)}
                placeholder="Describe problem severity and exact spot..."
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-[13px] text-slate-900"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-semibold text-slate-700">
                Optional Photo Upload (JPEG, PNG, WebP, GIF · max 5 MB)
              </label>
              <input
                id="cmpPhotoInput"
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                onChange={handlePhotoUpload}
                disabled={photoUploading || cmpSubmitting}
                className="w-full text-xs text-slate-600 file:mr-3 file:cursor-pointer file:rounded-md file:border file:border-slate-300 file:bg-slate-50 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-slate-700"
              />
              {photoUploading && (
                <div className="mt-1.5 text-xs text-blue-700">Uploading photo...</div>
              )}
              {photoError && (
                <div className="mt-1.5 text-xs font-medium text-red-700">{photoError}</div>
              )}
              {uploadedImageId && photoPreviewUrl && (
                <div className="mt-2 flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 p-2">
                  <img
                    src={photoPreviewUrl}
                    alt="Uploaded preview"
                    className="h-12 w-12 rounded object-cover"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-medium text-slate-800">
                      {uploadedImageName}
                    </div>
                    <div className="text-[11px] text-green-700">Ready to attach</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      clearUploadedPhoto();
                      const inputEl = document.getElementById(
                        'cmpPhotoInput'
                      ) as HTMLInputElement | null;
                      if (inputEl) inputEl.value = '';
                    }}
                    className="cursor-pointer text-xs font-semibold text-red-700 hover:underline"
                  >
                    Remove
                  </button>
                </div>
              )}
            </div>

            <button
              type="submit"
              disabled={cmpSubmitting || photoUploading}
              className="mt-1 cursor-pointer rounded-lg bg-blue-700 px-4 py-2.5 text-[13px] font-semibold text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {cmpSubmitting ? 'Submitting Complaint...' : 'Submit Complaint'}
            </button>
          </form>
        </div>

        <div className="col-span-12 overflow-hidden rounded-xl border border-slate-200 bg-white lg:col-span-7">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-3.5">
            <div>
              <div className="text-[15px] font-semibold text-slate-900">
                My Submitted Complaints ({history.length})
              </div>
              <div className="mt-0.5 text-xs text-slate-500">
                Reported → Acknowledged → In Progress → Resolved
              </div>
            </div>
            <button
              type="button"
              onClick={loadMyComplaints}
              disabled={historyLoading}
              className="cursor-pointer rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              {historyLoading ? 'Refreshing...' : 'Refresh'}
            </button>
          </div>

          {historyError && (
            <div className="m-4 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs font-medium text-red-700">
              {historyError}
            </div>
          )}

          <div className="max-h-[540px] overflow-y-auto">
            {history.length === 0 && !historyLoading ? (
              <div className="px-6 py-10 text-center text-[13px] text-slate-500">
                No complaints submitted yet.
              </div>
            ) : (
              history.map((c) => (
                <div key={c.id} className="border-b border-slate-100 px-4 py-3.5 last:border-b-0">
                  <div className="flex items-start justify-between gap-2.5">
                    <div>
                      <div className="text-[13px] font-semibold text-slate-900">{c.title}</div>
                      <div className="mt-0.5 text-xs text-slate-500">
                        <span className="mono">{c.complaintCode}</span> ·{' '}
                        <strong className="text-slate-700">{c.category}</strong> · {c.location} ·{' '}
                        {c.buildingBlock} ({c.floorRoom})
                      </div>
                    </div>
                    <span
                      className={`shrink-0 rounded-md border px-2 py-0.5 text-[11px] font-semibold ${getStatusBadgeClass(
                        c.status
                      )}`}
                    >
                      {c.status}
                    </span>
                  </div>
                  <p className="mt-1.5 text-xs text-slate-600">{c.description}</p>
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                    <span>
                      {formatDate(c.createdAt)} · Contact:{' '}
                      <span className="mono">{c.studentMobile}</span>
                    </span>
                    {c.imageUrl && (
                      <button
                        type="button"
                        onClick={() => onViewPhoto(c.imageUrl!)}
                        className="cursor-pointer text-xs font-semibold text-blue-700 hover:underline"
                      >
                        View Photo
                      </button>
                    )}
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
