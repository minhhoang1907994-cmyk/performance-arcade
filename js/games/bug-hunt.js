/* Bug Hunt - chọn dòng có bug + phân loại bug, có tính điểm tốc độ. */
(function () {
  'use strict';

  var QUESTIONS_PER_ROUND = 8;
  var SECONDS_PER_QUESTION = 60;

  window.DevLabGames = window.DevLabGames || [];
  window.DevLabGames.push({
    id: 'bug-hunt',
    icon: '🐞',
    name: 'Bug Hunt',
    tagline: 'Đọc đoạn code, chỉ đúng dòng có bug và gọi tên loại bug. Càng nhanh càng nhiều điểm.',
    skill: 'Code review',
    duration: '~8 phút',

    start: function (mount, api) {
      var h = api.h;
      var clear = api.clear;

      var pool = window.BUG_HUNT_QUESTIONS || [];
      var cats = window.BUG_HUNT_CATEGORIES || [];
      var questions = api.shuffle(pool).slice(0, Math.min(QUESTIONS_PER_ROUND, pool.length));

      var idx = 0;
      var results = [];
      var timer = null;

      function stopTimer() {
        if (timer) {
          clearInterval(timer);
          timer = null;
        }
      }

      function catLabel(id) {
        var label = id;
        cats.forEach(function (c) { if (c.id === id) label = c.label; });
        return label;
      }

      function renderQuestion() {
        var q = questions[idx];
        var pickedLine = null;
        var pickedCat = null;
        var locked = false;
        var remain = SECONDS_PER_QUESTION;

        clear(mount);

        var fill = h('div', { class: 'progress-fill', style: 'width:' + (idx / questions.length) * 100 + '%' });
        mount.appendChild(h('div', { class: 'progress-track' }, [fill]));

        var clockEl = h('span', { class: 'clock', text: remain + 's' });
        mount.appendChild(
          h('div', { class: 'budget-bar' }, [
            h('span', { class: 'tag', text: 'Câu ' + (idx + 1) + '/' + questions.length }),
            h('span', { class: 'tag', text: q.lang }),
            h('span', { class: 'tag', text: 'Mức: ' + q.level }),
            clockEl
          ])
        );

        var panel = h('div', { class: 'panel' });
        panel.appendChild(h('h3', { text: q.title }));
        panel.appendChild(h('p', { class: 'hint', text: 'Bấm vào dòng bạn cho là có bug, sau đó chọn loại bug.' }));

        /* khối code */
        var codeBox = h('div', { class: 'code' });
        var lineEls = [];
        q.code.forEach(function (line, i) {
          var no = i + 1;
          var el = h('div', { class: 'code-line' }, [
            h('span', { class: 'no', text: String(no) }),
            h('span', { text: line === '' ? ' ' : line })
          ]);
          el.addEventListener('click', function () {
            if (locked) return;
            pickedLine = no;
            lineEls.forEach(function (x) { x.classList.remove('picked'); });
            el.classList.add('picked');
            syncSubmit();
          });
          lineEls.push(el);
          codeBox.appendChild(el);
        });
        panel.appendChild(codeBox);

        /* nhóm loại bug */
        var chipBox = h('div', { class: 'chip-grid' });
        var chipEls = {};
        cats.forEach(function (c) {
          var chip = h('button', { class: 'chip', type: 'button', text: c.label });
          chip.addEventListener('click', function () {
            if (locked) return;
            pickedCat = c.id;
            Object.keys(chipEls).forEach(function (k) { chipEls[k].classList.remove('picked'); });
            chip.classList.add('picked');
            syncSubmit();
          });
          chipEls[c.id] = chip;
          chipBox.appendChild(chip);
        });
        panel.appendChild(chipBox);

        var submitBtn = h('button', { class: 'btn primary', text: 'Xác nhận', disabled: true });
        var feedbackHost = h('div');
        panel.appendChild(h('div', { class: 'btn-row' }, [submitBtn]));
        mount.appendChild(panel);
        mount.appendChild(feedbackHost);

        function syncSubmit() {
          submitBtn.disabled = !(pickedLine && pickedCat);
        }

        submitBtn.addEventListener('click', function () { lockIn(false); });

        timer = setInterval(function () {
          if (!document.body.contains(clockEl)) return stopTimer();
          remain -= 1;
          clockEl.textContent = Math.max(0, remain) + 's';
          clockEl.className = 'clock' + (remain <= 0 ? ' out' : remain <= 15 ? ' low' : '');
          if (remain <= 0) lockIn(true);
        }, 1000);

        function lockIn(timedOut) {
          if (locked) return;
          locked = true;
          stopTimer();
          submitBtn.disabled = true;
          codeBox.classList.add('locked');
          Object.keys(chipEls).forEach(function (k) { chipEls[k].disabled = true; });

          var lineOk = pickedLine !== null && q.answerLines.indexOf(pickedLine) !== -1;
          var catOk = pickedCat === q.category;
          var speed = lineOk && catOk ? Math.round(20 * Math.max(0, remain) / SECONDS_PER_QUESTION) : 0;
          var pts = (lineOk ? 50 : 0) + (catOk ? 30 : 0) + speed;

          /* tô màu dòng */
          lineEls.forEach(function (el, i) {
            var no = i + 1;
            if (q.answerLines.indexOf(no) !== -1) el.classList.add('right');
            else if (no === pickedLine) el.classList.add('wrong');
          });
          /* tô màu chip */
          if (chipEls[q.category]) chipEls[q.category].classList.add('right');
          if (pickedCat && pickedCat !== q.category) chipEls[pickedCat].classList.add('wrong');

          var tone = pts >= 80 ? 'good' : pts >= 50 ? 'warn' : 'bad';
          var headline = timedOut && pickedLine === null
            ? 'Hết giờ — chưa chọn gì'
            : lineOk && catOk
            ? 'Chính xác cả dòng lẫn loại bug'
            : lineOk
            ? 'Đúng dòng, sai loại bug'
            : catOk
            ? 'Đúng loại bug, sai dòng'
            : 'Chưa đúng';

          var fb = h('div', { class: 'feedback ' + tone }, [
            h('h4', { text: headline + '  ·  ' + pts + '/100 điểm' }),
            h('p', { text: 'Dòng đúng: ' + q.answerLines.join(', ') + '  ·  Loại: ' + catLabel(q.category) }),
            h('p', { text: q.explanation }),
            h('p', {}, [h('span', { class: 'fix-line', text: 'Sửa: ' + q.fix })])
          ]);
          feedbackHost.appendChild(fb);

          var nextBtn = h('button', {
            class: 'btn primary',
            text: idx + 1 < questions.length ? 'Câu tiếp theo →' : 'Xem kết quả',
            onclick: function () {
              idx += 1;
              if (idx < questions.length) renderQuestion();
              else summarize();
            }
          });
          feedbackHost.appendChild(h('div', { class: 'btn-row' }, [nextBtn]));

          results.push({
            title: q.title,
            lang: q.lang,
            pts: pts,
            ok: lineOk && catOk,
            lineOk: lineOk,
            catOk: catOk
          });

          fb.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      }

      function summarize() {
        stopTimer();
        var total = results.reduce(function (a, r) { return a + r.pts; }, 0);
        var score = Math.round(total / results.length);

        var missedCat = results.filter(function (r) { return r.lineOk && !r.catOk; }).length;
        var notes = [];
        if (missedCat >= 2) {
          notes.push({
            tone: '',
            title: 'Bạn nhìn ra bug nhưng gọi sai tên',
            body:
              'Có ' + missedCat + ' câu bạn chỉ đúng dòng nhưng phân loại sai. Gọi đúng tên loại bug quan trọng ' +
              'khi viết comment review — người nhận cần biết đây là lỗi bảo mật hay lỗi hiệu năng để ưu tiên sửa.'
          });
        }

        api.finish({
          score: score,
          breakdown: results.map(function (r, i) {
            return {
              ok: r.ok,
              text: 'Câu ' + (i + 1) + ' · ' + r.title + ' (' + r.lang + ')',
              pts: r.pts
            };
          }),
          notes: notes
        });
      }

      if (!questions.length) {
        mount.appendChild(h('div', { class: 'panel' }, [h('p', { text: 'Chưa có câu hỏi nào trong ngân hàng dữ liệu.' })]));
        return;
      }
      renderQuestion();
    }
  });
})();
