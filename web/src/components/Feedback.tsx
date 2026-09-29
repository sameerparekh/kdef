import { ApiRequestError } from '../api/client';

export function Loading({ label }: { label: string }) {
  return (
    <div role="status" className="flex items-center gap-3 p-6 text-slate-600">
      <span
        aria-hidden="true"
        className="h-6 w-6 animate-spin rounded-full border-4 border-slate-300 border-t-slate-600"
      />
      <span>{label}</span>
    </div>
  );
}

export function ErrorMessage({ error, what }: { error: unknown; what?: string }) {
  const message =
    error instanceof ApiRequestError || error instanceof Error ? error.message : String(error);
  return (
    <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-800">
      {what ? <strong className="block">{what}</strong> : null}
      {message}
    </div>
  );
}
