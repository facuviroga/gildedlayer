const PAGE_SIZE = 60;

// Strips marketing/format/term boilerplate from raw Gumroad titles so cards
// show just the character/model name. Kept in JS (not the fetcher) so a rule
// change doesn't require a re-fetch.
const CLEAN_RULES = [
  // Creator-specific prefixes (case-insensitive).
  /^\s*(wicked\s+(marvel|movies|video\s+games?|video\s+game))\b[\s:.\-—]*/i,
  /^\s*(wicked|b3dserk)\b[\s:.\-—]*/i,
  // Brand abbreviations that may appear anywhere in the title.
  /\bzcf\b[\s:.\-—]*/gi,
  // Term markers in any common ordering.
  /\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+term\s+\d{4}\b[\s:.\-—]*/gi,
  /\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{4}\s+term\b[\s:.\-—]*/gi,
  /\bterm\s+\d{4}\b[\s:.\-—]*/gi,
  // "(Tested and) ready for (3D) printing" boilerplate.
  /[,:.\-—]?\s*(?:tested and )?ready for (?:3d )?printing\b/gi,
  /[,:.\-—]?\s*for 3d printing\b/gi,
  // 3D PRINT / STL format tags.
  /[,:.\-—]?\s*\b3d\s*prints?\b/gi,
  /[,:.\-—]?\s*\bstls?\b/gi,
  // Scale notations: "1/4", "1/6 scale", "1:1 scale".
  /\s*\b\d+\s*\/\s*\d+(\s*scale)?\b/gi,
  /\s*\b\d+:\d+\s*scale\b/gi,
  // "3d Sculpture" → "Sculpture" (keep type word, drop the redundant 3d).
  [/\b3d\s+(sculpture|bust|figure|statue|model|diorama)\b/gi, '$1'],
];

function cleanTitle(raw) {
  if (!raw) return '';
  let s = String(raw);
  for (const rule of CLEAN_RULES) {
    if (Array.isArray(rule)) s = s.replace(rule[0], rule[1]);
    else s = s.replace(rule, '');
  }
  s = s.replace(/\s+/g, ' ').trim();
  s = s.replace(/^[\s:.\-,—–]+|[\s:.\-,—–]+$/g, '').trim();
  // Title-case ALL-CAPS titles like "MICKEY MOUSE" → "Mickey Mouse".
  if (s && s === s.toUpperCase() && /[A-Z]{3}/.test(s)) {
    s = s.toLowerCase().replace(/\b([a-z])/g, (_, c) => c.toUpperCase());
  }
  return s || raw;
}

const state = {
  models: [],
  activeFeatured: 'all',
  activeTag: null,
  activeCreator: null,
  search: '',
  rendered: 0,
  filteredCache: [],
};

let scrollObserver = null;

const $gallery = document.getElementById('gallery');
const $tagFilters = document.getElementById('tag-filters');
const $creatorFilters = document.getElementById('creator-filters');
const $search = document.getElementById('search');
const $tagSearch = document.getElementById('tag-search');
const $tagClear = document.getElementById('tag-clear');
const $tagSection = document.getElementById('tag-section');
const $tagToggle = document.getElementById('tag-toggle');
const $creatorClear = document.getElementById('creator-clear');
const $lastRefresh = document.getElementById('last-refresh');

async function load() {
  try {
    const res = await fetch('./data/models.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error('models.json missing');
    const data = await res.json();
    state.models = data.models || [];
    if (data.generated_at) {
      $lastRefresh.textContent = new Date(data.generated_at).toLocaleString('es');
    }
    buildFilters();
    render();
  } catch (err) {
    $gallery.innerHTML = `<p class="empty">No se cargaron esculturas todavía. Revisá <code>data/creators.yaml</code>.</p>`;
    console.error(err);
  }
}

function buildFilters() {
  // Count occurrences for each tag/creator so we can sort by usage.
  const tagCount = new Map();
  const creatorCount = new Map();
  for (const m of state.models) {
    (m.tags || []).forEach(t => tagCount.set(t, (tagCount.get(t) || 0) + 1));
    if (m.creator) creatorCount.set(m.creator, (creatorCount.get(m.creator) || 0) + 1);
  }

  // Tags: most-used first, then alphabetical. Show count on each chip.
  $tagFilters.innerHTML = '';
  const sortedTags = [...tagCount.entries()].sort((a, b) =>
    b[1] - a[1] || a[0].localeCompare(b[0])
  );
  for (const [tag, count] of sortedTags) {
    const btn = document.createElement('button');
    btn.className = 'chip';
    btn.dataset.tag = tag;
    btn.innerHTML = '#' + escapeHtml(tag) + ' <span class="chip-count">' + count + '</span>';
    btn.addEventListener('click', () => {
      state.activeTag = state.activeTag === tag ? null : tag;
      syncChips();
      render();
    });
    $tagFilters.appendChild(btn);
  }

  // Sculptors: alphabetical with count.
  $creatorFilters.innerHTML = '';
  const sortedCreators = [...creatorCount.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  for (const [c, count] of sortedCreators) {
    const btn = document.createElement('button');
    btn.className = 'chip';
    btn.dataset.creator = c;
    btn.innerHTML = escapeHtml(c) + ' <span class="chip-count">' + count + '</span>';
    btn.addEventListener('click', () => {
      state.activeCreator = state.activeCreator === c ? null : c;
      syncChips();
      render();
    });
    $creatorFilters.appendChild(btn);
  }
}

function applyTagSearchFilter() {
  const q = ($tagSearch.value || '').trim().toLowerCase();
  for (const btn of $tagFilters.querySelectorAll('.chip')) {
    btn.classList.toggle('is-hidden', q && !btn.dataset.tag.toLowerCase().includes(q));
  }
  // Auto-expand when the user is searching so matches aren't cut off.
  if (q) setTagExpanded(true);
}

function setTagExpanded(expanded) {
  $tagSection.classList.toggle('is-expanded', expanded);
  $tagToggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
  $tagToggle.textContent = expanded ? 'Ver menos' : 'Ver todas';
}

function syncChips() {
  document.querySelectorAll('[data-filter-kind="featured"]').forEach(b => {
    b.classList.toggle('is-active', b.dataset.filterValue === state.activeFeatured);
  });
  document.querySelectorAll('[data-tag]').forEach(b => {
    b.classList.toggle('is-active', b.dataset.tag === state.activeTag);
  });
  document.querySelectorAll('[data-creator]').forEach(b => {
    b.classList.toggle('is-active', b.dataset.creator === state.activeCreator);
  });
  $tagClear.hidden = !state.activeTag;
  $creatorClear.hidden = !state.activeCreator;
}

function filtered() {
  const q = state.search.trim().toLowerCase();
  return state.models.filter(m => {
    if (state.activeFeatured === 'featured' && !m.featured) return false;
    if (state.activeTag && !(m.tags || []).includes(state.activeTag)) return false;
    if (state.activeCreator && m.creator !== state.activeCreator) return false;
    if (q) {
      const hay = `${m.title || ''} ${m.creator || ''} ${(m.tags || []).join(' ')} ${m.description || ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function render() {
  if (scrollObserver) { scrollObserver.disconnect(); scrollObserver = null; }
  state.filteredCache = filtered();
  state.rendered = 0;
  $gallery.innerHTML = '';
  if (!state.filteredCache.length) {
    $gallery.innerHTML = `
      <div class="empty empty-with-cta">
        <p>Ninguna escultura coincide con los filtros.</p>
        <p class="empty-sub">¿Tenés algo específico en mente? <a href="https://ig.me/m/gildedlayer" target="_blank" rel="noopener">Escribime por Instagram y vemos cómo conseguirlo →</a></p>
      </div>`;
    return;
  }
  renderNextBatch();
}

function renderNextBatch() {
  const list = state.filteredCache;
  const start = state.rendered;
  const end = Math.min(start + PAGE_SIZE, list.length);
  if (start >= end) return;

  // Remove the old sentinel before appending new cards.
  const oldSentinel = $gallery.querySelector('.scroll-sentinel');
  if (oldSentinel) oldSentinel.remove();

  const frag = document.createDocumentFragment();
  const wrapper = document.createElement('div');
  wrapper.innerHTML = list.slice(start, end).map(cardHTML).join('');
  while (wrapper.firstChild) {
    const node = wrapper.firstChild;
    if (node.classList && node.classList.contains('card')) {
      node.addEventListener('click', () => openLightbox(node.dataset.id));
    }
    frag.appendChild(node);
  }
  $gallery.appendChild(frag);
  state.rendered = end;

  if (state.rendered < list.length) {
    const sentinel = document.createElement('div');
    sentinel.className = 'scroll-sentinel';
    sentinel.setAttribute('aria-hidden', 'true');
    $gallery.appendChild(sentinel);
    if (!scrollObserver) {
      scrollObserver = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            renderNextBatch();
            break;
          }
        }
      }, { rootMargin: '600px 0px' });
    }
    scrollObserver.observe(sentinel);
  }
}

function cardHTML(m) {
  const tags = (m.tags || []).map(t => `<span>#${t}</span>`).join('');
  const display = cleanTitle(m.title) || 'Sin título';
  return `
    <article class="card" data-id="${escapeHtml(m.id)}">
      ${m.featured ? '<span class="card-badge">⭐ Featured</span>' : ''}
      <img src="${escapeHtml(m.image)}" alt="${escapeHtml(display)}" loading="lazy" />
      <div class="card-meta">
        <p class="card-title">${escapeHtml(display)}</p>
        ${tags ? `<div class="card-tags">${tags}</div>` : ''}
      </div>
    </article>`;
}

function openLightbox(id) {
  const m = state.models.find(x => x.id === id);
  if (!m) return;
  const display = cleanTitle(m.title) || 'Sin título';
  document.getElementById('lightbox-img').src = m.image;
  document.getElementById('lightbox-img').alt = display;
  document.getElementById('lightbox-title').textContent = display;
  document.getElementById('lightbox-creator').textContent = '';
  document.getElementById('lightbox-desc').textContent = m.description || '';

  // Wire the commission CTA to copy a model-specific message before
  // opening IG (Instagram doesn't support DM prefill via URL).
  const $commission = document.getElementById('lightbox-commission');
  $commission.onclick = (e) => {
    e.preventDefault();
    const msg = `¡Hola! Vi tu galería de GildedLayer y me interesa esta pieza: ${display}`;
    copyAndOpenInstagram(msg);
  };

  document.getElementById('lightbox').hidden = false;
  document.body.style.overflow = 'hidden';
}

async function copyAndOpenInstagram(message) {
  let copied = false;
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(message);
      copied = true;
    }
  } catch (e) {
    console.warn('clipboard write failed', e);
  }
  window.open('https://ig.me/m/gildedlayer', '_blank', 'noopener');
  if (copied) {
    showToast('✓ Mensaje copiado — pegalo en el chat de Instagram', 3000);
  } else {
    showToast('No pude copiar automáticamente. Pegá: ' + message, 6500);
  }
}

function showToast(text, ms = 2400) {
  let t = document.getElementById('toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'toast';
    t.className = 'toast';
    t.setAttribute('role', 'status');
    document.body.appendChild(t);
  }
  t.textContent = text;
  t.classList.add('is-visible');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('is-visible'), ms);
}

function closeLightbox() {
  document.getElementById('lightbox').hidden = true;
  document.body.style.overflow = '';
}

document.querySelector('.lightbox-close').addEventListener('click', closeLightbox);
document.getElementById('lightbox').addEventListener('click', (e) => {
  if (e.target.id === 'lightbox') closeLightbox();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeLightbox();
});

document.querySelectorAll('[data-filter-kind="featured"]').forEach(btn => {
  btn.addEventListener('click', () => {
    state.activeFeatured = btn.dataset.filterValue;
    syncChips();
    render();
  });
});

$search.addEventListener('input', (e) => {
  state.search = e.target.value;
  render();
});

$tagSearch.addEventListener('input', applyTagSearchFilter);

$tagToggle.addEventListener('click', () => {
  const expanded = $tagSection.classList.contains('is-expanded');
  setTagExpanded(!expanded);
});

$tagClear.addEventListener('click', () => {
  state.activeTag = null;
  syncChips();
  render();
});

$creatorClear.addEventListener('click', () => {
  state.activeCreator = null;
  syncChips();
  render();
});

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

load();
