export function countNumberArrayTotal(array: number[]) {
  return array.reduce((sum: number, currentValue: number) => {
    return sum + currentValue;
  });
}

export function createBytesString(baseString: string | number | undefined, byteLength: number) {
  baseString = !baseString ? '' : baseString.toString();
  if (baseString.length > byteLength * 2) {
    throw new Error(
      `Creating of bytes string failed. `
      + `The length of the base string if greater than allowed maximum length. `
      + `The base string: '${baseString}'`
      + `The target byte length: '${byteLength}'`
    );
  }
  if (!/^[0-9a-fA-F]+$/.test(baseString)) {
    throw new Error(
      `Creating of bytes16 string failed. `
      + `The base string content is incorrect `
      + `The base string: '${baseString}'`
    );
  }

  return '0x' + '0'.repeat(byteLength * 2 - baseString.length) + baseString.toLowerCase();
}