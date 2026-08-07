import { render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { RouteErrorBoundary } from '../../src/components/RouteErrorBoundary.tsx';

function Bomb(): never {
  throw new Error('boom');
}

describe('RouteErrorBoundary', () => {
  it('catches a thrown render error and shows a recoverable page instead of crashing', () => {
    // React logs the thrown error to console.error even when a router
    // errorElement catches it — expected noise for this one deliberate test.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const router = createMemoryRouter([
      { path: '/', element: <Bomb />, errorElement: <RouteErrorBoundary /> },
    ]);

    render(<RouterProvider router={router} />);

    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to Bear Lake Admin' })).toBeInTheDocument();

    spy.mockRestore();
  });
});
