/**
 * Picker service — hozircha mock; keyin API ulanadi.
 */
import type { PickTask, PickItem } from '../types/picker';

const MOCK_TASK: PickTask = {
  id: 'doc-mock-1',
  reference_number: 'PICK-2026-001',
  status: 'in_progress',
  lines: [
    {
      id: 'line-1',
      product_name: 'Choy qora 100g',
      sku: 'CH-100',
      barcode: '4601234567890',
      location_code: 'A-01-02',
      qty_required: 3,
      qty_picked: 1,
    },
    {
      id: 'line-2',
      product_name: 'Shakar 1kg',
      sku: 'SH-1K',
      barcode: '4601234567891',
      location_code: 'A-02-01',
      qty_required: 2,
      qty_picked: 0,
    },
    {
      id: 'line-3',
      product_name: 'Yog\' 200g',
      sku: 'YG-200',
      barcode: '4601234567892',
      location_code: 'B-01-01',
      qty_required: 4,
      qty_picked: 4,
    },
  ],
};

export async function getPickTask(_taskId: string): Promise<PickTask> {
  await delay(300);
  return JSON.parse(JSON.stringify(MOCK_TASK));
}

export async function pickLine(
  _taskId: string,
  _lineId: string,
  _delta: 1 | -1,
  _requestId: string
): Promise<{ line: PickItem }> {
  await delay(200);
  throw new Error('pickerService.pickLine: API not connected yet');
}

export async function completePickTask(_taskId: string): Promise<void> {
  await delay(400);
  throw new Error('pickerService.completePickTask: API not connected yet');
}

export async function pausePickTask(_taskId: string): Promise<void> {
  await delay(200);
  throw new Error('pickerService.pausePickTask: API not connected yet');
}

export async function cancelPickTask(_taskId: string): Promise<void> {
  await delay(200);
  throw new Error('pickerService.cancelPickTask: API not connected yet');
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
