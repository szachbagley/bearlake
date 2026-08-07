import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import App from '../src/App.tsx';

describe('App shell', () => {
  it('renders its heading', () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: 'Bear Lake Admin' })).toBeInTheDocument();
  });
});
