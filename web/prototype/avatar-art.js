// One gallery of rounded shapes and regular polygons, with the same palette and eyes.
export const families = [
  {id: 'A', name: 'Rounded shapes', shapes: ['Circle', 'Rounded square', 'Capsule']},
  {id: 'C', name: 'Regular polygons', shapes: ['Triangle', 'Pentagon', 'Hexagon']},
];
export const colors = [
  {name: 'Apricot', hex: '#EFAB78'}, {name: 'Coral', hex: '#EB8D88'},
  {name: 'Marigold', hex: '#E6C368'}, {name: 'Sage', hex: '#A8C79B'},
  {name: 'Lagoon', hex: '#7CC6BD'}, {name: 'Sky', hex: '#8BB8DE'},
  {name: 'Lilac', hex: '#B4A0D6'}, {name: 'Rose', hex: '#D9A0BC'},
];

export function characterSvg(family, shape, color) {
  let body = '';
  if (family === 'A') {
    body = [
      '<circle cx="32" cy="32" r="26"/>',
      '<rect x="8" y="8" width="48" height="48" rx="15"/>',
      '<rect x="4" y="14" width="56" height="36" rx="18"/>',
    ][shape];
  } else {
    const sides = [3, 5, 6][shape];
    const points = Array.from({length: sides}, (_, index) => {
      const angle = -Math.PI / 2 + index * Math.PI * 2 / sides;
      return `${(32 + 28 * Math.cos(angle)).toFixed(6)},${(32 + 28 * Math.sin(angle)).toFixed(6)}`;
    }).join(' ');
    body = `<polygon points="${points}"/>`;
  }
  const eyes = '<g fill="#000"><circle cx="26" cy="32" r="3.2"/><circle cx="38" cy="32" r="3.2"/></g>';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" aria-hidden="true"><g fill="${color}">${body}</g>${eyes}</svg>`;
}
