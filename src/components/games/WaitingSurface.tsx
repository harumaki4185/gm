import type { RoomSettings, RoomSnapshot, WaitingView } from "../../shared/types";

export function WaitingSurface({
  snapshot,
  view,
  onWaitingSettingsChange,
  onStartWaitingRoom,
  waitingSettingsBusy,
  waitingStartBusy
}: {
  snapshot: RoomSnapshot;
  view: WaitingView;
  onWaitingSettingsChange?: (settings: Partial<RoomSettings>) => void;
  onStartWaitingRoom?: () => void;
  waitingSettingsBusy: boolean;
  waitingStartBusy: boolean;
}) {
  const selfPlayer =
    snapshot.selfPlayerId === null
      ? null
      : snapshot.players.find((player) => player.id === snapshot.selfPlayerId) ?? null;
  const isHost = Boolean(selfPlayer?.isHost);
  const variableSeats = view.minSeats !== view.maxSeats;
  const availableBotSeats = Math.max(0, view.totalSeats - view.joinedHumans);
  const botOptions = view.supportsBots ? Array.from({ length: availableBotSeats + 1 }, (_, index) => index) : [0];

  return (
    <section className="surface-card">
      <h2>対戦待機中</h2>
      <p>{view.message}</p>
      <div className="waiting-stats">
        <div>
          <span>参加中の人間</span>
          <strong>
            {view.joinedHumans} 人 / 接続中 {view.connectedHumans} 人
          </strong>
        </div>
        <div>
          <span>待機中の席数</span>
          <strong>{view.totalSeats} 席</strong>
        </div>
        <div>
          <span>開始予定</span>
          <strong>
            人間 {view.joinedHumans} + BOT {view.botCount} = {view.startPlayerCount}
          </strong>
        </div>
      </div>
      <p className="surface-status">{buildWaitingHint(view)}</p>
      {isHost ? (
        <div className="waiting-controls">
          {variableSeats ? (
            <label className="field">
              <span>待機席数</span>
              <select
                disabled={waitingSettingsBusy}
                onChange={(event) =>
                  onWaitingSettingsChange?.({
                    seatCount: Number(event.target.value),
                    botCount: Math.min(view.botCount, Math.max(0, Number(event.target.value) - view.joinedHumans))
                  })
                }
                value={view.totalSeats}
              >
                {Array.from({ length: Math.max(0, view.maxSeats - Math.max(view.minSeats, view.joinedHumans) + 1) }, (_, index) => {
                  const value = Math.min(view.maxSeats, Math.max(view.minSeats, view.joinedHumans)) + index;
                  return (
                    <option key={value} value={value}>
                      {value} 人
                    </option>
                  );
                })}
              </select>
            </label>
          ) : null}
          {view.supportsBots ? (
            <label className="field">
              <span>追加する bot 数</span>
              <select
                disabled={waitingSettingsBusy}
                onChange={(event) => onWaitingSettingsChange?.({ botCount: Number(event.target.value) })}
                value={view.botCount}
              >
                {botOptions.map((value) => (
                  <option key={value} value={value}>
                    {value} 体
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <button
            className="primary-button"
            disabled={waitingStartBusy || waitingSettingsBusy || !view.canStart}
            onClick={() => onStartWaitingRoom?.()}
          >
            {waitingStartBusy ? "開始中..." : "試合開始"}
          </button>
        </div>
      ) : null}
    </section>
  );
}

function buildWaitingHint(view: WaitingView): string {
  if (view.connectedHumans < view.joinedHumans) {
    return "切断中の参加者がいるため開始できません。再接続を待つか、別名で参加し直してください。";
  }

  if (view.joinedHumans < view.minHumanPlayers) {
    return `開始には人間プレイヤーが最低 ${view.minHumanPlayers} 人必要です。`;
  }

  if (view.startPlayerCount < view.minSeats) {
    return `開始人数は最低 ${view.minSeats} 人必要です。必要なら bot を追加してください。`;
  }

  if (view.minSeats === view.maxSeats && view.startPlayerCount !== view.maxSeats) {
    return `${view.maxSeats} 人固定のゲームです。残り席を bot で埋めるか、人間プレイヤーの参加を待ってください。`;
  }

  return "ホストが bot 数を調整してから試合開始できます。";
}
