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
    text: '#221E19',
    tint: '#D95D24',
    background: '#FAF6F0',
    foreground: '#221E19',
    card: '#FFFFFF',
    cardForeground: '#221E19',
    primary: '#D95D24',
    primaryForeground: '#FFFFFF',
    secondary: '#F5EFE6',
    secondaryForeground: '#D95D24',
    muted: '#F0EAE1',
    mutedForeground: '#837B70',
    accent: '#D95D24',
    accentForeground: '#FFFFFF',
    destructive: '#D93824',
    destructiveForeground: '#FFFFFF',
    border: '#EAE3D9',
    input: '#EAE3D9',
    success: '#2E8B57',
  },
  dark: {
    text: '#FAF6F0',
    tint: '#E87438',
    background: '#1A1816',
    foreground: '#FAF6F0',
    card: '#24211D',
    cardForeground: '#FAF6F0',
    primary: '#E87438',
    primaryForeground: '#1A1816',
    secondary: '#302B26',
    secondaryForeground: '#FAF6F0',
    muted: '#302B26',
    mutedForeground: '#A09689',
    accent: '#E87438',
    accentForeground: '#1A1816',
    destructive: '#E84A38',
    destructiveForeground: '#1A1816',
    border: '#3D3730',
    input: '#3D3730',
    success: '#4EBA8A',
  },
  radius: 20,
};

export default colors;

