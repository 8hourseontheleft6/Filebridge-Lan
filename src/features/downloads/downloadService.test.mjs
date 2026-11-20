import assert from 'node:assert/strict';
import test from 'node:test';

import {
  batchSavedToast,
  browserBatchToast,
  mapSaveError,
  savedToast,
} from './downloadService.ts';

test('a cancellation keeps the original copy and kind', () => {
  assert.deepEqual(mapSaveError('保存已取消'), {
    kind: 'cancelled',
    message: '已取消保存',
  });
});

test('any other save failure maps to the original prefix', () => {
  assert.deepEqual(mapSaveError('磁盘已满'), {
    kind: 'error',
    message: '保存失败：磁盘已满',
  });
  assert.deepEqual(mapSaveError(''), {
    kind: 'error',
    message: '保存失败：',
  });
});

test('a saved file reports whether it already existed', () => {
  assert.deepEqual(savedToast({ path: '/tmp/a.bin', existed: false }), {
    text: '下载完成：/tmp/a.bin',
    kind: 'success',
    path: '/tmp/a.bin',
  });
  assert.deepEqual(savedToast({ path: '/tmp/a.bin', existed: true }), {
    text: '文件已存在，未重复保存：/tmp/a.bin',
    kind: 'success',
    path: '/tmp/a.bin',
  });
});

test('batch and browser summaries keep the counts', () => {
  assert.deepEqual(batchSavedToast(2, 3), { text: '已保存 2/3 个文件', kind: 'success' });
  assert.deepEqual(browserBatchToast(4), {
    text: '已开始下载 4 个文件，请查看浏览器下载列表',
    kind: 'info',
  });
});
