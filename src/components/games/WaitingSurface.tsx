import type { RoomSnapshot, WaitingView } from "../../shared/types";

export function WaitingSurface({
  snapshot,
  view,
  onWaitingBotsChange,
  waitingSettingsBusy
}: {
  snapshot: RoomSnapshot;
  view: WaitingView;
  onWaitingBotsChange?: (fillWithBots: boolean) => void;
  waitingSettingsBusy: boolean;
}) {
  const selfPlayer =
    snapshot.selfPlayerId === null
      ? null
      : snapshot.players.find((player) => player.id === snapshot.selfPlayerId) ?? null;
  const canConfigureBots = Boolean(selfPlayer?.isHost && view.supportsBots && onWaitingBotsChange);

  return (
    <section className="surface-card">
      <h2>対戦待機中</h2>
      <p>{view.message}</p>
      <div className="waiting-stats">
        <div>
          <span>人間プレイヤー</span>
          <strong>
            {view.connectedHumans} / {view.requiredHumans}
          </strong>
        </div>
        <div>
          <span>総席数</span>
          <strong>{view.totalSeats}</strong>
        </div>
        <div>
          <span>bot 補充</span>
          <strong>
            {view.supportsBots ? (view.fillWithBots ? "開始時に補充する" : "補充しない") : "なし"}
          </strong>
        </div>
      </div>
      {canConfigureBots ? (
        <div className="waiting-controls">
          <p className="surface-status">ホスト設定: 人数が足りない場合に bot を入れて開始するかを待機中に切り替えられます。</p>
          <label className="checkbox-field">
            <input
              checked={view.fillWithBots}
              disabled={waitingSettingsBusy}
              onChange={(event) => onWaitingBotsChange?.(event.target.checked)}
              type="checkbox"
            />
            <span>{waitingSettingsBusy ? "設定を更新中..." : "不足席を bot で補充して開始する"}</span>
          </label>
        </div>
      ) : null}
    </section>
  );
}
