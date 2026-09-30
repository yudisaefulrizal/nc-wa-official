// Graf beberapa tugas untuk tes runtime dan browser: Ekstrak → Router → dua Agent → Agent penggabung.
import {
  blankDefinition,
  parseDefinition,
  type GraphNode,
} from '../../../src/components/ai/domain/builder/definition.js';

export function taskGraph() {
  const d = blankDefinition('Layanan beberapa tugas');
  const node = (id: string, type: GraphNode['type'], extra: Partial<GraphNode> = {}): GraphNode => ({
    ...d.nodes[1],
    x: undefined,
    y: undefined,
    id,
    label: id,
    type,
    prompt: '',
    value: '',
    ...extra,
  });
  d.nodes = [
    node('input', 'input'),
    node('extract', 'extract', { extract_mode: 'tasks', max_tasks: 5, tier: 'structured' }),
    node('router', 'router', {
      routing_mode: 'tasks',
      tasks_source: 'extract',
      max_attempts: 3,
      branches: [
        { id: 'info', label: 'Informasi', description: 'Informasi produk' },
        { id: 'service', label: 'Layanan', description: 'Pesanan dan layanan' },
      ],
    }),
    node('info', 'agent', { prompt: 'Jawab informasi produk.', return_to_router: true }),
    node('service', 'agent', { prompt: 'Bantu layanan pelanggan.', return_to_router: true }),
    node('merge', 'agent', {
      prompt: 'Gabungkan hasil {{nodes.router.results}}. Jelaskan tugas unresolved tanpa mengarang.',
    }),
    node('output', 'output'),
  ];
  d.edges = [
    { id: 'e1', source: 'input', port: 'next', target: 'extract' },
    { id: 'e2', source: 'extract', port: 'next', target: 'router' },
    { id: 'e3', source: 'router', port: 'info', target: 'info' },
    { id: 'e4', source: 'router', port: 'service', target: 'service' },
    { id: 'e5', source: 'info', port: 'next', target: 'merge' },
    { id: 'e6', source: 'service', port: 'next', target: 'merge' },
    { id: 'e7', source: 'router', port: 'done', target: 'merge' },
    { id: 'e8', source: 'merge', port: 'next', target: 'output' },
  ];
  return parseDefinition(d);
}
