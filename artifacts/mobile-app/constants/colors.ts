/**
 * Semantic design tokens for the mobile app.
 *
 * These tokens mirror the naming conventions used in web artifacts (index.css)
 * so that multi-artifact projects share a cohesive visual identity.
 *
 * Replace the placeholder values below with values that match the project's
 * brand. If a sibling web artifact exists, read its index.css and convert the
 * HSL values to hex so both artifacts use the same palette.
 *
 * To add dark mode, add a `dark` key with the same token names.
 * The useColors() hook will automatically pick it up.
 */

const colors = {
  light: {
    // Legacy aliases (kept for backward compatibility)
    text: '#222222',
    tint: '#d4af37',

    // Core surfaces
    background: '#050505',
    foreground: '#222222',

    // Cards / elevated surfaces
    card: '#ffffff',
    cardForeground: '#222222',

    // Primary action color (buttons, links, active states)
    primary: '#d4af37',
    primaryForeground: '#ffffff',

    // Secondary / less-emphasis interactive surfaces
    secondary: '#eeeeee',
    secondaryForeground: '#333333',

    // Muted / subdued elements (dividers, timestamps, placeholders)
    muted: '#f5f5f5',
    mutedForeground: '#6b5420',

    // Accent highlights (badges, selected items, focus rings)
    accent: '#fffefa',
    accentForeground: '#1f7a1f',

    // Destructive actions (delete, error states)
    destructive: '#8b1c1c',
    destructiveForeground: '#ffffff',

    // Borders and input outlines
    border: '#cccccc',
    input: '#d4af37',
  },

  // Border radius (in px). Sync from the sibling web artifact's --radius
  // CSS variable. This value applies to cards, buttons, inputs, and modals.
  radius: 8,
};

export default colors;
