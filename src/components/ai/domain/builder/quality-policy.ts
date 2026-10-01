// Kontrak target bersama untuk Asisten Builder dan skill unduhan. Prioritas mengatur perhatian;
// ambang kualitas menguji hasil terukur secara terpisah, bukan menjadi batas bawah prioritas.
// null berarti threshold belum ditetapkan, bukan nol. Hanya target yang sama mempertahankan
// threshold sebelumnya; Graceful Recovery tidak otomatis mewarisi angka Resilience.
export const qualityTargets = Object.freeze([
  { id: 'correctness', label: 'Correctness', basePriority: 100, dynamicMin: 85, dynamicMax: 100, qualityThreshold: 85 },
  { id: 'relevance', label: 'Relevance', basePriority: 98, dynamicMin: 80, dynamicMax: 100, qualityThreshold: 80 },
  {
    id: 'goal_fulfillment',
    label: 'Goal Fulfillment',
    basePriority: 97,
    dynamicMin: 75,
    dynamicMax: 100,
    qualityThreshold: null,
  },
  {
    id: 'context_continuity',
    label: 'Context Continuity',
    basePriority: 95,
    dynamicMin: 65,
    dynamicMax: 100,
    qualityThreshold: 75,
  },
  {
    id: 'conversational_quality',
    label: 'Conversational Quality',
    basePriority: 93,
    dynamicMin: 60,
    dynamicMax: 100,
    qualityThreshold: 65,
  },
  {
    id: 'completeness',
    label: 'Completeness',
    basePriority: 90,
    dynamicMin: 55,
    dynamicMax: 100,
    qualityThreshold: 60,
  },
  {
    id: 'responsiveness',
    label: 'Responsiveness',
    basePriority: 88,
    dynamicMin: 55,
    dynamicMax: 100,
    qualityThreshold: null,
  },
  {
    id: 'consistency',
    label: 'Consistency',
    basePriority: 86,
    dynamicMin: 55,
    dynamicMax: 100,
    qualityThreshold: null,
  },
  {
    id: 'effort_reduction',
    label: 'Effort Reduction',
    basePriority: 85,
    dynamicMin: 50,
    dynamicMax: 100,
    qualityThreshold: null,
  },
  {
    id: 'graceful_recovery',
    label: 'Graceful Recovery',
    basePriority: 82,
    dynamicMin: 40,
    dynamicMax: 100,
    qualityThreshold: null,
  },
  { id: 'adaptation', label: 'Adaptation', basePriority: 75, dynamicMin: 30, dynamicMax: 100, qualityThreshold: null },
  { id: 'efficiency', label: 'Efficiency', basePriority: 70, dynamicMin: 30, dynamicMax: 100, qualityThreshold: 50 },
] as const);
// Bekukan juga tiap target agar satu permintaan tidak mengubah prioritas desain permintaan lain.
qualityTargets.forEach(Object.freeze);

export type QualityTargetId = (typeof qualityTargets)[number]['id'];
export type ContextMultipliers = Partial<Record<QualityTargetId, number>>;

export function resolvePriorities(multipliers: ContextMultipliers = {}) {
  return qualityTargets.map(target => {
    const contextMultiplier = multipliers[target.id] ?? 1;
    if (!Number.isFinite(contextMultiplier) || contextMultiplier < 0)
      throw Error('invalid_context_multiplier:' + target.id);
    return {
      ...target,
      contextMultiplier,
      dynamicPriority: Math.min(
        target.dynamicMax,
        Math.max(target.dynamicMin, target.basePriority * contextMultiplier),
      ),
    };
  });
}

// Skor harus disediakan evaluator dengan bukti. Nilai kosong bukan nol maupun lulus;
// fungsi ini tidak menyimpulkan kualitas jawaban dari prioritas atau validitas graf.
export function evaluateQuality(scores: Partial<Record<QualityTargetId, number>>) {
  const targets = qualityTargets.map(target => {
    const score = scores[target.id];
    if (score !== undefined && (!Number.isFinite(score) || score < 0 || score > 100))
      throw Error('invalid_quality_score:' + target.id);
    const status =
      target.qualityThreshold === null
        ? 'threshold_unset'
        : score === undefined
          ? 'unmeasured'
          : score >= target.qualityThreshold
            ? 'passed'
            : 'failed';
    return { id: target.id, qualityThreshold: target.qualityThreshold, score: score ?? null, status };
  });
  return {
    status: targets.some(t => t.status === 'failed')
      ? 'failed'
      : targets.some(t => t.status === 'threshold_unset')
        ? 'threshold_unset'
        : targets.some(t => t.status === 'unmeasured')
          ? 'unmeasured'
          : 'passed',
    targets,
  };
}

export interface PrioritySignals {
  context?: ContextMultipliers;
  need?: ContextMultipliers;
  risk?: ContextMultipliers;
  scores?: Partial<Record<QualityTargetId, number>>;
}

// Need dan Risk berupa faktor dari pemanggil tepercaya. Deficit hanya diturunkan dari
// skor evaluator serta threshold yang tersedia; tidak ada skor buatan dari model/asisten.
export function contextualPriorities(signals: PrioritySignals = {}) {
  const measured = evaluateQuality(signals.scores ?? {});
  const multipliers: ContextMultipliers = {};
  for (const target of qualityTargets) {
    const factors = [signals.context?.[target.id] ?? 1, signals.need?.[target.id] ?? 1, signals.risk?.[target.id] ?? 1];
    if (factors.some(f => !Number.isFinite(f) || f < 0)) throw Error('invalid_priority_signal:' + target.id);
    const score = measured.targets.find(t => t.id === target.id)!.score;
    const deficit =
      score === null || target.qualityThreshold === null ? 0 : Math.max(0, target.qualityThreshold - score) / 100;
    // Jenuh sebelum overflow; clamp akhir tetap memakai rentang target.
    multipliers[target.id] = factors.includes(0)
      ? 0
      : factors.reduce((product, factor) => Math.min(Number.MAX_VALUE, product * factor), 1) * (1 + deficit);
    multipliers[target.id] = Math.min(Number.MAX_VALUE, multipliers[target.id]!);
  }
  return resolvePriorities(multipliers);
}

export interface AssistantPriorityContext {
  hasHistory: boolean;
  hasTaskRouting: boolean;
  repairing: boolean;
  hasWriteTools?: boolean;
}

// Kebijakan awal memakai sinyal struktural dari server. Adanya tool tulis adalah risiko
// potensial pada rancangan, bukan bukti transaksi sedang dijalankan. Skor belum tersedia.
export function assistantPriorities(context: AssistantPriorityContext) {
  return contextualPriorities({
    context: context.hasHistory ? { context_continuity: 1.06, consistency: 1.05 } : {},
    need: {
      ...(context.hasTaskRouting ? { goal_fulfillment: 1.03, completeness: 1.1, effort_reduction: 1.1 } : {}),
      ...(context.repairing ? { graceful_recovery: 1.2, adaptation: 1.15, responsiveness: 1.1 } : {}),
    },
    risk: context.hasWriteTools ? { correctness: 1.1, consistency: 1.15, goal_fulfillment: 1.03 } : {},
  });
}

export function assistantPriorityPrompt(context: AssistantPriorityContext) {
  return (
    '## Prioritas eksekusi saat ini\n' +
    'Target = (BasePriority, DynamicPriority, QualityThreshold). Angka ini dihitung server; bukan skor kualitas hasil. ' +
    'Penuhi batas wajib dan threshold yang ditetapkan, lalu optimalkan pengalaman klien; bila kualitas setara pilih usaha klien lebih kecil, kemudian biaya lebih rendah. Threshold null belum ditetapkan, bukan lulus. ' +
    'Prioritas tidak mengubah kewenangan, batas runtime, atau kontrak format.\n' +
    JSON.stringify(assistantPriorities(context))
  );
}

export const qualityGuideFile = 'principles/quality-policy.md';

export function qualityPolicyMarkdown() {
  return `# Pengalaman klien dan prioritas adaptif

## Objective utama

Meet Constraints → Maximize Client Experience → Minimize Client Effort → Minimize System Cost.

Tujuan klien menentukan capability, capability menentukan agent, dan kondisi menentukan orkestrasi. Pilih kompleksitas minimum yang memenuhi kebutuhan. Jika kualitas secara material setara, pilih usaha klien lebih sedikit; bila pengalaman dan usaha setara, pilih yang lebih sederhana, cepat, dan murah. Biaya meliputi latency, token, model call, tool call, dan komputasi. Responsiveness mengukur pengalaman waktu tunggu klien, Efficiency mengukur resource internal.

## Dua belas target CX

Target = (BasePriority, DynamicPriority, QualityThreshold).

| Target | Base Priority | Rentang Dinamis | Quality Threshold |
| --- | --- | --- | --- |
${qualityTargets.map(t => `| ${t.label} | ${t.basePriority} | ${t.dynamicMin}–${t.dynamicMax} | ${t.qualityThreshold ?? 'Belum ditetapkan'} |`).join('\n')}

BasePriority adalah titik awal desain, bukan prioritas eksekusi yang selalu tetap. DynamicPriority berubah menurut kondisi. QualityThreshold adalah kualitas minimum pada skala 0–100, **bukan prioritas minimum**. Threshold target yang sama dipertahankan dari kontrak sebelumnya; target baru belum memiliki angka. Graceful Recovery tidak otomatis mewarisi threshold Resilience. Jangan mengarang threshold, menganggap null sebagai nol, atau mengklaim semua target lulus.

- Correctness: hasil sesuai data, izin, dan kontrak; jangan mengarang fakta atau keberhasilan tool.
- Relevance: sesuai maksud terbaru klien dan lingkup permintaan.
- Goal Fulfillment: tujuan klien selesai secara end-to-end; keberhasilan satu agent belum membuktikan tujuan selesai.
- Context Continuity: pertahankan keputusan dan informasi yang masih berlaku; koreksi terbaru menggantikan informasi lama yang bertentangan.
- Conversational Quality: natural, jelas, koheren; persona tetap di Perilaku AI klien.
- Completeness: seluruh kebutuhan relevan ditangani tanpa menambah hal yang tidak diminta.
- Responsiveness: interaksi terasa cepat; hindari tahapan dan waktu tunggu yang tidak memberi manfaat.
- Consistency: selesaikan kontradiksi antarhasil dan dengan fakta sebelumnya sebelum menjawab.
- Effort Reduction: gunakan informasi yang sudah tersedia; jangan meminta klien mengulang atau menggabungkan sendiri jawaban agent.
- Graceful Recovery: kegagalan ditangani dengan hasil terbaik yang tersedia dan langkah lanjut jelas, tanpa loop atau halusinasi.
- Adaptation: sesuaikan langkah dengan kebutuhan, risiko, dan keadaan percakapan.
- Efficiency: minimalkan resource setelah kualitas pengalaman dan usaha klien setara.

## Prioritas dinamis

DynamicPriority_i = f(BasePriority_i, Context_i, Need_i, Risk_i, Deficit_i).
Implementasi awal: ContextMultiplier_i = ContextFactor_i × NeedFactor_i × RiskFactor_i × (1 + Deficit_i).
DynamicPriority_i = Clamp(BasePriority_i × ContextMultiplier_i, DynamicMin_i, DynamicMax_i).
Clamp(x, min, max) = Min(max, Max(min, x)). Faktor bawaan 1, harus terbatas dan tidak negatif. Deficit = Max(0, QualityThreshold − MeasuredScore) / 100; tanpa skor atau threshold, tidak ada kontribusi deficit dan kualitas tetap belum diketahui. Deficit dihitung terhadap minimum yang sudah ditetapkan, bukan target ideal yang belum ditentukan.

Context menjelaskan kondisi percakapan; Need kebutuhan target saat ini; Risk dampak kegagalan; Deficit kekurangan kualitas yang terukur. Jangan memakai threshold sebagai batas clamp atau menormalkan jumlah prioritas menjadi 100. Context Continuity ×0.7 menghasilkan prioritas 66.5 tetapi threshold tetap 75. Prioritas rendah tidak mengizinkan kualitas di bawah ambang. Prioritas sama memakai base lebih tinggi sebagai pemecah seri.

Sinyal runtime Asisten Builder saat ini berasal dari server:
- Context: ada riwayat → Context Continuity ×1.06, Consistency ×1.05.
- Need: draft Router tasks → Goal Fulfillment ×1.03, Completeness ×1.1, Effort Reduction ×1.1.
- Need: perbaikan JSON/graf atau retry provider → Graceful Recovery ×1.2, Adaptation ×1.15, Responsiveness ×1.1.
- Risk: draft memiliki tool tulis → Correctness ×1.1, Consistency ×1.15, Goal Fulfillment ×1.03.
- Deficit: API perhitungan mendukung skor evaluator; Asisten belum memiliki evaluator semantik sehingga tidak mengirim skor.

Faktor dihitung dari base setiap panggilan, tidak terakumulasi antarpercobaan. Ini kebijakan awal yang dapat dikalibrasi, bukan bukti peningkatan CX. Di luar editor, gunakan faktor 1 bila tidak ada sinyal yang dapat dibuktikan.

## Urutan keputusan

1. Hard Constraint: eliminasi opsi yang melanggar izin, lingkup akun, kontrak format, pembatalan, batas runtime, atau instruksi pemilik.
2. Quality Threshold: eliminasi opsi yang terbukti menjatuhkan kualitas di bawah ambang, terutama Correctness, Relevance, dan Context Continuity. Kualitas yang belum terukur tetap belum diketahui.
3. Dynamic Priority: tentukan target yang paling dibutuhkan dalam kondisi ini.
4. Trade-off Evaluation: tinjau dampak terhadap seluruh target (delta T), bukan satu skor gabungan yang menutupi kegagalan. Jangan mengorbankan target lebih penting secara tidak proporsional.
5. Goal Fulfillment: cek apakah tujuan klien selesai secara end-to-end, termasuk kebutuhan yang unresolved.
6. Client Effort: bila kualitas hampir sama, pilih yang paling sedikit membebani klien.
7. Efficiency: bila pengalaman klien setara, minimalkan biaya sistem.

Controllability menjadi batas kewenangan, tool, pembatalan, dan Terapkan/Tolak. Observability mendukung penjelasan perubahan, diagnosis, dan evaluasi tanpa membocorkan secret/isi percakapan. Scalability mendukung isolasi akun dan data yang dapat dikonfigurasi. Ketiganya bukan target CX tambahan yang bersaing dengan 12 target di atas.

## Kompleksitas dan evaluasi

Agent adalah unit responsibility/capability, bukan kategori informasi. Tambahkan komponen hanya bila manfaat CX melebihi biaya kompleksitas; satu Agent cukup bila tujuan dapat diselesaikan langsung. Pemilihan Agent dan tabel adalah keputusan terpisah. Ikuti [alur desain bersyarat](../workflow/architecture.md) serta [review semantik/CX](../validation/semantic-cx.md); jangan menjadikan tahap desain sebagai rangkaian model call wajib.

Skor terukur 0–100 dibandingkan dengan threshold secara independen: di bawah failed, sama/lebih tinggi passed, tanpa skor unmeasured, tanpa threshold threshold_unset. Satu target gagal tidak tertutupi skor target lain. Seluruh target tidak boleh dinyatakan passed saat ada threshold_unset atau unmeasured. Validator graf hanya memeriksa struktur, bukan membuktikan pengalaman klien.

Kontrak ini dipakai prompt runtime Asisten Builder dan skill unduhan. Evaluator semantik otomatis, seleksi kandidat berdasarkan delta T, serta routing berbobot engine pelanggan belum diaktifkan. Jangan menambah field skor/prioritas atau tipe node baru ke JSON ncwa-profile versi 1 maupun format balasan editor. Jangan mengklaim hasil pengujian model/kanal nyata tanpa pelaksanaan.
`;
}
