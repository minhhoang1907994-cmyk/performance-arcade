/* Spec Detective - tìm điểm mơ hồ trong spec rồi chọn cách làm rõ đúng. */
(function () {
  'use strict';

  var CASES_PER_ROUND = 4;

  window.DevLabGames = window.DevLabGames || [];
  window.DevLabGames.push({
    id: 'spec-detective',
    icon: '🔍',
    name: 'Spec Detective',
    tagline: 'Đọc đoạn spec khách gửi, khoanh vùng chỗ mơ hồ và chọn câu hỏi làm rõ đáng gửi đi nhất.',
    skill: 'Đọc & chất vấn spec',
    duration: '~7 phút',

    start: function (mount, api) {
      var h = api.h;
      var clear = api.clear;

      var pool = window.SPEC_DETECTIVE_CASES || [];
      var cases = api.shuffle(pool).slice(0, Math.min(CASES_PER_ROUND, pool.length));

      var idx = 0;
      var results = [];

      function renderCase() {
        var c = cases[idx];
        var picked = {};
        var locked = false;

        clear(mount);
        mount.appendChild(
          h('div', { class: 'progress-track' }, [
            h('div', { class: 'progress-fill', style: 'width:' + (idx / cases.length) * 100 + '%' })
          ])
        );

        mount.appendChild(
          h('div', { class: 'budget-bar' }, [
            h('span', { class: 'tag', text: 'Case ' + (idx + 1) + '/' + cases.length }),
            h('span', { class: 'tag', text: c.source })
          ])
        );

        var panel = h('div', { class: 'panel' });
        panel.appendChild(h('h3', { text: c.title }));
        panel.appendChild(
          h('p', {
            class: 'hint',
            text: 'Bấm vào những cụm từ mơ hồ — chỗ mà hai người đọc có thể hiểu thành hai thứ khác nhau. Chọn nhầm bị trừ điểm.'
          })
        );

        var specBox = h('div', { class: 'spec-text' });
        var segEls = [];
        c.segments.forEach(function (seg, i) {
          var el = h('span', { class: 'seg', text: seg.t });
          el.addEventListener('click', function () {
            if (locked) return;
            if (picked[i]) {
              delete picked[i];
              el.classList.remove('picked');
            } else {
              picked[i] = true;
              el.classList.add('picked');
            }
          });
          segEls.push(el);
          specBox.appendChild(el);
        });
        panel.appendChild(specBox);

        var checkBtn = h('button', { class: 'btn primary', text: 'Chấm điểm' });
        panel.appendChild(h('div', { class: 'btn-row' }, [checkBtn]));
        mount.appendChild(panel);

        var after = h('div');
        mount.appendChild(after);

        checkBtn.addEventListener('click', function () {
          if (locked) return;
          locked = true;
          checkBtn.disabled = true;
          specBox.classList.add('locked');

          var totalAmb = 0;
          var found = 0;
          var falsePos = 0;
          var reasons = h('ul', { class: 'reason-list' });

          c.segments.forEach(function (seg, i) {
            var el = segEls[i];
            el.classList.remove('picked');

            if (seg.a) {
              totalAmb += 1;
              if (picked[i]) {
                found += 1;
                el.classList.add('right');
                reasons.appendChild(
                  h('li', { class: 'right' }, [h('b', { text: '✓ "' + seg.t.trim() + '"' }), h('span', { text: seg.r })])
                );
              } else {
                el.classList.add('missed');
                reasons.appendChild(
                  h('li', { class: 'missed' }, [h('b', { text: '○ Bỏ sót: "' + seg.t.trim() + '"' }), h('span', { text: seg.r })])
                );
              }
            } else if (picked[i]) {
              falsePos += 1;
              el.classList.add('wrong');
              reasons.appendChild(
                h('li', { class: 'wrong' }, [
                  h('b', { text: '✕ Chọn nhầm: "' + seg.t.trim() + '"' }),
                  h('span', { text: seg.r || 'Đoạn này đủ rõ để viết được test case, không phải điểm mơ hồ.' })
                ])
              );
            }
          });

          var segPts = Math.max(0, Math.round(60 * found / totalAmb) - 10 * falsePos);

          after.appendChild(
            h('div', { class: 'panel' }, [
              h('h3', { text: 'Tìm được ' + found + '/' + totalAmb + ' điểm mơ hồ' + (falsePos ? '  ·  chọn nhầm ' + falsePos : '') }),
              reasons
            ])
          );

          renderFollowUp(segPts);
        });

        function renderFollowUp(segPts) {
          var fu = c.followUp;
          var panel2 = h('div', { class: 'panel' });
          panel2.appendChild(h('h3', { text: fu.question }));

          var list = h('div', { class: 'opt-list' });
          var btns = [];
          var opts = api.shuffle(fu.options);
          opts.forEach(function (o) {
            var btn = h('button', { class: 'opt', type: 'button' }, [h('span', { text: o.t })]);
            btn.addEventListener('click', function () {
              btns.forEach(function (b) { b.disabled = true; });
              opts.forEach(function (oo, j) {
                btns[j].classList.add(oo.good ? 'right' : 'wrong');
                btns[j].appendChild(h('span', { class: 'why', text: oo.why }));
              });

              var followPts = o.good ? 40 : 0;
              var pts = segPts + followPts;
              results.push({
                title: c.title,
                pts: pts,
                ok: pts >= 70,
                found: null
              });

              panel2.appendChild(
                h('div', { class: 'btn-row', style: 'margin-top:14px' }, [
                  h('button', {
                    class: 'btn primary',
                    text: idx + 1 < cases.length ? 'Case tiếp theo →' : 'Xem kết quả',
                    onclick: function () {
                      idx += 1;
                      if (idx < cases.length) renderCase();
                      else summarize();
                    }
                  }),
                  h('span', { class: 'sub', text: 'Case này: ' + pts + '/100 điểm' })
                ])
              );
              panel2.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            });
            btns.push(btn);
            list.appendChild(btn);
          });

          panel2.appendChild(list);
          after.appendChild(panel2);
          panel2.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      }

      function summarize() {
        var score = Math.round(results.reduce(function (a, r) { return a + r.pts; }, 0) / results.length);
        api.finish({
          score: score,
          breakdown: results.map(function (r, i) {
            return { ok: r.ok, text: 'Case ' + (i + 1) + ' · ' + r.title, pts: r.pts };
          }),
          notes: [
            {
              tone: '',
              title: 'Cách dùng ngoài đời',
              body:
                'Tiêu chí nhận biết điểm mơ hồ: từ câu văn đó, bạn có viết được một test case pass/fail rõ ràng không. ' +
                'Không viết được thì đó là câu cần hỏi lại — và hỏi bằng văn bản (Q&A sheet, Backlog), không hỏi miệng.'
            }
          ]
        });
      }

      if (!cases.length) {
        mount.appendChild(h('div', { class: 'panel' }, [h('p', { text: 'Chưa có case nào trong ngân hàng dữ liệu.' })]));
        return;
      }
      renderCase();
    }
  });
})();
