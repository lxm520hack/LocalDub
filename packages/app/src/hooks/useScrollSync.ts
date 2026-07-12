import { onMount, onCleanup } from "solid-js";

export function useScrollSync(
  getTracks: () => HTMLDivElement | undefined,
  getRuler: () => HTMLDivElement | undefined,
  getLabels: () => HTMLDivElement | undefined,
) {
  onMount(() => {
    const tracks = getTracks();
    const ruler = getRuler();
    const labels = getLabels();

    function sync() {
      if (!tracks) return;
      if (ruler) ruler.scrollLeft = tracks.scrollLeft;
      if (labels) labels.scrollTop = tracks.scrollTop;
    }

    if (tracks) {
      tracks.addEventListener("scroll", sync, { passive: true });
    }

    onCleanup(() => {
      if (tracks) tracks.removeEventListener("scroll", sync);
    });
  });
}
