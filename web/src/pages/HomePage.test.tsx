import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HomePage } from './HomePage';

function renderWithClient() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <HomePage />
    </QueryClientProvider>,
  );
}

describe('HomePage', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('shows a loading state, never a fake count, before data arrives', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise(() => {})),
    );
    renderWithClient();
    expect(screen.getByRole('status')).toHaveTextContent('Checking server');
    expect(screen.queryByText(/photos loaded/)).not.toBeInTheDocument();
  });

  it('shows the photo count once loaded', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ status: 'ok', images: 2938 }))),
    );
    renderWithClient();
    expect(await screen.findByText('2938 photos loaded.')).toBeInTheDocument();
  });
});
