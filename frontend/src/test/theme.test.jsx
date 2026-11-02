import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import CardArt from '../components/CardArt';
import { ThemeProvider } from '../theme/ThemeContext';
import ThemePicker from '../theme/ThemePicker';

afterEach(() => {
  delete document.documentElement.dataset.theme;
});

function renderPicker() {
  return render(
    <ThemeProvider>
      <ThemePicker />
    </ThemeProvider>,
  );
}

describe('Theme picker', () => {
  it('starts on the Arcane theme', () => {
    renderPicker();
    expect(screen.getByRole('button', { name: /Theme: Arcane/ })).toBeInTheDocument();
    expect(document.documentElement.dataset.theme).toBe('arcane');
  });

  it('switches theme and remembers the choice', async () => {
    const user = userEvent.setup();
    renderPicker();
    await user.click(screen.getByRole('button', { name: /Theme: Arcane/ }));
    expect(screen.getAllByRole('radio')).toHaveLength(5);
    await user.click(screen.getByRole('radio', { name: /Frost/ }));
    expect(document.documentElement.dataset.theme).toBe('frost');
    expect(localStorage.getItem('tcg.theme')).toBe('frost');
    expect(screen.getByRole('button', { name: /Theme: Frost/ })).toBeInTheDocument();
    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument();
  });

  it('restores a saved theme and ignores unknown values', () => {
    localStorage.setItem('tcg.theme', 'infernal');
    const { unmount } = renderPicker();
    expect(document.documentElement.dataset.theme).toBe('infernal');
    unmount();
    localStorage.setItem('tcg.theme', 'not-a-theme');
    renderPicker();
    expect(document.documentElement.dataset.theme).toBe('arcane');
  });

  it('closes the menu with Escape', async () => {
    const user = userEvent.setup();
    renderPicker();
    await user.click(screen.getByRole('button', { name: /Theme:/ }));
    expect(screen.getByRole('radiogroup')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument();
  });
});

describe('Card art', () => {
  it('draws the same art for the same card and one gem per rarity level', () => {
    const card = { name: 'Ember Fox', type: 'Fire', rarity: 'Epic' };
    const a = render(<CardArt card={card} />).container.querySelector('.ca-scene').innerHTML;
    const b = render(<CardArt card={card} />).container.querySelector('.ca-scene').innerHTML;
    expect(a).toBe(b);
    const legendary = render(<CardArt card={{ ...card, rarity: 'Legendary' }} />).container;
    expect(legendary.querySelectorAll('.ca-gems path')).toHaveLength(4);
  });
});
