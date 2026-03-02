import type { PlannedView } from "../../shared/types";

export function PlannedSurface({ view }: { view: PlannedView }) {
  return (
    <section className="surface-card">
      <h2>{view.title}</h2>
      <p>{view.message}</p>
    </section>
  );
}
