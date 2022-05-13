export function countNumberArrayTotal(array: number[]) {
  return array.reduce((sum: number, currentValue: number) => {
    return sum + currentValue;
  });
}