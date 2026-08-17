/* DevLab Arcade - khung ứng dụng: hub, điều hướng, lưu điểm, màn hình kết quả.
 * Các game tự đăng ký vào window.DevLabGames trước khi file này chạy.
 */
(function () {
  'use strict';

  var STORAGE_KEY = 'devlab-arcade-v1';
  var THEME_KEY = 'devlab-arcade-theme';

  var RANKS = [
    { min: 0, name: 'Tân binh' },
    { min: 300, name: 'Junior' },
    { min: 800, name: 'Middle' },
    { min: 1600, name: 'Senior' },
    { min: 3000, name: 'Tech Lead' }
  ];

  /* ---------- DOM helper ---------- */
  function h(tag, attrs, children) {
    var node = document.createElement(tag);
    attrs = attrs || {};

    Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v === null || v === undefined || v === false) return;
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k === 'onclick') node.addEventListener('click', v);
      else if (k === 'disabled') node.disabled = !!v;
      else node.setAttribute(k, v);
    });

    (children || []).forEach(function (c) {
      if (c === null || c === undefined || c === false) return;
      node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return node;
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function shuffle(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i];
      a[i] = a[j];
      a[j] = t;
    }
    return a;
  }

  /* ---------- lưu trữ ---------- */
  function loadState() {
    var base = { xp: 0, plays: 0, best: {}, history: [] };
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return base;
      var parsed = JSON.parse(raw);
      return {
        xp: parsed.xp || 0,
        plays: parsed.plays || 0,
        best: parsed.best || {},
        history: parsed.history || []
      };
    } catch (e) {
      return base;
    }
  }

  function saveState(s) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
    } catch (e) {
      /* chế độ riêng tư của trình duyệt có thể chặn - bỏ qua, chỉ mất phần lưu điểm */
    }
  }

  function recordPlay(gameId, score) {
    var s = loadState();
    s.xp += Math.round(score);
    s.plays += 1;
    if (!s.best[gameId] || score > s.best[gameId]) s.best[gameId] = Math.round(score);
    s.history.unshift({ g: gameId, s: Math.round(score), at: Date.now() });
    s.history = s.history.slice(0, 12);
    saveState(s);
    return s;
  }

  function rankOf(xp) {
    var r = RANKS[0];
    RANKS.forEach(function (x) {
      if (xp >= x.min) r = x;
    });
    return r;
  }

  function fmtTime(ts) {
    var d = new Date(ts);
    var p = function (n) { return n < 10 ? '0' + n : '' + n; };
    return p(d.getDate()) + '/' + p(d.getMonth() + 1) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  /* ---------- khung ---------- */
  var games = window.DevLabGames || [];
  var mount = document.getElementById('app');
  var rankChip = document.getElementById('rank-chip');

  function gameById(id) {
    var found = null;
    games.forEach(function (g) { if (g.id === id) found = g; });
    return found;
  }

  function refreshRankChip() {
    var s = loadState();
    clear(rankChip);
    rankChip.appendChild(h('b', { text: rankOf(s.xp).name }));
    rankChip.appendChild(document.createTextNode(' · ' + s.xp + ' XP'));
  }

  /* ---------- màn hình hub ---------- */
  function renderHub() {
    var s = loadState();
    clear(mount);
    refreshRankChip();

    var hero = h('div', { class: 'hero' }, [
      h('h1', { text: 'Luyện phản xạ nghề, mỗi lần 10 phút' }),
      h('p', {
        text:
          'Bốn bài tập dạng game dựa trên tình huống có thật trong quy trình làm việc: review code, ' +
          'đọc spec, thao tác trên production và xử lý sự cố. Chơi solo hoặc chiếu lên màn hình đầu buổi họp team.'
      })
    ]);
    mount.appendChild(hero);

    var grid = h('div', { class: 'game-grid' });
    games.forEach(function (g) {
      var best = s.best[g.id];
      var meta = h('div', { class: 'meta' }, [
        h('span', { class: 'tag', text: g.skill }),
        h('span', { class: 'tag', text: g.duration }),
        best !== undefined ? h('span', { class: 'tag best', text: 'Kỷ lục ' + best }) : null
      ]);

      grid.appendChild(
        h('button', { class: 'game-card', onclick: function () { startGame(g.id); } }, [
          h('div', { class: 'icon', text: g.icon }),
          h('h3', { text: g.name }),
          h('p', { text: g.tagline }),
          meta
        ])
      );
    });
    mount.appendChild(grid);

    var avg = s.history.length
      ? Math.round(s.history.reduce(function (a, x) { return a + x.s; }, 0) / s.history.length)
      : 0;

    mount.appendChild(
      h('div', { class: 'stats-row' }, [
        h('div', { class: 'stat' }, [h('div', { class: 'k', text: 'Cấp bậc' }), h('div', { class: 'v', text: rankOf(s.xp).name })]),
        h('div', { class: 'stat' }, [h('div', { class: 'k', text: 'Tổng XP' }), h('div', { class: 'v', text: String(s.xp) })]),
        h('div', { class: 'stat' }, [h('div', { class: 'k', text: 'Lượt chơi' }), h('div', { class: 'v', text: String(s.plays) })]),
        h('div', { class: 'stat' }, [h('div', { class: 'k', text: 'Điểm TB gần đây' }), h('div', { class: 'v', text: String(avg) })])
      ])
    );

    if (s.history.length) {
      var ul = h('ul');
      s.history.forEach(function (x) {
        var g = gameById(x.g);
        ul.appendChild(
          h('li', {}, [
            h('span', { text: (g ? g.icon + ' ' + g.name : x.g) }),
            h('b', { text: x.s + ' điểm' }),
            h('span', { class: 'when', text: fmtTime(x.at) })
          ])
        );
      });

      mount.appendChild(
        h('div', { class: 'history' }, [
          h('h2', { text: 'Lượt chơi gần đây' }),
          ul,
          h('div', { class: 'btn-row', style: 'margin-top:14px' }, [
            h('button', {
              class: 'btn ghost',
              text: 'Xoá dữ liệu đã lưu',
              onclick: function () {
                if (window.confirm('Xoá toàn bộ điểm và lịch sử đã lưu trên trình duyệt này?')) {
                  try { localStorage.removeItem(STORAGE_KEY); } catch (e) { /* bỏ qua */ }
                  renderHub();
                }
              }
            })
          ])
        ])
      );
    }

    window.scrollTo(0, 0);
  }

  /* ---------- chạy game ---------- */
  function startGame(id) {
    var g = gameById(id);
    if (!g) return renderHub();

    clear(mount);
    var head = h('div', { class: 'game-head' }, [
      h('button', { class: 'btn ghost', text: '← Danh sách game', onclick: renderHub }),
      h('h2', { text: g.icon + '  ' + g.name }),
      h('span', { class: 'sub', text: g.skill })
    ]);
    mount.appendChild(head);

    var body = h('div');
    mount.appendChild(body);
    window.scrollTo(0, 0);

    g.start(body, {
      h: h,
      clear: clear,
      shuffle: shuffle,
      finish: function (result) { showResult(g, result); },
      quit: renderHub,
      replay: function () { startGame(id); }
    });
  }

  /* ---------- màn hình kết quả ---------- */
  function showResult(game, result) {
    var score = Math.max(0, Math.min(100, Math.round(result.score)));
    var state = recordPlay(game.id, score);
    var isBest = state.best[game.id] === score;

    clear(mount);
    refreshRankChip();

    var tone = score >= 80 ? 'good' : score >= 50 ? 'mid' : 'bad';
    var verdict =
      result.verdict ||
      (score >= 90
        ? 'Xuất sắc. Bạn xử lý như người đã gặp tình huống này ngoài đời.'
        : score >= 70
        ? 'Khá tốt. Còn vài điểm đáng đọc kỹ ở phần giải thích bên dưới.'
        : score >= 50
        ? 'Tạm được. Phần sai bên dưới chính là chỗ dễ gây sự cố thật.'
        : 'Còn nhiều điểm cần xem lại. Đọc kỹ giải thích rồi chơi lại một lượt.');

    mount.appendChild(
      h('div', { class: 'result-head' }, [
        h('div', { class: 'score-big ' + tone, text: String(score) }),
        h('div', { class: 'verdict', text: verdict }),
        h('div', { class: 'xp', text: '+' + score + ' XP' + (isBest ? '  ·  kỷ lục mới' : '') })
      ])
    );

    (result.notes || []).forEach(function (n) {
      mount.appendChild(
        h('div', { class: 'callout ' + (n.tone || '') }, [
          h('h4', { text: n.title }),
          h('p', { text: n.body })
        ])
      );
    });

    if (result.breakdown && result.breakdown.length) {
      var ul = h('ul', { class: 'breakdown' });
      result.breakdown.forEach(function (b) {
        ul.appendChild(
          h('li', {}, [
            h('span', { class: 'mark ' + (b.ok ? 'ok' : 'no'), text: b.ok ? '✓' : '✕' }),
            h('span', { text: b.text }),
            h('span', { class: 'pts', text: (b.pts >= 0 ? '+' : '') + b.pts })
          ])
        );
      });
      mount.appendChild(h('div', { class: 'panel' }, [h('h3', { text: 'Chi tiết' }), ul]));
    }

    mount.appendChild(
      h('div', { class: 'btn-row' }, [
        h('button', { class: 'btn primary', text: 'Chơi lại', onclick: function () { startGame(game.id); } }),
        h('button', { class: 'btn', text: 'Game khác', onclick: renderHub })
      ])
    );

    window.scrollTo(0, 0);
  }

  /* ---------- theme ---------- */
  function initTheme() {
    var saved = null;
    try { saved = localStorage.getItem(THEME_KEY); } catch (e) { /* bỏ qua */ }
    if (saved) document.documentElement.setAttribute('data-theme', saved);

    document.getElementById('theme-toggle').addEventListener('click', function () {
      var now = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
      document.documentElement.setAttribute('data-theme', now);
      try { localStorage.setItem(THEME_KEY, now); } catch (e) { /* bỏ qua */ }
    });
  }

  initTheme();
  renderHub();
})();
