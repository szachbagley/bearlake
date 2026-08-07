import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Modal } from '../../src/components/Modal.tsx';

/** A trigger button + conditionally-rendered Modal, matching how every real
 * caller uses it — needed to assert focus returns to the actual trigger. */
function Harness({ onClose }: { onClose?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button onClick={() => setOpen(true)}>Open</button>
      {open && (
        <Modal
          title="Test modal"
          onClose={() => {
            setOpen(false);
            onClose?.();
          }}
        >
          <button>First</button>
          <button>Second</button>
        </Modal>
      )}
    </div>
  );
}

describe('Modal', () => {
  it('moves focus inside itself on open', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole('button', { name: 'Open' }));

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(document.activeElement).toHaveAccessibleName('Close');
  });

  it('closes on Escape', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole('button', { name: 'Open' }));
    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('restores focus to the trigger on close', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const trigger = screen.getByRole('button', { name: 'Open' });
    await user.click(trigger);
    await user.keyboard('{Escape}');

    expect(document.activeElement).toBe(trigger);
  });

  it('traps Tab within the dialog, wrapping from the last focusable element to the first', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole('button', { name: 'Open' }));
    const closeButton = screen.getByRole('button', { name: 'Close' });
    const second = screen.getByRole('button', { name: 'Second' });

    second.focus();
    await user.tab();

    expect(document.activeElement).toBe(closeButton);
  });

  it('calls onClose exactly once when the overlay is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const { container } = render(<Harness onClose={onClose} />);

    await user.click(screen.getByRole('button', { name: 'Open' }));
    const overlay = container.querySelector('.modal-overlay');
    if (overlay === null) throw new Error('overlay not found');
    await user.click(overlay);

    expect(onClose).toHaveBeenCalledOnce();
  });
});
