// Kontrak tugas hasil Ekstrak dan antrean Router. Pengecualian melekat pada satu tugas dan satu eksekusi pesan,
// sehingga penolakan Agent tidak menghalangi tugas lain atau pesan pelanggan berikutnya.
import { limits } from './definition.js';

export interface ExtractedTask {
  id: string;
  task: string;
  context: string;
}
export interface RoutedTask extends ExtractedTask {
  status: 'pending' | 'completed' | 'unresolved';
  attempts: number;
  exclusions: { agent: string; reason: string }[];
  answer: string;
  agent: string;
}
export function parseTasks(raw: string, max: number = limits.tasks): { tasks: ExtractedTask[] } {
  const value = JSON.parse(
    raw
      .trim()
      .replace(/^```(?:json)?\s*/, '')
      .replace(/\s*```$/, ''),
  );
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    !Array.isArray(value.tasks) ||
    value.tasks.length > max ||
    Object.keys(value).some(k => k !== 'tasks')
  )
    throw Error('ai_invalid_structure');
  return {
    tasks: value.tasks.map((t: unknown, i: number) => {
      if (!t || typeof t !== 'object' || Array.isArray(t)) throw Error('ai_invalid_structure');
      const item = t as Record<string, unknown>;
      if (
        Object.keys(item).sort().join(',') !== 'context,task' ||
        typeof item.task !== 'string' ||
        !item.task.trim() ||
        item.task.length > 1000 ||
        typeof item.context !== 'string' ||
        item.context.length > 2000
      )
        throw Error('ai_invalid_structure');
      return { id: 'task_' + (i + 1), task: item.task.trim(), context: item.context.trim() };
    }),
  };
}
export function taskInstruction(max: number, extra: string) {
  return (
    extra +
    '\nPisahkan pesan terbaru pelanggan menjadi maksimal ' +
    max +
    ' tugas berbeda beserta konteks yang diperlukan dari percakapan. Gabungkan permintaan yang sama; jangan mengarang tugas atau fakta. ' +
    'Salam tetap dapat menjadi satu tugas. Jangan hilangkan permintaan: gabungkan yang terkait bila mencapai batas. ' +
    'Balas JSON {"tasks":[{"task":"permintaan pelanggan","context":"konteks relevan"}]}. Konteks boleh kosong; tasks boleh [] jika tidak ada tugas.'
  );
}
export function taskFormat(max: number) {
  return {
    type: 'json_schema',
    json_schema: {
      name: 'tugas',
      strict: true,
      schema: {
        type: 'object',
        properties: {
          tasks: {
            type: 'array',
            maxItems: max,
            items: {
              type: 'object',
              properties: { task: { type: 'string' }, context: { type: 'string' } },
              required: ['task', 'context'],
              additionalProperties: false,
            },
          },
        },
        required: ['tasks'],
        additionalProperties: false,
      },
    },
  };
}
export function queueTasks(tasks: ExtractedTask[]): RoutedTask[] {
  return tasks.map(t => ({ ...t, status: 'pending', attempts: 0, exclusions: [], answer: '', agent: '' }));
}
