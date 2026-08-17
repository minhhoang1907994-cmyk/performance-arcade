/* PROD Roulette - kịch bản phân nhánh về thao tác trên môi trường production. */
(function () {
  'use strict';

  window.DevLabGames = window.DevLabGames || [];
  window.DevLabGames.push({
    id: 'prod-roulette',
    icon: '☠️',
    name: 'PROD Roulette',
    tagline: 'Từng bước thao tác trên production. Mỗi lựa chọn cộng điểm rủi ro, và có những nước đi không rút lại được.',
    skill: 'An toàn production',
    duration: '~4 phút',

    start: function (mount, api) {
      var h = api.h;
      var clear = api.clear;

      var scenarios = window.PROD_ROULETTE_SCENARIOS || [];

      function renderPicker() {
        clear(mount);
        mount.appendChild(h('div', { class: 'section-title', text: 'Chọn tình huống' }));

        var grid = h('div', { class: 'game-grid' });
        scenarios.forEach(function (sc) {
          grid.appendChild(
            h('button', { class: 'game-card', onclick: function () { play(sc); } }, [
              h('h3', { text: sc.title }),
              h('p', { text: sc.brief })
            ])
          );
        });
        mount.appendChild(grid);
      }

      function play(sc) {
        var path = [];
        var risk = 0;

        function renderNode(nodeId) {
          var node = sc.nodes[nodeId];
          clear(mount);

          if (node.end) return renderEnd(node);

          mount.appendChild(
            h('div', { class: 'budget-bar' }, [
              h('span', { class: 'tag', text: sc.title }),
              h('span', { class: 'tag', text: 'Bước ' + (path.length + 1) }),
              h('span', { class: 'tag', text: 'Rủi ro tích luỹ: ' + risk })
            ])
          );

          var panel = h('div', { class: 'panel' });
          panel.appendChild(h('p', { text: node.text }));

          var list = h('div', { class: 'opt-list' });
          var btns = [];
          api.shuffle(node.options).forEach(function (o) {
            var btn = h('button', { class: 'opt', type: 'button' }, [h('span', { text: o.t })]);
            btn.addEventListener('click', function () {
              btns.forEach(function (b) { b.disabled = true; });
              btn.classList.add(o.risk === 0 ? 'right' : o.risk >= 30 ? 'wrong' : 'picked');
              btn.appendChild(h('span', { class: 'why', text: o.feedback }));

              risk += o.risk;
              path.push({ step: node.text, choice: o.t, risk: o.risk, feedback: o.feedback });

              panel.appendChild(
                h('div', { class: 'btn-row', style: 'margin-top:14px' }, [
                  h('button', { class: 'btn primary', text: 'Tiếp tục →', onclick: function () { renderNode(o.next); } }),
                  h('span', { class: 'sub', text: o.risk === 0 ? 'Không phát sinh rủi ro' : '+' + o.risk + ' điểm rủi ro' })
                ])
              );
              panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            });
            btns.push(btn);
            list.appendChild(btn);
          });

          panel.appendChild(list);
          mount.appendChild(panel);
          window.scrollTo(0, 0);
        }

        function renderEnd(node) {
          var score = Math.max(0, 100 - risk);
          api.finish({
            score: score,
            verdict: node.title,
            notes: [
              { tone: node.tone === 'good' ? 'good' : node.tone === 'bad' ? 'bad' : '', title: node.title, body: node.verdict }
            ],
            breakdown: path.map(function (p, i) {
              return { ok: p.risk === 0, text: 'Bước ' + (i + 1) + ' · ' + p.choice, pts: -p.risk };
            })
          });
        }

        clear(mount);
        mount.appendChild(
          h('div', { class: 'panel' }, [
            h('h3', { text: sc.title }),
            h('p', { text: sc.brief }),
            h('p', { class: 'hint', text: 'Bắt đầu với 100 điểm. Mỗi lựa chọn rủi ro sẽ trừ đi.' }),
            h('div', { class: 'btn-row' }, [
              h('button', { class: 'btn primary', text: 'Bắt đầu', onclick: function () { renderNode(sc.start); } }),
              h('button', { class: 'btn ghost', text: 'Chọn tình huống khác', onclick: renderPicker })
            ])
          ])
        );
      }

      if (!scenarios.length) {
        mount.appendChild(h('div', { class: 'panel' }, [h('p', { text: 'Chưa có kịch bản nào trong ngân hàng dữ liệu.' })]));
        return;
      }
      renderPicker();
    }
  });
})();
