// Profil bersama untuk pengujian kriteria tabel pada Router biasa dan mode beberapa tugas.
import { catalogGraph } from './graph-fixture.js';
import { taskGraph } from './task-graph-fixture.js';

export function routerTableGraph(tasks = false) {
  const catalog = catalogGraph();
  const d = tasks ? taskGraph() : catalog;
  if (tasks) {
    d.collections = catalog.collections;
    d.nodes.push(catalog.nodes.find(n => n.id === 'cari_data')!);
    d.nodes.find(n => n.id === 'info')!.tools = ['cari_data'];
  }
  const router = d.nodes.find(n => n.type === 'router')!;
  router.model = 'typesafe/jev-1';
  Object.assign(router.branches[0], { source: 'table', collection: 'produk' });
  return d;
}
