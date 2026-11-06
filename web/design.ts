import { reactive, watch } from 'vue';
export const designDefaults = {sidebar: 'expanded', palette: 'green', font: 'sans', body: 14, space: 20, corner: 10} satisfies Design;
export interface Design {sidebar: 'expanded' | 'focus'; palette: 'green' | 'ink'; font: 'sans' | 'system'; body: number; space: number; corner: number}
export function readDesign(): Design {
  const value: Design = {...designDefaults};
  try {
    const saved: unknown = JSON.parse(localStorage.getItem('staf-design') ?? 'null');
    if (!saved || typeof saved !== 'object') return value;
    if ('sidebar' in saved && (saved.sidebar === 'expanded' || saved.sidebar === 'focus')) value.sidebar = saved.sidebar;
    if ('palette' in saved && (saved.palette === 'green' || saved.palette === 'ink')) value.palette = saved.palette;
    if ('font' in saved && (saved.font === 'sans' || saved.font === 'system')) value.font = saved.font;
    for (const [key, min, max] of [['body', 13, 17], ['space', 14, 32], ['corner', 0, 22]] satisfies [keyof Pick<Design, 'body' | 'space' | 'corner'>, number, number][]) {
      if (key in saved) {
        const n = Reflect.get(saved, key);
        if (typeof n === 'number' && Number.isInteger(n) && n >= min && n <= max) value[key] = n;
      }
    }
  } catch { /* Use defaults when browser storage is unavailable. */ }
  return value;
}
export const design = reactive(readDesign());
watch(design, value => {
  const root = document.documentElement;
  root.dataset.palette = value.palette;
  root.dataset.font = value.font;
  for (const key of ['body', 'space', 'corner'] satisfies (keyof Design)[]) root.style.setProperty('--' + key, value[key] + 'px');
  try { localStorage.setItem('staf-design', JSON.stringify(value)); } catch { /* Keep page preferences usable without storage. */ }
}, {immediate: true});
