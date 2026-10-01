// Menguji kontrak angka, clamp, dan pemisahan kualitas dari prioritas agar optimasi
// tidak dapat menurunkan ambang hasil atau menganggap target yang belum diukur lulus.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  assistantPriorities,
  contextualPriorities,
  evaluateQuality,
  qualityTargets,
  resolvePriorities,
  type ContextMultipliers,
  type QualityTargetId,
} from '../../../src/components/ai/domain/builder/quality-policy.js';

test('The twelve CX targets retain their independent base, range and threshold', () => {
  assert.deepEqual(
    qualityTargets.map(t => [t.basePriority, t.dynamicMin, t.dynamicMax, t.qualityThreshold]),
    [
      [100, 85, 100, 85],
      [98, 80, 100, 80],
      [97, 75, 100, null],
      [95, 65, 100, 75],
      [93, 60, 100, 65],
      [90, 55, 100, 60],
      [88, 55, 100, null],
      [86, 55, 100, null],
      [85, 50, 100, null],
      [82, 40, 100, null],
      [75, 30, 100, null],
      [70, 30, 100, 50],
    ],
  );
  for (const t of resolvePriorities()) {
    assert.equal(t.dynamicPriority, t.basePriority);
    assert.equal(t.contextMultiplier, 1);
  }
  assert.ok(Object.isFrozen(qualityTargets));
  assert.ok(qualityTargets.every(Object.isFrozen));
});

test('Multipliers clamp to each dynamic range, never to the quality threshold', () => {
  for (const multiplier of [0, 0.1, 0.7, 1, 1.1, 2, Number.MAX_VALUE]) {
    const multipliers = Object.fromEntries(qualityTargets.map(t => [t.id, multiplier])) as ContextMultipliers;
    for (const t of resolvePriorities(multipliers)) {
      assert.ok(Number.isFinite(t.dynamicPriority));
      assert.ok(t.dynamicPriority >= t.dynamicMin && t.dynamicPriority <= t.dynamicMax);
      assert.equal(t.qualityThreshold, qualityTargets.find(x => x.id === t.id)!.qualityThreshold);
      if (multiplier === 0) assert.equal(t.dynamicPriority, t.dynamicMin);
      if (multiplier === 2) assert.equal(t.dynamicPriority, t.dynamicMax);
    }
  }
  const context = resolvePriorities({ context_continuity: 0.7 }).find(t => t.id === 'context_continuity')!;
  assert.ok(Math.abs(context.dynamicPriority - 66.5) < 1e-10);
  assert.equal(context.qualityThreshold, 75);
  for (const invalid of [-1, NaN, Infinity, -Infinity])
    assert.throws(() => resolvePriorities({ correctness: invalid }), /invalid_context_multiplier:correctness/);
});

test('Unset thresholds never pass even with perfect scores; known thresholds remain independent', () => {
  const perfect = Object.fromEntries(qualityTargets.map(t => [t.id, 100])) as Record<QualityTargetId, number>;
  assert.equal(evaluateQuality(perfect).status, 'threshold_unset');
  assert.equal(evaluateQuality({}).status, 'threshold_unset');
  for (const t of evaluateQuality({}).targets) {
    assert.equal(t.score, null);
    assert.equal(t.status, t.qualityThreshold === null ? 'threshold_unset' : 'unmeasured');
  }
  for (const t of qualityTargets) {
    if (t.qualityThreshold === null) {
      assert.equal(evaluateQuality(perfect).targets.find(x => x.id === t.id)!.status, 'threshold_unset');
      continue;
    }
    const atThreshold = evaluateQuality({ ...perfect, [t.id]: t.qualityThreshold });
    assert.equal(atThreshold.targets.find(x => x.id === t.id)!.status, 'passed');
    const failed = evaluateQuality({ ...perfect, [t.id]: t.qualityThreshold - 0.01 });
    assert.equal(failed.status, 'failed');
    assert.equal(failed.targets.find(x => x.id === t.id)!.status, 'failed');
  }
  for (const invalid of [-1, 101, NaN, Infinity]) {
    assert.throws(() => evaluateQuality({ relevance: invalid }), /invalid_quality_score:relevance/);
    assert.throws(() => evaluateQuality({ adaptation: invalid }), /invalid_quality_score:adaptation/);
  }
});

test('Context, need, risk and measured deficit contribute independently within the target range', () => {
  const get = (signals: Parameters<typeof contextualPriorities>[0]) =>
    contextualPriorities(signals).find(t => t.id === 'efficiency')!;
  const signals = {
    context: { efficiency: 0.8 },
    need: { efficiency: 1.1 },
    risk: { efficiency: 1.2 },
    scores: { efficiency: 40 },
  };
  assert.ok(Math.abs(get(signals).dynamicPriority - 70 * 0.8 * 1.1 * 1.2 * 1.1) < 1e-10);
  assert.equal(get(signals).qualityThreshold, 50);
  assert.equal(get({ scores: {} }).dynamicPriority, 70);
  assert.equal(get({ scores: { efficiency: 100 } }).dynamicPriority, 70);
  const unknown = contextualPriorities({ scores: { adaptation: 0 } }).find(t => t.id === 'adaptation')!;
  assert.equal(unknown.dynamicPriority, 75);
  assert.equal(unknown.qualityThreshold, null);
  for (const factor of ['context', 'need', 'risk'] as const)
    for (const value of [-1, NaN, Infinity])
      assert.throws(
        () => contextualPriorities({ [factor]: { efficiency: value } }),
        /invalid_priority_signal:efficiency/,
      );
  assert.equal(
    get({ context: { efficiency: Number.MAX_VALUE }, risk: { efficiency: Number.MAX_VALUE } }).dynamicPriority,
    100,
  );
  assert.equal(get({ context: { efficiency: Number.MAX_VALUE }, risk: { efficiency: 0 } }).dynamicPriority, 30);
  assert.deepEqual(contextualPriorities(), resolvePriorities());
});

test('Runtime context adapts priorities without carrying multipliers into the next request', () => {
  const normal = { hasHistory: false, hasTaskRouting: false, repairing: false };
  assert.deepEqual(assistantPriorities(normal), resolvePriorities());
  const busy = assistantPriorities({ hasHistory: true, hasTaskRouting: true, repairing: true, hasWriteTools: true });
  const get = (id: QualityTargetId) => busy.find(t => t.id === id)!;
  assert.ok(get('context_continuity').dynamicPriority > 95);
  assert.ok(Math.abs(get('completeness').dynamicPriority - 99) < 1e-10);
  assert.ok(get('goal_fulfillment').dynamicPriority > 97);
  assert.ok(get('consistency').dynamicPriority > 86);
  assert.ok(get('graceful_recovery').dynamicPriority > 82);
  assert.ok(get('effort_reduction').dynamicPriority > 85);
  assert.ok(get('responsiveness').dynamicPriority > 88);
  assert.equal(get('efficiency').dynamicPriority, 70);
  assert.equal(get('efficiency').qualityThreshold, 50);
  assert.deepEqual(assistantPriorities(normal), resolvePriorities());
});
