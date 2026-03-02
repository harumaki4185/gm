import { formatMahjongTile, getMahjongTileSuit } from "../../shared/mahjong";
import type { ClientAction, MahjongCallOptionView, MahjongView } from "../../shared/types";

interface MahjongSurfaceProps {
  view: MahjongView;
  onAction: (action: ClientAction) => void;
  isSpectator: boolean;
}

export function MahjongSurface({ view, onAction, isSpectator }: MahjongSurfaceProps) {
  return (
    <section className="surface-card">
      <h2>麻雀</h2>
      <p className="surface-status">{view.statusMessage}</p>
      {view.lastAction ? <p className="surface-status">{view.lastAction}</p> : null}

      <div className="mahjong-meta">
        <div>
          <span>局</span>
          <strong>{view.roundLabel}</strong>
        </div>
        <div>
          <span>山</span>
          <strong>{view.wallCount} 枚</strong>
        </div>
        <div>
          <span>王牌</span>
          <strong>{view.deadWallCount} 枚</strong>
        </div>
        <div>
          <span>ドラ表示</span>
          <strong>{view.doraIndicator ? formatMahjongTile(view.doraIndicator) : "-"}</strong>
        </div>
      </div>

      <div className="mahjong-player-grid">
        {view.players.map((player) => (
          <div
            className={`mahjong-player ${player.isCurrent ? "mahjong-player--current" : ""} ${
              player.isWinner ? "mahjong-player--winner" : ""
            }`}
            key={player.seat}
          >
            <strong>
              {player.name}
              {player.isDealer ? " / 親" : ""}
            </strong>
            <span>{player.score.toLocaleString()} 点</span>
            <span>手牌 {player.handCount} 枚</span>
            <span>河 {player.discardCount} 枚</span>
            {player.melds.length > 0 ? (
              <div className="mahjong-melds">
                {player.melds.map((meld, index) => (
                  <div className="mahjong-meld" key={`${player.seat}-${meld.type}-${index}`}>
                    <span>{labelForMeld(meld.type)}</span>
                    <strong>{meld.tiles.join(" ")}</strong>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ))}
      </div>

      {view.results.length > 0 ? (
        <div className="mahjong-result-stack">
          {view.results.map((result, index) => (
            <div className="mahjong-result" key={`${result.winnerSeat}-${result.sourceSeat ?? "tsumo"}-${index}`}>
              <strong>{result.summary}</strong>
              <span>
                {result.han} 翻 / {result.fu} 符 / 役: {result.yaku.join(" / ")}
              </span>
              <div className="mahjong-result__scores">
                {view.players.map((player) => {
                  const delta = result.scoreDeltas[player.seat] ?? 0;
                  const sign = delta > 0 ? "+" : "";
                  return (
                    <span key={`${player.seat}-delta-${index}`}>
                      {player.name}: {sign}
                      {delta}
                    </span>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      ) : null}

      <div className="mahjong-rivers">
        {view.discards.map((river) => (
          <div className="mahjong-river" key={river.seat}>
            <div className="mahjong-river__header">
              <strong>{river.name}</strong>
              <span>{river.tiles.length} 打</span>
            </div>
            <div className="mahjong-river__tiles">
              {river.tiles.length === 0 ? (
                <span className="mahjong-river__empty">まだ捨て牌はありません</span>
              ) : (
                river.tiles.map((tile) => (
                  <div className={getMahjongTileClass(tile)} key={tile}>
                    {formatMahjongTile(tile)}
                  </div>
                ))
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="card-hand-panel">
        <div className="card-hand-panel__meta">
          <span>{isSpectator ? "観戦中" : "自分の手牌"}</span>
          <strong>{isSpectator ? "Hidden" : `${view.selfHand.length} 枚`}</strong>
        </div>
        {view.finishReason ? <p className="surface-status">{view.finishReason}</p> : null}

        {isSpectator ? (
          <p className="surface-status">観戦中は非公開の手牌情報を表示しません。</p>
        ) : (
          <>
            {view.canTsumo ? (
              <div className="mahjong-actions">
                <button className="primary-button" onClick={() => onAction({ type: "mahjong_tsumo" })}>
                  ツモ
                </button>
              </div>
            ) : null}

            {view.pendingCall ? (
              <div className="mahjong-actions">
                <p className="surface-status">打牌 {formatMahjongTile(view.pendingCall.discardTile)} に反応できます。</p>
                {view.pendingCall.options.map((option) => (
                  <div className="mahjong-call-group" key={option.type}>
                    <strong>{labelForMeld(option.type === "ron" ? "ron" : option.type)}</strong>
                    <div className="mahjong-actions">
                      {renderCallButtons(option, onAction)}
                    </div>
                  </div>
                ))}
                <button className="ghost-button" onClick={() => onAction({ type: "mahjong_pass_call" })}>
                  見送る
                </button>
              </div>
            ) : null}

            <div className="mahjong-hand">
              {view.selfHand.map((tile) => (
                <button
                  className={getMahjongTileClass(tile)}
                  disabled={!view.canAct || view.pendingCall !== null}
                  key={tile}
                  onClick={() => onAction({ type: "mahjong_discard", tile })}
                  title={view.canAct && view.pendingCall === null ? "この牌を打牌する" : "現在は打牌できません"}
                >
                  {formatMahjongTile(tile)}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </section>
  );
}

function renderCallButtons(
  option: MahjongCallOptionView,
  onAction: (action: ClientAction) => void
) {
  if (option.type === "ron") {
    return [
      <button className="primary-button" key="ron" onClick={() => onAction({ type: "mahjong_ron" })}>
        ロン
      </button>
    ];
  }

  return option.combinations.map((combination) => (
    <button
      className="ghost-button"
      key={`${option.type}-${combination.join("-")}`}
      onClick={() =>
        onAction({
          type: "mahjong_call",
          call: option.type,
          tiles: combination
        })
      }
    >
      {labelForMeld(option.type)} {combination.map((tile) => formatMahjongTile(tile)).join(" ")}
    </button>
  ));
}

function labelForMeld(type: "chi" | "pon" | "kan" | "ron"): string {
  switch (type) {
    case "chi":
      return "チー";
    case "pon":
      return "ポン";
    case "kan":
      return "カン";
    case "ron":
      return "ロン";
  }
}

function getMahjongTileClass(tile: string): string {
  const suit = getMahjongTileSuit(tile);
  return `mahjong-tile mahjong-tile--${suit}`;
}
