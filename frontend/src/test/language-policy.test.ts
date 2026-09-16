import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const vietnameseCharacters = /[ÀÁẠẢÃÂẦẤẬẨẪĂẰẮẶẲẴÈÉẸẺẼÊỀẾỆỂỄÌÍỊỈĨÒÓỌỎÕÔỒỐỘỔỖƠỜỚỢỞỠÙÚỤỦŨƯỪỨỰỬỮỲÝỴỶỸĐàáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/;

function productionUiFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return productionUiFiles(path);
    return entry.name.endsWith('.tsx') && !path.includes(`${join('src', 'test')}`) ? [path] : [];
  });
}

describe('website language policy', () => {
  it('keeps production website copy in English and excludes em dashes', () => {
    const root = join(import.meta.dirname, '..', '..');
    const files = [...productionUiFiles(join(root, 'src')), join(root, 'index.html')];
    const violations = files.flatMap((file) => {
      const content = readFileSync(file, 'utf8');
      return [
        ...(content.includes(String.fromCodePoint(0x2014)) ? [`${file}: em dash`] : []),
        ...(vietnameseCharacters.test(content) ? [`${file}: Vietnamese text`] : []),
      ];
    });
    expect(violations).toEqual([]);
  });
});
