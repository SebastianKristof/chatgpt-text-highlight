import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { shouldUseDarkTheme, getEffectiveTheme, applyTheme } from './active-api.js';

const originalMatchMedia = window.matchMedia;

function setMatchMedia(matches) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: vi.fn().mockImplementation(() => ({
      matches,
      media: '(prefers-color-scheme: dark)',
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    }))
  });
}

function resetThemeMarkers() {
  const root = document.documentElement;
  const body = document.body;

  root.removeAttribute('data-theme');
  root.removeAttribute('data-color-scheme');
  root.removeAttribute('data-ce-copy-md-theme');
  root.removeAttribute('style');
  root.className = '';

  body.removeAttribute('data-theme');
  body.removeAttribute('data-color-scheme');
  body.removeAttribute('style');
  body.className = '';
}

describe('dark mode detection', () => {
  beforeEach(() => {
    resetThemeMarkers();
    setMatchMedia(false);
  });

  afterEach(() => {
    resetThemeMarkers();
  });

  it('detects dark theme from explicit theme attributes', () => {
    document.documentElement.setAttribute('data-theme', 'dark');
    expect(shouldUseDarkTheme()).toBe(true);
  });

  it('detects dark theme from html/body classes', () => {
    document.body.classList.add('theme-dark');
    expect(shouldUseDarkTheme()).toBe(true);
  });

  it('detects dark theme from computed color-scheme', () => {
    document.documentElement.style.setProperty('color-scheme', 'dark');
    expect(shouldUseDarkTheme()).toBe(true);
  });

  it('detects dark theme from dark background luminance', () => {
    document.body.style.backgroundColor = 'rgb(15, 15, 15)';
    expect(shouldUseDarkTheme()).toBe(true);
  });

  it('does not treat transparent background as dark by itself', () => {
    document.documentElement.style.backgroundColor = 'transparent';
    document.body.style.backgroundColor = 'transparent';
    expect(shouldUseDarkTheme()).toBe(false);
  });

  it('falls back to prefers-color-scheme when no host dark markers exist', () => {
    setMatchMedia(true);
    expect(shouldUseDarkTheme()).toBe(true);
  });
});

describe('theme resolution and application', () => {
  beforeEach(() => {
    resetThemeMarkers();
    setMatchMedia(false);
  });

  afterEach(() => {
    resetThemeMarkers();
  });

  it('getEffectiveTheme respects explicit light/dark settings', () => {
    document.documentElement.setAttribute('data-theme', 'dark');
    expect(getEffectiveTheme('light')).toBe('light');
    expect(getEffectiveTheme('dark')).toBe('dark');
  });

  it('getEffectiveTheme resolves auto from host theme detection', () => {
    document.documentElement.classList.add('dark');
    expect(getEffectiveTheme('auto')).toBe('dark');
  });

  it('applyTheme sets root data attribute for auto', () => {
    document.body.classList.add('dark');
    applyTheme('auto');
    expect(document.documentElement.getAttribute('data-ce-copy-md-theme')).toBe('dark');
  });

  it('applyTheme sets root data attribute for explicit mode', () => {
    applyTheme('light');
    expect(document.documentElement.getAttribute('data-ce-copy-md-theme')).toBe('light');
  });
});

afterEach(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: originalMatchMedia
  });
});
