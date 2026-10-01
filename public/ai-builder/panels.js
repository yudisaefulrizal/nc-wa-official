// Panel percakapan berdiri sendiri agar memilih node tidak menutup Uji atau Asisten AI.
// Tinggi pengaturan node disimpan sebagai proporsi supaya tetap cocok setelah ukuran layar berubah.
const nodePanel = { ratio: 0.4, collapsed: false, expanded: false, drag: null };
const narrowEditor = matchMedia('(max-width: 900px)');
try {
  const saved = Number(localStorage.getItem('ncwa-node-panel-ratio'));
  if (saved >= 0.2 && saved <= 0.7) nodePanel.ratio = saved;
} catch {}

function showSide(mode, focusMessage = true) {
  state.side = mode;
  $('side').hidden = !mode;
  $('flow').classList.toggle('side-hidden', !mode);
  for (const name of ['tester', 'assistant']) {
    const active = name === mode;
    $(name).hidden = !active;
    $(name + '-tab').setAttribute('aria-selected', String(active));
    $(name + '-tab').tabIndex = active ? 0 : -1;
  }
  $('test-toggle').setAttribute('aria-pressed', String(mode === 'tester'));
  $('assistant-toggle').setAttribute('aria-pressed', String(mode === 'assistant'));
  if (mode) {
    showTab('flow');
    if (focusMessage) $(mode === 'tester' ? 'test-message' : 'assistant-message').focus();
  }
}
for (const [name, toggle] of [
  ['tester', 'test'],
  ['assistant', 'assistant'],
]) {
  $(toggle + '-toggle').onclick = () => showSide(name);
  $('close-' + (name === 'tester' ? 'test' : name)).onclick = () => {
    showSide(null, false);
    $(toggle + '-toggle').focus();
  };
  $(name + '-tab').onclick = () => showSide(name, false);
  $(name + '-tab').onkeydown = e => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    const next =
      e.key === 'Home' ? 'tester' : e.key === 'End' ? 'assistant' : name === 'tester' ? 'assistant' : 'tester';
    showSide(next, false);
    $(next + '-tab').focus();
  };
}

function panelBounds() {
  const height = narrowEditor.matches ? innerHeight : $('flow').clientHeight;
  return { height, min: Math.min(200, height * 0.4), max: Math.max(200, height * 0.7) };
}
function resizeNodePanel() {
  const { height, min, max } = panelBounds();
  if (!height) return;
  const ratio = nodePanel.expanded ? 0.7 : nodePanel.ratio;
  const size = Math.round(Math.max(min, Math.min(max, height * ratio)));
  $('flow').style.setProperty('--node-panel-height', size + 'px');
  $('node-panel-resize').setAttribute('aria-valuemin', String(nodePanel.collapsed ? 48 : Math.round(min)));
  $('node-panel-resize').setAttribute('aria-valuemax', String(Math.round(max)));
  $('node-panel-resize').setAttribute('aria-valuenow', String(nodePanel.collapsed ? 48 : size));
  $('node-panel-resize').setAttribute('aria-valuetext', nodePanel.collapsed ? 'Diciutkan' : size + ' piksel');
}
function renderNodePanel() {
  $('flow').classList.toggle('node-panel-collapsed', nodePanel.collapsed);
  $('inspector').hidden = nodePanel.collapsed;
  const toggle = $('node-panel-toggle');
  toggle.setAttribute('aria-expanded', String(!nodePanel.collapsed));
  toggle.setAttribute('aria-label', nodePanel.collapsed ? 'Buka pengaturan node' : 'Ciutkan pengaturan node');
  toggle.replaceChildren(svgIcon(nodePanel.collapsed ? 'up' : 'down'));
  const expand = $('node-panel-expand');
  expand.hidden = nodePanel.collapsed;
  expand.setAttribute('aria-pressed', String(nodePanel.expanded));
  expand.setAttribute(
    'aria-label',
    nodePanel.expanded ? 'Pulihkan tinggi pengaturan node' : 'Perbesar pengaturan node',
  );
  resizeNodePanel();
}
function openNodeSettings() {
  if (!nodePanel.collapsed) return;
  nodePanel.collapsed = false;
  renderNodePanel();
}
function setNodePanelHeight(size) {
  const { height, min, max } = panelBounds();
  if (!height) return;
  nodePanel.ratio = Math.max(0.2, Math.min(0.7, Math.max(min, Math.min(max, size)) / height));
  nodePanel.expanded = false;
  nodePanel.collapsed = false;
  renderNodePanel();
}
function rememberNodePanelHeight() {
  try {
    localStorage.setItem('ncwa-node-panel-ratio', String(nodePanel.ratio));
  } catch {}
}
$('node-panel-toggle').onclick = () => {
  nodePanel.collapsed = !nodePanel.collapsed;
  renderNodePanel();
};
$('node-panel-expand').onclick = () => {
  nodePanel.expanded = !nodePanel.expanded;
  renderNodePanel();
};
const panelResize = $('node-panel-resize');
panelResize.onpointerdown = e => {
  if (e.button !== 0) return;
  e.preventDefault();
  nodePanel.drag = { y: e.clientY, height: $('node-panel').getBoundingClientRect().height };
  panelResize.setPointerCapture(e.pointerId);
  panelResize.focus();
  $('flow').classList.add('resizing-panel');
};
panelResize.onpointermove = e => {
  if (!nodePanel.drag) return;
  setNodePanelHeight(nodePanel.drag.height + nodePanel.drag.y - e.clientY);
};
panelResize.onlostpointercapture = () => {
  nodePanel.drag = null;
  $('flow').classList.remove('resizing-panel');
  rememberNodePanelHeight();
};
panelResize.onkeydown = e => {
  if (!['ArrowUp', 'ArrowDown', 'Home', 'End', 'Enter'].includes(e.key)) return;
  e.preventDefault();
  if (e.key === 'Enter') {
    nodePanel.collapsed = !nodePanel.collapsed;
    renderNodePanel();
    return;
  }
  const { min, max } = panelBounds();
  const size = nodePanel.collapsed ? min : $('node-panel').getBoundingClientRect().height;
  setNodePanelHeight(e.key === 'Home' ? min : e.key === 'End' ? max : size + (e.key === 'ArrowUp' ? 32 : -32));
  rememberNodePanelHeight();
};
new ResizeObserver(resizeNodePanel).observe($('flow'));
narrowEditor.addEventListener('change', resizeNodePanel);
window.addEventListener('resize', resizeNodePanel);
renderNodePanel();
