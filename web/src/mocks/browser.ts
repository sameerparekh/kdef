import { setupWorker } from 'msw/browser';
import { createMockApi } from './mockApi';

/** Dev-only. Started from main.tsx when VITE_MOCK_API=true; never enabled implicitly. */
export async function startMockApi(): Promise<void> {
  const api = createMockApi();
  await setupWorker(...api.handlers).start({ onUnhandledRequest: 'error' });
  console.info('[mock] VITE_MOCK_API=true: /api is served by in-memory MSW handlers');
}
