---
title: CSS Grid Layout
tags: [css, grid, layout, responsive-design, frontend]
sources: [https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_Grid_Layout]
summary: CSS Grid layout system including grid tracks, fr units, template areas, and responsive patterns.
created: 2025-04-10
updated: 2025-08-22
backlinks: []
---

# CSS Grid Layout

CSS Grid is a two-dimensional layout system that allows you to arrange elements in rows and columns simultaneously. Unlike flexbox which is primarily one-dimensional, grid gives you control over both axes at once.

## Defining a Grid

Create a grid container by setting `display: grid` on an element. Define rows and columns using `grid-template-columns` and `grid-template-rows`:

```css
.container {
  display: grid;
  grid-template-columns: 200px 1fr 200px;
  grid-template-rows: auto 1fr auto;
  gap: 16px;
}
```

## The fr Unit

The `fr` (fractional) unit distributes available space proportionally. `1fr 2fr` gives the second column twice the space of the first. The fr unit accounts for gaps and fixed-size tracks before distributing remaining space.

## Grid Template Areas

Named grid areas provide a visual way to define layouts:

```css
.container {
  grid-template-areas:
    "header header header"
    "sidebar main aside"
    "footer footer footer";
}

.header { grid-area: header; }
.sidebar { grid-area: sidebar; }
```

This approach makes the layout intention immediately clear and is easy to modify for different breakpoints.

## Placing Items

Grid items can be placed explicitly using line numbers:

```css
.item {
  grid-column: 1 / 3; /* spans columns 1 and 2 */
  grid-row: 2 / 4;    /* spans rows 2 and 3 */
}
```

You can also use `span` to indicate how many tracks an item should cover: `grid-column: span 2`.

## Auto-placement

When items are not explicitly placed, the auto-placement algorithm fills them in order. The `grid-auto-flow` property controls the direction (row or column) and whether dense packing should be used.

## Responsive Design with Grid

Grid excels at responsive layouts. The `minmax()` function defines minimum and maximum track sizes:

```css
grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
```

This creates as many columns as fit, each at least 250px wide, filling remaining space equally. The `auto-fill` keyword creates empty tracks when there is extra space, while `auto-fit` collapses them.

## Alignment

Grid provides comprehensive alignment control:

- `justify-items` / `align-items`: Align items within their grid area.
- `justify-content` / `align-content`: Align the grid within its container.
- `justify-self` / `align-self`: Override alignment for individual items.

## Subgrid

CSS Subgrid (in modern browsers) allows a nested grid to inherit the track sizing of its parent grid. This enables consistent alignment across nested components without duplicating track definitions.

## Grid vs Flexbox

Use grid for two-dimensional layouts (rows and columns together). Use flexbox for one-dimensional layouts (a row or a column). They complement each other — a grid container can contain flex items and vice versa.
