# Field Hours

## UI changes

- Use the U.S. Web Design System (USWDS) for UI changes, including custom layouts such as the bottom sheet. Follow the official guidance. [Components](https://designsystem.digital.gov/components/overview/) · [Patterns](https://designsystem.digital.gov/patterns/) · [Design tokens](https://designsystem.digital.gov/design-tokens/) · [Accessibility](https://designsystem.digital.gov/documentation/accessibility/)
- Reuse the local tokens and component styles in [src/styles.css](src/styles.css) and the markup patterns in [index.html](index.html). Bundle UI assets with the app so they work offline.
- Design for phones first and adapt the layout for desktop. Use labeled, keyboard-operable controls, visible focus, and text for status. Keep the manual zone picker available as a keyboard-accessible alternative to the map.
- Verify UI changes at phone and desktop widths and with keyboard navigation. Use the production preview to check changes that affect offline use.
