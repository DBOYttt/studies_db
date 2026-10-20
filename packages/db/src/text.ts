/** English plural with the count: plural(2, 'file', 'files') -> "2 files". */
export function plural(n: number, one: string, many: string): string {
  return `${n} ${Math.abs(n) === 1 ? one : many}`;
}
