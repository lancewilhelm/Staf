import { z } from 'zod';

export type Json = null | boolean | number | string | Json[] | {[key: string]: Json};
export const jsonValue: z.ZodType<Json> = z.lazy(() => z.union([
  z.null(), z.boolean(), z.number().finite(), z.string(), z.array(jsonValue),
  z.unknown().superRefine((value, context) => {
    if (value !== null && typeof value === 'object' && Object.hasOwn(value, '__proto__')) context.addIssue({code: 'custom', message: 'Unsupported JSON property'});
  }).pipe(z.record(z.string(), jsonValue)),
]));
