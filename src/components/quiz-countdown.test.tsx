import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { formatRemaining, QuizCountdown } from '@/components/quiz-countdown';

afterEach(cleanup);

describe('formatRemaining', () => {
  it('shows whole minutes with padded seconds', () => {
    expect(formatRemaining(90_000)).toBe('1:30');
    expect(formatRemaining(61_000)).toBe('1:01');
  });

  it('clamps negative / expired values to 0:00', () => {
    expect(formatRemaining(0)).toBe('0:00');
    expect(formatRemaining(-5_000)).toBe('0:00');
  });

  it('drops sub-second precision and floors', () => {
    expect(formatRemaining(59_999)).toBe('0:59');
  });
});

describe('QuizCountdown', () => {
  it('says "Time expired" and marks the deadline once it has passed', () => {
    const past = new Date(Date.now() - 5_000).toISOString();
    const onExpire = vi.fn();
    const { unmount } = render(<QuizCountdown expiresAt={past} onExpire={onExpire} />);

    expect(screen.getByText('Time expired')).toBeInTheDocument();

    // Runs its interval — unmount and move on; the initial state is the expiry.
    unmount();
  });

  it('shows the live countdown for a future deadline', () => {
    const future = new Date(Date.now() + 65_000).toISOString();
    render(<QuizCountdown expiresAt={future} />);

    expect(screen.getByRole('timer')).toHaveAttribute('aria-label', 'Time remaining');
    expect(screen.getByText(/^\d+:\d{2}$/)).toBeInTheDocument();
  });
});