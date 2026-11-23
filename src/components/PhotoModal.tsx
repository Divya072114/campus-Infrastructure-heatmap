import { useEffect, useState } from 'react';
import { fetchAuthenticatedBlobUrl } from '../lib/api.ts';

interface PhotoModalProps {
  imageUrl: string | null;
  token: string | null;
  onClose: () => void;
}

export function PhotoModal({ imageUrl, token, onClose }: PhotoModalProps) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!imageUrl) {
      setObjectUrl(null);
      setError(null);
      return;
    }

    let cancelled = false;
    let createdUrl: string | null = null;
    setLoading(true);
    setError(null);

    fetchAuthenticatedBlobUrl(imageUrl, token)
      .then((url) => {
        if (cancelled) {
          URL.revokeObjectURL(url);
          return;
        }
        createdUrl = url;
        setObjectUrl(url);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load photo.');
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
      if (createdUrl) {
        URL.revokeObjectURL(createdUrl);
      }
    };
  }, [imageUrl, token]);

  if (!imageUrl) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 p-5"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[560px] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5">
          <div className="text-[15px] font-semibold text-slate-900">Attached Photo</div>
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer rounded-lg border border-slate-200 bg-white px-3.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            Close
          </button>
        </div>
        <div className="flex min-h-[200px] items-center justify-center bg-slate-50 p-3">
          {loading && <div className="text-sm text-slate-500">Loading photo...</div>}
          {error && <div className="text-sm font-medium text-red-700">{error}</div>}
          {objectUrl && !loading && !error && (
            <img
              src={objectUrl}
              alt="Complaint attachment"
              className="block max-h-[68vh] w-full rounded object-contain"
            />
          )}
        </div>
      </div>
    </div>
  );
}
