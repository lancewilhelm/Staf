// Three original, flat vector families. Shape indexes correspond across families.
export const families = [
  {id: 'A', name: 'Rounded shapes', detail: 'Soft silhouettes. A little personality.', shapes: ['Pebble', 'Cushion', 'Capsule']},
  {id: 'B', name: 'Loops and arches', detail: 'Open shapes with a playful bend.', shapes: ['Ring', 'Arch', 'Squiggle']},
  {id: 'C', name: 'Faceted polygons', detail: 'Simple angles. Friendly little faces.', shapes: ['Triangle', 'Pentagon', 'Stone']},
];
export const colors = [
  {name: 'Apricot', hex: '#EFAB78'}, {name: 'Coral', hex: '#EB8D88'},
  {name: 'Marigold', hex: '#E6C368'}, {name: 'Sage', hex: '#A8C79B'},
  {name: 'Lagoon', hex: '#7CC6BD'}, {name: 'Sky', hex: '#8BB8DE'},
  {name: 'Lilac', hex: '#B4A0D6'}, {name: 'Rose', hex: '#D9A0BC'},
];

export function characterSvg(family, shape, color) {
  let body = '', eyeX = 32, eyeY = 32;
  if (family === 'A') {
    body = [
      '<circle cx="32" cy="32" r="26"/>',
      '<rect x="8" y="7" width="48" height="50" rx="15"/>',
      '<rect x="4" y="14" width="56" height="36" rx="18"/>',
    ][shape];
  } else if (family === 'B') {
    body = [
      '<path fill-rule="evenodd" d="M32 4a28 28 0 1 1 0 56 28 28 0 0 1 0-56Zm0 23a10 10 0 1 0 0 20 10 10 0 0 0 0-20Z"/>',
      '<path d="M6 54V31a26 26 0 0 1 52 0v23a4 4 0 0 1-4 4H43a4 4 0 0 1-4-4V32a7 7 0 0 0-14 0v22a4 4 0 0 1-4 4H10a4 4 0 0 1-4-4Z"/>',
      '<path d="M20 5h23a11 11 0 0 1 0 22H27a4 4 0 0 0 0 8h13a12 12 0 0 1 0 24H17a10 10 0 0 1 0-20h13a4 4 0 0 0 0-8H20a13 13 0 0 1 0-26Z"/>',
    ][shape];
    eyeY = [16, 19, 16][shape];
    if (shape === 2) eyeX = 35;
  } else {
    body = [
      '<path d="M28 7q4-7 8 0l25 43q4 8-5 8H8q-9 0-5-8Z"/>',
      '<path d="m29 5 27 18q3 2 2 6l-9 27q-1 3-5 3H20q-4 0-5-3L6 29q-1-4 2-6L29 5q3-2 6 1Z"/>',
      '<path d="m21 5 27 5q3 1 4 4l8 23q1 3-1 6L43 58q-2 2-5 1L11 51q-3-1-4-4L4 24q0-3 2-5L17 7q2-2 4-2Z"/>',
    ][shape];
    eyeY = shape === 0 ? 40 : 33;
  }
  const eyes = `<g fill="#FFFDF7"><ellipse cx="${eyeX - 6}" cy="${eyeY}" rx="4.4" ry="5.8"/><ellipse cx="${eyeX + 6}" cy="${eyeY}" rx="4.4" ry="5.8"/></g><g fill="#253B37"><ellipse cx="${eyeX - 5.2}" cy="${eyeY + .6}" rx="2.1" ry="3"/><ellipse cx="${eyeX + 6.8}" cy="${eyeY + .6}" rx="2.1" ry="3"/></g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" aria-hidden="true"><g fill="${color}">${body}</g>${eyes}</svg>`;
}
