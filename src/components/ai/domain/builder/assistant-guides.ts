// Pemuat referensi Asisten: kontrak inti selalu ada, detail dipilih dari draft,
// permintaan eksplisit model, dan dependensi usulan. Hanya berkas paket kanonis yang boleh dimuat.
import { nodeTypes, type GraphDefinition } from './definition.js';
import { profileSkillFiles, nodeGuideFile, nodesGuideFile, tasksGuideFile, routerTablesGuideFile } from './skill.js';
import { qualityGuideFile } from './quality-policy.js';
import { dataDesignGuideFile } from './skill-data-design.js';
import {
  requirementsGuideFile,
  architectureGuideFile,
  generationGuideFile,
  reviewGuideFile,
  structuralGuideFile,
  capabilitiesGuideFile,
  mediaGuideFile,
  contextGuideFile,
} from './skill-workflow.js';

export const maxAssistantReferenceLoads = 3;
export const maxReferencesPerLoad = 8;
export const coreGuidePaths = [
  'SKILL.md',
  qualityGuideFile,
  requirementsGuideFile,
  architectureGuideFile,
  generationGuideFile,
  capabilitiesGuideFile,
  'reference/format.md',
  nodesGuideFile,
  structuralGuideFile,
  reviewGuideFile,
];

export function definitionGuidePaths(d: GraphDefinition) {
  const paths = new Set(d.nodes.map(n => nodeGuideFile(n.type)));
  if (d.collections.length || d.nodes.some(n => n.type.startsWith('data_') || n.tools.length))
    paths.add(dataDesignGuideFile);
  if (d.nodes.some(n => n.routing_mode === 'tasks' || n.extract_mode === 'tasks' || n.return_to_router))
    paths.add(tasksGuideFile);
  if (d.nodes.some(n => n.branches.some(b => b.source === 'table'))) paths.add(routerTablesGuideFile);
  if (d.nodes.some(n => ['memory', 'context_memory', 'context'].includes(n.type) || n.memory || n.context_memory))
    paths.add(contextGuideFile);
  if (d.nodes.some(n => ['media', 'receive', 'file_json', 'file_md', 'image_gen'].includes(n.type)))
    paths.add(mediaGuideFile);
  return [...paths];
}

export function createAssistantGuides(d: GraphDefinition, request: string) {
  const files = profileSkillFiles();
  const catalog = new Map(files.map(f => [f.path, f.content]));
  const selected = new Set<string>();
  const add = (paths: string[]) => {
    // Periksa seluruh permintaan sebelum mutasi, termasuk path traversal/URL yang bukan anggota katalog.
    if (paths.some(path => !catalog.has(path))) throw Error('ai_assistant_unknown_reference');
    let changed = false;
    for (const path of paths) {
      if (selected.has(path)) continue;
      selected.add(path);
      changed = true;
      if (path.startsWith('examples/')) {
        const example = JSON.parse(catalog.get(path)!) as GraphDefinition;
        add(definitionGuidePaths(example));
      }
      if (path === tasksGuideFile) add((['extract', 'router', 'agent'] as const).map(nodeGuideFile));
      if (path === routerTablesGuideFile)
        add([dataDesignGuideFile, nodeGuideFile('router'), nodeGuideFile('agent'), nodeGuideFile('data_table')]);
      if (path === contextGuideFile) add((['memory', 'context_memory', 'context'] as const).map(nodeGuideFile));
      if (path.startsWith('reference/nodes/data_')) add([dataDesignGuideFile]);
      if (
        path === nodeGuideFile('media') ||
        path === nodeGuideFile('receive') ||
        path === nodeGuideFile('file_json') ||
        path === nodeGuideFile('file_md') ||
        path === nodeGuideFile('image_gen')
      )
        add([mediaGuideFile]);
    }
    return changed;
  };
  add(coreGuidePaths);
  add(definitionGuidePaths(d));
  // Petunjuk bahasa hanya optimasi awal; katalog permintaan + pemeriksaan usulan menutup sinyal yang tidak dikenali.
  if (/tugas|tasks|antrean/i.test(request)) add([tasksGuideFile]);
  if (/tabel|koleksi|field|column|data_table|data_form|data_text/i.test(request)) add([dataDesignGuideFile]);
  if (/router.*tabel|table.*rout|kapan dipilih/i.test(request)) add([routerTablesGuideFile]);
  if (/gambar|lampiran|media|file|instagram|whatsapp/i.test(request)) add([mediaGuideFile]);
  if (/memori|memory|riwayat|konteks/i.test(request)) add([contextGuideFile]);
  for (const type of nodeTypes) if (request.includes(type)) add([nodeGuideFile(type)]);

  return {
    paths: () => [...selected],
    addDefinition: (definition: GraphDefinition) => add(definitionGuidePaths(definition)),
    load: (paths: string[]) => {
      if (!paths.length || paths.length > maxReferencesPerLoad) throw Error('ai_assistant_invalid_reference_request');
      return add(paths);
    },
    loadAllReferences: () => add(files.filter(f => !f.path.startsWith('examples/')).map(f => f.path)),
    prompt: () =>
      files
        .filter(f => selected.has(f.path))
        .map(f => '===== ' + f.path + ' =====\n' + f.content)
        .join('\n\n') +
      '\n\n## Referensi tambahan yang tersedia\n' +
      files
        .filter(f => !selected.has(f.path))
        .map(f => '- ' + f.path)
        .join('\n') +
      '\nBila kontrak yang diperlukan belum dimuat, balas hanya {"references":["path dari daftar"]} sebelum menyusun usulan. ' +
      'Maksimal ' +
      maxReferencesPerLoad +
      ' path per permintaan dan ' +
      maxAssistantReferenceLoads +
      ' putaran pemuatan. ' +
      'Permintaan ini hanya membaca panduan server, tidak diteruskan ke pemilik. Path harus persis dari katalog; tidak ada akses filesystem/URL bebas. ' +
      'Contoh opsional dipakai setelah kebutuhan dan arsitektur diputuskan, hanya untuk representasi. Jika referensi sudah tersedia, lanjutkan pekerjaan tanpa memintanya ulang.',
  };
}
