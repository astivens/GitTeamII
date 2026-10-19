/**
 * The Spanish dictionary has to mirror the English one exactly: same keys, same
 * kind of value, and the same arguments for every message that takes any.
 *
 * Declaring `es` as `SameShape<Dictionary>` turns a forgotten translation into a
 * compile error instead of a silent fallback, which is the only guard this
 * project has for interface copy.
 */
export type SameShape<T> = {
  [K in keyof T]: T[K] extends (...args: infer A) => string
    ? (...args: A) => string
    : T[K] extends object
      ? SameShape<T[K]>
      : string;
};
