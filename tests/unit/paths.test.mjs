// resolveLocal: where a Markdown link or image points, on Windows and on macOS. Run with `npm run test:unit`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveLocal } from '../../src/lib/paths.ts';

test('Windows: relative paths join the folder and use backslashes', () => {
  const dir = 'C:\\Users\\me\\docs\\';
  assert.equal(resolveLocal(dir, 'img/a.png'), 'C:\\Users\\me\\docs\\img\\a.png');
  assert.equal(resolveLocal(dir, './a.png'), 'C:\\Users\\me\\docs\\a.png');
  assert.equal(resolveLocal(dir, '../a.png'), 'C:\\Users\\me\\a.png');
  assert.equal(resolveLocal(dir, 'My%20Pics/a%2B.png?raw=1#x'), 'C:\\Users\\me\\docs\\My Pics\\a+.png');
});

test('Windows: drive and UNC paths are absolute, and ".." stops at the drive', () => {
  assert.equal(resolveLocal('C:\\docs\\', 'D:\\pics\\a.png'), 'D:\\pics\\a.png');
  assert.equal(resolveLocal('C:\\docs\\', 'file:///D:/pics/a.png'), 'D:\\pics\\a.png');
  assert.equal(resolveLocal('C:\\docs\\', '..\\..\\..\\a.png'), 'C:\\a.png');
  assert.equal(resolveLocal('\\\\srv\\share\\docs\\', '../a.png'), '\\\\srv\\share\\a.png');
});

test('macOS: relative paths join the folder and use slashes', () => {
  const dir = '/Users/me/My Docs/';
  assert.equal(resolveLocal(dir, 'img/a.png'), '/Users/me/My Docs/img/a.png');
  assert.equal(resolveLocal(dir, './a.png'), '/Users/me/My Docs/a.png');
  assert.equal(resolveLocal(dir, '../a.png'), '/Users/me/a.png');
  assert.equal(resolveLocal(dir, 'My%20Pics/a%2B.png?raw=1#x'), '/Users/me/My Docs/My Pics/a+.png');
  assert.equal(resolveLocal(dir, '../../../../../a.png'), '/a.png');
});

test('macOS: absolute paths and file: URLs', () => {
  assert.equal(resolveLocal('/Users/me/docs/', '/tmp/a.png'), '/tmp/a.png');
  assert.equal(resolveLocal('/Users/me/docs/', 'file:///tmp/a%20b.png'), '/tmp/a b.png');
  assert.equal(resolveLocal('', 'file:///tmp/a.png'), '/tmp/a.png'); // an unsaved file can still point at absolute places
  assert.equal(resolveLocal('', '/tmp/a.png'), '/tmp/a.png');
});

test('web addresses, mail links and empty targets are not local files', () => {
  for (const dir of ['C:\\docs\\', '/Users/me/']) {
    assert.equal(resolveLocal(dir, 'https://example.com/a.png'), null);
    assert.equal(resolveLocal(dir, 'mailto:me@example.com'), null);
    assert.equal(resolveLocal(dir, 'data:image/png;base64,AAAA'), null);
    assert.equal(resolveLocal(dir, '#section'), null);
    assert.equal(resolveLocal(dir, ''), null);
  }
});
