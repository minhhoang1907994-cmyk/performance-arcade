/* Incident Escape Room - điều tra sự cố trong giới hạn thời gian giả lập. */
(function () {
  'use strict';

  window.DevLabGames = window.DevLabGames || [];
  window.DevLabGames.push({
    id: 'incident',
    icon: '🚨',
    name: 'Incident Escape Room',
    tagline: 'Sự cố đang diễn ra, mỗi hành động điều tra tốn thời gian. Tìm đúng nguyên nhân trước khi hết giờ.',
    skill: 'Xử lý sự cố',
    duration: '~6 phút',

    start: function (mount, api) {
      var h = api.h;
      var clear = api.clear;

      var scenarios = window.INCIDENT_SCENARIOS || [];

      function renderPicker() {
        clear(mount);
        mount.appendChild(h('div', { class: 'section-title', text: 'Chọn sự cố' }));

        var grid = h('div', { class: 'game-grid' });
        scenarios.forEach(function (sc) {
          grid.appendChild(
            h('button', { class: 'game-card', onclick: function () { play(sc); } }, [
              h('h3', { text: sc.title }),
              h('p', { text: sc.brief }),
              h('div', { class: 'meta' }, [
                h('span', { class: 'tag', text: 'Mức độ: ' + sc.severity }),
                h('span', { class: 'tag', text: 'Ngân sách ' + sc.budget + ' phút' })
              ])
            ])
          );
        });
        mount.appendChild(grid);
      }

      function play(sc) {
        var spent = 0;
        var done = {};
        var log = [];

        /* xáo một lần khi vào kịch bản: manh mối quyết định không phải lúc nào cũng nằm ở đầu danh sách */
        var actions = api.shuffle(sc.actions);
        var totalKeys = sc.actions.filter(function (a) { return a.key; }).length;

        function remain() { return sc.budget - spent; }

        function renderBoard() {
          clear(mount);

          var r = remain();
          var clockCls = 'clock' + (r <= 0 ? ' out' : r <= sc.budget * 0.3 ? ' low' : '');

          mount.appendChild(
            h('div', { class: 'budget-bar' }, [
              h('span', { class: 'tag', text: sc.title }),
              h('span', { class: clockCls, text: (r > 0 ? r : 0) + ' phút' }),
              h('span', { class: 'sub', text: r > 0 ? 'còn lại trong ngân sách điều tra' : 'đã vượt ngân sách — điểm thời gian bằng 0' })
            ])
          );

          mount.appendChild(h('div', { class: 'panel' }, [h('h3', { text: 'Tình hình' }), h('p', { text: sc.brief })]));

          /* danh sách hành động */
          var actPanel = h('div', { class: 'panel' });
          actPanel.appendChild(h('h3', { text: 'Hành động điều tra' }));
          actPanel.appendChild(
            h('p', { class: 'hint', text: 'Mỗi hành động tốn thời gian và chỉ làm được một lần. Chọn thứ tự cho khôn.' })
          );

          var list = h('div', { class: 'action-list' });
          actions.forEach(function (a) {
            var used = !!done[a.id];
            var btn = h('button', { class: 'action' + (used ? ' done' : ''), type: 'button', disabled: used }, [
              h('span', { text: a.label }),
              h('span', { class: 'cost', text: a.cost + ' phút' })
            ]);
            btn.addEventListener('click', function () {
              done[a.id] = true;
              spent += a.cost;
              log.unshift({ label: a.label, result: a.result, key: !!a.key });
              renderBoard();
            });
            list.appendChild(btn);
          });
          actPanel.appendChild(list);
          actPanel.appendChild(
            h('div', { class: 'btn-row', style: 'margin-top:16px' }, [
              h('button', { class: 'btn primary', text: 'Kết luận nguyên nhân →', onclick: renderConclusion }),
              h('button', { class: 'btn ghost', text: 'Bỏ, chọn sự cố khác', onclick: renderPicker })
            ])
          );
          mount.appendChild(actPanel);

          /* nhật ký */
          var logPanel = h('div', { class: 'panel' });
          logPanel.appendChild(h('h3', { text: 'Nhật ký điều tra' }));
          if (!log.length) {
            logPanel.appendChild(h('p', { class: 'log-empty', text: 'Chưa thực hiện hành động nào.' }));
          } else {
            var logBox = h('div', { class: 'log' });
            log.forEach(function (l) {
              logBox.appendChild(
                h('div', { class: 'log-entry' + (l.key ? ' key' : '') }, [
                  h('b', { text: l.label }),
                  h('span', { text: l.result })
                ])
              );
            });
            logPanel.appendChild(logBox);
          }
          mount.appendChild(logPanel);
        }

        function renderConclusion() {
          clear(mount);
          mount.appendChild(
            h('div', { class: 'budget-bar' }, [
              h('span', { class: 'tag', text: sc.title }),
              h('span', { class: 'tag', text: 'Đã dùng ' + spent + '/' + sc.budget + ' phút' })
            ])
          );

          var panel = h('div', { class: 'panel' });
          panel.appendChild(h('h3', { text: 'Nguyên nhân gốc là gì?' }));
          panel.appendChild(h('p', { class: 'hint', text: 'Chọn một. Sau khi chọn sẽ không quay lại điều tra được nữa.' }));

          var list = h('div', { class: 'opt-list' });
          var btns = [];
          var causes = api.shuffle(sc.causes);

          causes.forEach(function (cz) {
            var btn = h('button', { class: 'opt', type: 'button' }, [h('span', { text: cz.t })]);
            btn.addEventListener('click', function () {
              btns.forEach(function (b) { b.disabled = true; });
              causes.forEach(function (c2, j) {
                btns[j].classList.add(c2.correct ? 'right' : 'wrong');
                btns[j].appendChild(h('span', { class: 'why', text: c2.why }));
              });
              finish(cz.correct);
            });
            btns.push(btn);
            list.appendChild(btn);
          });

          panel.appendChild(list);
          mount.appendChild(panel);

          var host = h('div');
          mount.appendChild(host);

          function finish(correct) {
            var keysFound = 0;
            sc.actions.forEach(function (a) { if (a.key && done[a.id]) keysFound += 1; });

            var timeBonus = correct ? Math.round(20 * Math.max(0, remain()) / sc.budget) : 0;
            var keyBonus = Math.round(10 * keysFound / totalKeys);
            var score = (correct ? 70 : 0) + timeBonus + keyBonus;

            host.appendChild(
              h('div', { class: 'btn-row', style: 'margin-top:16px' }, [
                h('button', {
                  class: 'btn primary',
                  text: 'Xem kết quả →',
                  onclick: function () {
                    api.finish({
                      score: score,
                      verdict: correct
                        ? 'Đúng nguyên nhân gốc, dùng ' + spent + '/' + sc.budget + ' phút.'
                        : 'Sai nguyên nhân gốc — sự cố sẽ lặp lại.',
                      notes: [
                        {
                          tone: correct ? 'good' : 'bad',
                          title: correct ? 'Tìm đúng nguyên nhân' : 'Kết luận sai',
                          body: correct
                            ? 'Bạn tìm được ' + keysFound + '/' + totalKeys + ' manh mối quyết định. ' +
                              'Điều tra theo bằng chứng, không theo linh cảm, là thứ giúp không phải xử lý lại sự cố này lần nữa.'
                            : 'Bạn tìm được ' + keysFound + '/' + totalKeys + ' manh mối quyết định trước khi kết luận. ' +
                              'Đọc lại phần giải thích ở màn trước: manh mối bạn bỏ qua chính là chỗ chỉ thẳng vào nguyên nhân thật.'
                        }
                      ],
                      breakdown: [
                        { ok: correct, text: 'Xác định đúng nguyên nhân gốc', pts: correct ? 70 : 0 },
                        { ok: timeBonus > 0, text: 'Thời gian còn lại: ' + Math.max(0, remain()) + ' phút', pts: timeBonus },
                        { ok: keysFound === totalKeys, text: 'Manh mối quyết định: ' + keysFound + '/' + totalKeys, pts: keyBonus }
                      ]
                    });
                  }
                })
              ])
            );
            host.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          }
        }

        renderBoard();
      }

      if (!scenarios.length) {
        mount.appendChild(h('div', { class: 'panel' }, [h('p', { text: 'Chưa có kịch bản nào trong ngân hàng dữ liệu.' })]));
        return;
      }
      renderPicker();
    }
  });
})();
