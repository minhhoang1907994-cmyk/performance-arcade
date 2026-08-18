'use strict';

/* Điều phối một lượt chơi: mở round, phát step, chấm step, chốt điểm.
 *
 * Tầng này KHÔNG biết luật của game nào — luật nằm ở `engines/`. Việc của nó là
 * transaction, quyền sở hữu, thứ tự step, và dựng response theo allowlist spec 5.3.
 *
 * Toàn bộ chấm điểm chạy phía server (BR-01): client chỉ gửi lựa chọn thô.
 */

const { AppError } = require('../http/errors');
const { withTransaction } = require('../db/pool');
const { getEngine, GAME_IDS } = require('./engines');
const { computeRoundScore } = require('./scoring');
const repo = require('./repository');

function createRoundService({ pool, config, logger = console, rng = Math.random }) {
  function requireEngine(gameId) {
    const engine = getEngine(gameId);
    if (!engine) {
      throw new AppError('VALIDATION_ERROR', {
        details: `game_id: phải thuộc ${GAME_IDS.join(', ')}`
      });
    }
    return engine;
  }

  /* Round khách được định danh CHỈ bằng round_id — UUID v4 không đoán được (spec 12).
   * Cố tình không so IP: người chơi chuyển từ wifi sang 4G sẽ mất lượt đang chơi. */
  function assertOwnership(round, user) {
    if (round.is_guest) return;
    if (!user || Number(round.user_id) !== Number(user.id)) throw new AppError('NOT_FOUND');
  }

  function elapsedSecondsSince(servedAt) {
    return Math.max(0, Math.floor((Date.now() - new Date(servedAt).getTime()) / 1000));
  }

  function isExpired(step) {
    return Boolean(step.expiresAt) && Date.now() > new Date(step.expiresAt).getTime();
  }

  /* Shape của step gửi client. `expires_at` là phần bổ sung ngoài spec 5.2: khi người
   * chơi F5 giữa lượt, server KHÔNG được đặt lại đồng hồ (BR-03a), nên client cần mốc
   * hết hạn thật để vẽ đồng hồ còn lại thay vì đếm lại từ 60. */
  function stepView({ engine, payload, step, itemState, isItemStart }) {
    const limit = step.expiresAt
      ? Math.round((new Date(step.expiresAt).getTime() - new Date(step.servedAt).getTime()) / 1000)
      : null;
    return {
      step_seq: step.stepSeq,
      kind: step.kind,
      time_limit_seconds: limit,
      expires_at: step.expiresAt ? new Date(step.expiresAt).toISOString() : null,
      budget: payload.budget === undefined ? null : payload.budget,
      prompt: engine.buildPrompt({ payload, step, itemState, isItemStart })
    };
  }

  function timeLimitFor(step) {
    return step.timeLimitSeconds === undefined ? null : step.timeLimitSeconds;
  }

  async function openStep(client, { round, item, engineStep, stepSeq }) {
    return repo.insertStep(client, {
      roundId: round.id,
      roundItemId: item.id,
      stepSeq,
      kind: engineStep.kind,
      orderMap: engineStep.orderMap,
      contentSnapshotHash: item.contentHash,
      timeLimitSeconds: timeLimitFor(engineStep)
    });
  }

  /* -------------------------------------------------------------- POST /rounds */

  async function startRound({ user, ip, gameId }) {
    const engine = requireEngine(gameId);
    const isGuest = !user;
    if (isGuest && !config.allowAnonymousPlay) throw new AppError('GUEST_PLAY_DISABLED');

    try {
      return await withTransaction(pool, async (client) => {
        if (user) {
          const activeId = await repo.findActiveRoundForUser(client, user.id);
          /* BR-10: từ chối thẳng, không "abandon rồi tạo mới" — cách đó tạo race giữa
           * hai tab và người chơi mất lượt đang dở mà không hiểu vì sao (spec 9.3). */
          if (activeId) {
            throw new AppError('ROUND_ALREADY_ACTIVE', { extra: { round_id: activeId } });
          }
        }

        const items = await repo.pickItems(client, gameId, engine.itemsPerRound);
        if (items.length < engine.itemsPerRound) throw new AppError('POOL_EXHAUSTED');

        const round = await repo.insertRound(client, {
          userId: user ? user.id : null,
          isGuest,
          guestIp: isGuest ? ip || null : null,
          gameId,
          state: {}
        });

        const roundItems = await repo.insertRoundItems(
          client,
          round.id,
          items.map((item) => item.id)
        );
        roundItems.sort((a, b) => a.itemSeq - b.itemSeq);

        /* Ghép tường minh chứ không spread hai object vào nhau: cả round_items lẫn
         * content_items đều có cột `id` và trộn nhầm thì round_item_id hoá thành
         * content_item_id — FK vẫn tồn tại nên lỗi chỉ nổ ra ở INSERT round_steps. */
        const firstItem = {
          id: roundItems[0].id,
          itemSeq: roundItems[0].itemSeq,
          contentItemId: roundItems[0].contentItemId,
          payload: items[0].payload,
          contentHash: items[0].contentHash
        };
        const started = engine.startItem(firstItem.payload, rng);
        const step = await openStep(client, {
          round,
          item: firstItem,
          engineStep: started.step,
          stepSeq: 1
        });

        const state = {
          item_ids: items.map((item) => item.id),
          current_item_seq: 1,
          current_step_seq: 1,
          current_item: started.itemState
        };
        await repo.updateRoundState(client, round.id, state);
        await repo.bumpServedCount(client, firstItem.contentItemId);

        return {
          round_id: round.id,
          game_id: gameId,
          is_guest: isGuest,
          progress: { item_seq: 1, total_items: engine.itemsPerRound },
          step: stepView({
            engine,
            payload: firstItem.payload,
            step,
            itemState: started.itemState,
            isItemStart: true
          })
        };
      });
    } catch (err) {
      /* Hai tab bấm bắt đầu cùng lúc: unique partial index chặn ở tầng DB, ứng dụng
       * chỉ việc dịch lại thành lỗi có nghĩa cho client (spec 9.3). */
      if (err && err.code === '23505' && err.constraint === 'uq_game_rounds_one_active') {
        const activeId = await repo.findActiveRoundForUser(pool, user.id);
        throw new AppError('ROUND_ALREADY_ACTIVE', { extra: { round_id: activeId } });
      }
      throw err;
    }
  }

  /* --------------------------------------------------- chấm một step + đi tiếp */

  async function resolveStep(client, context) {
    const { round, engine, items, step, currentItem, choice, rawChoice, expired } = context;

    const elapsedSeconds = elapsedSecondsSince(step.servedAt);
    const outcome = engine.applyChoice({
      payload: currentItem.payload,
      step,
      choice,
      itemState: round.state.current_item || {},
      elapsedSeconds,
      expired,
      rng
    });

    await repo.answerStep(client, step.id, {
      choice: expired ? null : rawChoice,
      effect: { ...outcome.effect, elapsed_seconds: elapsedSeconds }
    });

    const state = { ...round.state, current_item: outcome.itemState };
    let nextStepView = null;
    let summary = null;
    let completed = false;

    if (outcome.nextStep) {
      const nextStep = await openStep(client, {
        round,
        item: currentItem,
        engineStep: outcome.nextStep,
        stepSeq: step.stepSeq + 1
      });
      state.current_step_seq = nextStep.stepSeq;
      nextStepView = stepView({
        engine,
        payload: currentItem.payload,
        step: nextStep,
        itemState: outcome.itemState,
        isItemStart: false
      });
    } else {
      await repo.completeItem(client, currentItem.id, outcome.itemPoints);
      currentItem.points = outcome.itemPoints;

      const nextItem = items.find((item) => item.itemSeq === currentItem.itemSeq + 1);
      if (nextItem) {
        const started = engine.startItem(nextItem.payload, rng);
        const nextStep = await openStep(client, {
          round,
          item: nextItem,
          engineStep: started.step,
          stepSeq: step.stepSeq + 1
        });
        state.current_item_seq = nextItem.itemSeq;
        state.current_step_seq = nextStep.stepSeq;
        state.current_item = started.itemState;
        await repo.bumpServedCount(client, nextItem.contentItemId);
        nextStepView = stepView({
          engine,
          payload: nextItem.payload,
          step: nextStep,
          itemState: started.itemState,
          isItemStart: true
        });
      } else {
        completed = true;
        summary = await finishRound(client, { round, engine, items });
      }
    }

    await repo.updateRoundState(client, round.id, state);

    return {
      step_seq: step.stepSeq,
      reveal: outcome.reveal,
      effect: { points_delta: outcome.effect.points_delta, elapsed_seconds: elapsedSeconds },
      progress: {
        item_seq: currentItem.itemSeq,
        total_items: engine.itemsPerRound,
        completed
      },
      next_step: nextStepView,
      summary
    };
  }

  /* --------------------------------------------------------- chốt điểm cả lượt */

  async function finishRound(client, { round, engine, items }) {
    const playedItems = items.filter((item) => !item.voided);
    const { score, voidedContent } = computeRoundScore(
      playedItems.map((item) => item.points).filter((points) => points !== null)
    );

    if (voidedContent) {
      /* BR-04: mọi item đều bị ẩn vì lỗi nội dung → giữ nguyên điểm cũ, KHÔNG ghi 0.
       * Người chơi không được trừ điểm vì lỗi ngân hàng câu hỏi. */
      logger.warn(
        `[rounds] round ${round.id} kết thúc với toàn bộ item bị void — giữ nguyên score cũ`
      );
    }
    await repo.finishRound(client, round.id, voidedContent ? round.score : score);

    const allSteps = await repo.loadSteps(client, round.id);
    const summaryItems = playedItems.map((item) => ({
      payload: item.payload,
      points: item.points,
      steps: allSteps.filter((step) => step.roundItemId === item.id)
    }));
    const { breakdown, notes } = engine.buildSummary(summaryItems);

    const finalScore = voidedContent ? round.score : score;
    /* BR-16: round khách không bao giờ vào best score, leaderboard hay lịch sử. */
    const countsTowardLeaderboard = !round.is_guest;

    let isPersonalBest = false;
    let rank = null;
    if (countsTowardLeaderboard && finalScore !== null) {
      const best = await repo.upsertLeaderboardBest(client, {
        userId: round.user_id,
        gameId: round.game_id,
        score: finalScore,
        roundId: round.id
      });
      isPersonalBest = best.isPersonalBest;
      rank = await repo.fetchRanks(client, round.user_id, round.game_id);
    }

    return {
      score: finalScore,
      is_personal_best: isPersonalBest,
      counts_toward_leaderboard: countsTowardLeaderboard,
      breakdown,
      notes,
      rank
    };
  }

  /* --------------------------------------- nạp round + item + step đang chờ */

  async function loadContext(client, roundId, user) {
    if (!repo.isUuid(roundId)) throw new AppError('NOT_FOUND');

    const round = await repo.lockRound(client, roundId);
    if (!round) throw new AppError('NOT_FOUND');
    assertOwnership(round, user);
    if (round.status !== 'in_progress') throw new AppError('ROUND_NOT_ACTIVE');

    const engine = requireEngine(round.game_id);
    const items = await repo.loadRoundItems(client, roundId);
    const currentItem = items.find((item) => item.itemSeq === round.state.current_item_seq);
    if (!currentItem) throw new AppError('NOT_FOUND');

    return { round, engine, items, currentItem };
  }

  /* ------------------------------------------- POST /rounds/:id/steps/:stepSeq */

  async function submitStep({ user, roundId, stepSeq, choice }) {
    return withTransaction(pool, async (client) => {
      const context = await loadContext(client, roundId, user);
      const { round, engine, currentItem } = context;

      const step = await repo.loadStep(client, roundId, stepSeq);
      if (!step) throw new AppError('NOT_FOUND');
      /* Thứ tự kiểm quan trọng: step đã trả lời phải ra STEP_ALREADY_ANSWERED (9.1)
       * chứ không phải STEP_OUT_OF_ORDER, vì double-submit là tình huống thường gặp
       * hơn nhiều và client cần phân biệt được hai ca. */
      if (step.answeredAt) throw new AppError('STEP_ALREADY_ANSWERED');
      if (step.stepSeq !== round.state.current_step_seq) throw new AppError('STEP_OUT_OF_ORDER');

      if (isExpired(step)) {
        /* 8.2 điều kiện B: lựa chọn bị vứt bỏ, step chốt 0 điểm, nhưng body của 409
         * vẫn kèm reveal và next_step để client đi tiếp mà không phải gọi thêm.
         *
         * KHÔNG ném AppError ở đây: đang ở trong transaction, ném là ROLLBACK và việc
         * chốt step ở 0 điểm bị huỷ — người chơi F5 lại là step quá hạn vẫn còn treo.
         * Trả cờ về cho route dịch thành 409 sau khi đã COMMIT. */
        const resolved = await resolveStep(client, {
          ...context,
          step,
          choice: null,
          rawChoice: null,
          expired: true
        });
        return { expired: true, result: resolved };
      }

      const parsed = engine.parseChoice({
        payload: currentItem.payload,
        step,
        itemState: round.state.current_item || {},
        choice
      });

      const resolved = await resolveStep(client, {
        ...context,
        step,
        choice: parsed,
        rawChoice: choice,
        expired: false
      });
      return { expired: false, result: resolved };
    });
  }

  /* -------------------------------------------------------- GET /rounds/:id */

  async function getRound({ user, roundId }) {
    return withTransaction(pool, async (client) => {
      const context = await loadContext(client, roundId, user);
      const { round, engine, currentItem } = context;

      const step = await repo.loadStep(client, roundId, round.state.current_step_seq);
      if (!step) throw new AppError('NOT_FOUND');

      if (isExpired(step) && !step.answeredAt) {
        /* 8.2 điều kiện C: người chơi bỏ đi rồi quay lại sau khi step đã quá hạn —
         * chốt ngay ở 0 điểm để không có step nào treo vô hạn. */
        const resolved = await resolveStep(client, {
          ...context,
          step,
          choice: null,
          rawChoice: null,
          expired: true
        });
        return {
          round_id: round.id,
          game_id: round.game_id,
          is_guest: round.is_guest,
          progress: resolved.progress,
          step: resolved.next_step,
          expired_step: { step_seq: step.stepSeq, reveal: resolved.reveal },
          summary: resolved.summary
        };
      }

      const firstSeq = await repo.firstStepSeqOfItem(client, step.roundItemId);

      return {
        round_id: round.id,
        game_id: round.game_id,
        is_guest: round.is_guest,
        progress: {
          item_seq: round.state.current_item_seq,
          total_items: engine.itemsPerRound
        },
        /* KHÔNG cấp served_at mới ở đây (BR-03a) — nếu không thì F5 là đặt lại đồng hồ. */
        step: stepView({
          engine,
          payload: currentItem.payload,
          step,
          itemState: round.state.current_item || {},
          isItemStart: step.stepSeq === firstSeq
        })
      };
    });
  }

  /* ------------------------------------------------ POST /rounds/:id/abandon */

  async function abandonRound({ user, roundId }) {
    return withTransaction(pool, async (client) => {
      if (!repo.isUuid(roundId)) throw new AppError('NOT_FOUND');
      const round = await repo.lockRound(client, roundId);
      if (!round) throw new AppError('NOT_FOUND');
      assertOwnership(round, user);
      if (round.status !== 'in_progress') throw new AppError('ROUND_NOT_ACTIVE');

      await repo.abandonRound(client, roundId);
      return { round_id: roundId, status: 'abandoned' };
    });
  }

  async function fetchMyBest(userId) {
    return repo.fetchMyBest(pool, userId);
  }

  return { startRound, submitStep, getRound, abandonRound, fetchMyBest };
}

module.exports = { createRoundService };
