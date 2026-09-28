import { useHealth } from '../api/queries';

export function HomePage() {
  const health = useHealth();
  return (
    <main className="mx-auto max-w-3xl p-6">
      <h1 className="text-3xl font-bold">Face Reading Quiz</h1>
      <p className="mt-4 text-slate-600">
        {health.isPending ? (
          <span role="status">Checking server…</span>
        ) : health.isError ? (
          <span className="text-red-700">Server unreachable: {health.error.message}</span>
        ) : (
          <span>{health.data.images} photos loaded.</span>
        )}
      </p>
    </main>
  );
}
